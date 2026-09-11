-- Migração 062: estende fn_estoque_rebanho_na_data / fn_indicadores_rebanho_dia /
-- fn_relatorio_lotacao_mensal com um parâmetro opcional p_proprietario_ids
-- (default null = sem filtro, comportamento idêntico ao de antes pra
-- todo chamador já existente — Relatório de Lotação, Painel, etc.) —
-- preparação pros novos Relatórios Financeiros (Desembolso R$/cab./mês
-- e R$/@ Produzida), que precisam do rebanho médio/peso vivo filtrado
-- por proprietário além de por fazenda.
--
-- Mesmo princípio já usado em fn_saldo_categoria_proprietario (migração
-- 044): a condição "proprietario_id = any(p_proprietario_ids)" nunca
-- bate com null, então Mudança de Categoria/Desmame (que nunca têm
-- proprietario_id preenchido) ficam de fora automaticamente quando o
-- filtro está ativo — mesmo comportamento já aceito e documentado pro
-- resto do sistema, sem precisar de caso especial aqui.
--
-- create or replace function pode adicionar um parâmetro novo no fim da
-- lista, com default, sem precisar de drop function (só muda o retorno
-- ou a ordem/tipo de parâmetros já existentes que exige isso).

create or replace function fn_estoque_rebanho_na_data(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(categoria_id uuid, quantidade int)
language sql
stable
as $$
  with entradas as (
    select fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select fazenda_destino_id as fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select fazenda_id, categoria_destino_id as categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
  ),
  saidas as (
    select fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select fazenda_origem_id as fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo = 'MUDANCA_CATEGORIA' and data <= p_data
  ),
  entradas_agg as (
    select categoria_id, sum(quantidade) as total
    from entradas
    where fazenda_id = any(p_fazenda_ids)
      and (p_proprietario_ids is null or proprietario_id = any(p_proprietario_ids))
    group by categoria_id
  ),
  saidas_agg as (
    select categoria_id, sum(quantidade) as total
    from saidas
    where fazenda_id = any(p_fazenda_ids)
      and (p_proprietario_ids is null or proprietario_id = any(p_proprietario_ids))
    group by categoria_id
  )
  select
    c.id,
    (coalesce(e.total, 0) - coalesce(s.total, 0))::int
  from categorias_animal c
  left join entradas_agg e on e.categoria_id = c.id
  left join saidas_agg s on s.categoria_id = c.id
$$;

create or replace function fn_indicadores_rebanho_dia(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
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
  from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data, p_proprietario_ids) e
  join categorias_animal c on c.id = e.categoria_id
  where e.quantidade > 0
$$;

create or replace function fn_relatorio_lotacao_mensal(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date,
  p_proprietario_ids uuid[] default null
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
      select * into v_ind from fn_indicadores_rebanho_dia(p_fazenda_ids, v_dia, p_proprietario_ids);
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
