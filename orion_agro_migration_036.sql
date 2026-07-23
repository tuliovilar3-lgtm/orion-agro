-- =====================================================================
-- ORION AGRO — Migração 036
-- Relatório de Lotação: rebanho médio, peso médio (ponderado dia a dia),
-- área média e lotação por mês, considerando a área em Pecuária.
-- Puramente aditiva — nenhuma tabela/função existente muda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- fn_estoque_rebanho_na_data: mesma lógica corrigida de vw_estoque_rebanho
-- (migração 034 — entradas/saidas agregadas antes do join, sem fan-out),
-- só que parametrizada por data (vw_estoque_rebanho só serve "hoje") e
-- por uma lista de fazendas (soma direto, sem quebrar por fazenda —
-- quem chama já decidiu quais fazendas somar). Sem filtro de ativa/ativo
-- de propósito: usada por um relatório histórico, igual
-- fn_relatorio_movimentacao_rebanho.
-- ---------------------------------------------------------------------

create or replace function fn_estoque_rebanho_na_data(p_fazenda_ids uuid[], p_data date)
returns table(categoria_id uuid, quantidade int)
language sql
stable
as $$
  with entradas as (
    select fazenda_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select fazenda_destino_id as fazenda_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select fazenda_id, categoria_destino_id as categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
  ),
  saidas as (
    select fazenda_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select fazenda_origem_id as fazenda_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select fazenda_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo = 'MUDANCA_CATEGORIA' and data <= p_data
  ),
  entradas_agg as (
    select categoria_id, sum(quantidade) as total
    from entradas
    where fazenda_id = any(p_fazenda_ids)
    group by categoria_id
  ),
  saidas_agg as (
    select categoria_id, sum(quantidade) as total
    from saidas
    where fazenda_id = any(p_fazenda_ids)
    group by categoria_id
  )
  select
    c.id,
    (coalesce(e.total, 0) - coalesce(s.total, 0))::int
  from categorias_animal c
  left join entradas_agg e on e.categoria_id = c.id
  left join saidas_agg s on s.categoria_id = c.id
$$;

-- ---------------------------------------------------------------------
-- fn_indicadores_rebanho_dia: cabeças totais e peso vivo total (soma de
-- quantidade × peso resolvido por categoria) das fazendas selecionadas
-- numa data — usada como o "valor do dia" que fn_relatorio_lotacao_mensal
-- integra dia a dia (mesmo princípio de fn_area_media_ponderada, só que
-- pra rebanho/peso em vez de área). Peso resolvido = pesagem mais recente
-- da categoria naquela(s) fazenda(s) até a data, caindo pro peso de
-- referência — mesma regra já usada em fn_resumo_rebanho_atual, mas aqui
-- sem quebrar por fazenda (visão agregada do grupo de fazendas
-- selecionado, igual ao Painel).
-- ---------------------------------------------------------------------

create or replace function fn_indicadores_rebanho_dia(p_fazenda_ids uuid[], p_data date)
returns table(headcount int, peso_vivo_total numeric)
language sql
stable
as $$
  select
    coalesce(sum(e.quantidade), 0)::int,
    coalesce(sum(e.quantidade * coalesce(
      (select p.peso_medio_kg from pesagens p
       where p.fazenda_id = any(p_fazenda_ids) and p.categoria_id = e.categoria_id and p.data <= p_data
       order by p.data desc limit 1),
      c.peso_referencia_kg
    )), 0)
  from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data) e
  join categorias_animal c on c.id = e.categoria_id
  where e.quantidade > 0
$$;

-- ---------------------------------------------------------------------
-- fn_relatorio_lotacao_mensal: uma linha por mês do período filtrado,
-- com rebanho médio (integrado dia a dia), peso médio (ponderado dia a
-- dia — não só a última pesagem), área média em Pecuária (reaproveitando
-- fn_area_media_ponderada) e dias_no_mes (pra o frontend poder derivar o
-- resumo do período inteiro ponderando pelos dias de cada mês, mesmo
-- princípio já usado em fn_relatorio_distribuicao_area pra área).
-- ---------------------------------------------------------------------

create or replace function fn_relatorio_lotacao_mensal(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date
) returns table(
  mes int,
  ano int,
  rebanho_medio numeric,
  peso_medio numeric,
  area_media numeric,
  dias_no_mes int
)
language plpgsql
as $$
declare
  v_mes_inicio date := date_trunc('month', p_data_inicio)::date;
  v_mes_fim    date;
  v_janela_ini date;
  v_janela_fim date;
  v_dia        date;
  v_soma_headcount numeric;
  v_soma_peso_vivo numeric;
  v_dias       int;
  v_area_media numeric;
  v_tipo_pecuaria_id uuid;
  v_ind        record;
begin
  select id into v_tipo_pecuaria_id from tipos_uso_area where nome = 'Pecuária';

  while v_mes_inicio <= p_data_fim loop
    v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;
    v_janela_ini := greatest(v_mes_inicio, p_data_inicio);
    v_janela_fim := least(v_mes_fim, p_data_fim);

    v_soma_headcount := 0;
    v_soma_peso_vivo := 0;
    v_dias := 0;

    for v_dia in select generate_series(v_janela_ini, v_janela_fim, interval '1 day')::date
    loop
      select * into v_ind from fn_indicadores_rebanho_dia(p_fazenda_ids, v_dia);
      v_soma_headcount := v_soma_headcount + v_ind.headcount;
      v_soma_peso_vivo := v_soma_peso_vivo + v_ind.peso_vivo_total;
      v_dias := v_dias + 1;
    end loop;

    select coalesce(sum(fn_area_media_ponderada(f.id, v_tipo_pecuaria_id, v_janela_ini, v_janela_fim)), 0)
      into v_area_media
    from unnest(p_fazenda_ids) as f(id);

    return query select
      extract(month from v_mes_inicio)::int,
      extract(year from v_mes_inicio)::int,
      case when v_dias > 0 then round(v_soma_headcount / v_dias, 2) else 0 end,
      case when v_soma_headcount > 0 then round(v_soma_peso_vivo / v_soma_headcount, 2) else null end,
      v_area_media,
      (v_janela_fim - v_janela_ini + 1)::int;

    v_mes_inicio := (v_mes_inicio + interval '1 month')::date;
  end loop;
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 036
-- =====================================================================
