-- Migração 080: elimina o custo de RLS repetido no Relatório de Lotação (SECURITY DEFINER
-- validado)
--
-- Depois da migração 077 (reavaliar só em pontos de mudança, não dia a dia), o Relatório de
-- Lotação ainda dá "canceling statement due to statement timeout" pra períodos com bastante
-- atividade histórica (ex.: uma safra fechada, com dados reais carregados em massa — 256 datas
-- distintas de movimentação num só ano). Medido: a mesma consulta roda em ~1,6s com a chave de
-- serviço (que ignora RLS) e passa de 9s (estourando o limite) na sessão real de um usuário
-- (sujeita a RLS). Causa: cada uma das ~256 reavaliações relê o histórico inteiro, e o Postgres
-- reavalia a política de RLS (comparação de `conta_id`) em CADA LINHA lida, em CADA uma dessas
-- 256 vezes — um custo que se multiplica, mesmo cada reavaliação sendo rápida sozinha.
--
-- Correção: as 3 funções do caminho crítico (fn_relatorio_lotacao_mensal → fn_indicadores_rebanho_dia →
-- fn_estoque_rebanho_na_data) passam a ser SECURITY DEFINER (mesmo mecanismo já usado em
-- fn_conta_atual() desde a Fase 1 multi-tenant) — o dono da função tem acesso de tabela direto,
-- sem RLS reavaliada linha a linha. Como isso desliga a proteção automática de RLS, cada uma
-- das 3 funções valida explicitamente, ela mesma (defesa em profundidade — nenhuma confia que
-- quem a chamou já validou), que toda fazenda em `p_fazenda_ids` pertence à conta do usuário
-- logado (`fazendas.conta_id = fn_conta_atual()`) antes de tocar em qualquer dado — do contrário
-- alguém poderia chamar a função via RPC direto com o id de fazenda de outra conta e enxergar
-- dado alheio, exatamente o que a RLS original impedia.

-- ---------------------------------------------------------------------
-- 1) fn_estoque_rebanho_na_data
-- ---------------------------------------------------------------------
create or replace function fn_estoque_rebanho_na_data(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(categoria_id uuid, quantidade int)
language sql
security definer
set search_path = public
stable
as $$
  with fazendas_validas as (
    select f.id from fazendas f where f.id = any(p_fazenda_ids) and f.conta_id = fn_conta_atual()
  ),
  entradas as (
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
    where fazenda_id in (select id from fazendas_validas)
      and (p_proprietario_ids is null or proprietario_id = any(p_proprietario_ids))
    group by categoria_id
  ),
  saidas_agg as (
    select categoria_id, sum(quantidade) as total
    from saidas
    where fazenda_id in (select id from fazendas_validas)
      and (p_proprietario_ids is null or proprietario_id = any(p_proprietario_ids))
    group by categoria_id
  )
  select
    c.id,
    (coalesce(e.total, 0) - coalesce(s.total, 0))::int
  from categorias_animal c
  left join entradas_agg e on e.categoria_id = c.id
  left join saidas_agg s on s.categoria_id = c.id
  where c.conta_id = fn_conta_atual()
$$;

-- ---------------------------------------------------------------------
-- 2) fn_indicadores_rebanho_dia
-- ---------------------------------------------------------------------
create or replace function fn_indicadores_rebanho_dia(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(headcount int, peso_vivo_total numeric)
language sql
security definer
set search_path = public
stable
as $$
  with fazendas_validas as (
    select f.id from fazendas f where f.id = any(p_fazenda_ids) and f.conta_id = fn_conta_atual()
  ),
  deltas as (
    select pasto_id, categoria_id, quantidade as delta
    from movimentacoes_rebanho
    where fazenda_id in (select id from fazendas_validas) and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select pasto_destino_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where fazenda_destino_id in (select id from fazendas_validas) and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select pasto_id, categoria_destino_id, quantidade
    from movimentacoes_rebanho
    where fazenda_id in (select id from fazendas_validas) and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
    union all
    select pasto_destino_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where fazenda_id in (select id from fazendas_validas) and tipo = 'MUDANCA_PASTO' and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_id in (select id from fazendas_validas) and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_origem_id in (select id from fazendas_validas) and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_id in (select id from fazendas_validas) and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_id in (select id from fazendas_validas) and tipo = 'MUDANCA_PASTO' and data <= p_data
  ),
  saldo_pasto_categoria as (
    select pasto_id, categoria_id, sum(delta) as quantidade
    from deltas
    group by pasto_id, categoria_id
    having sum(delta) > 0
  ),
  peso_pasto as (
    select distinct on (pasto_id, categoria_id) pasto_id, categoria_id, peso_medio_kg
    from pesagens
    where fazenda_id in (select id from fazendas_validas) and data <= p_data
    order by pasto_id, categoria_id, data desc, created_at desc
  ),
  peso_agregado_categoria as (
    select
      s.categoria_id,
      sum(s.quantidade * coalesce(pp.peso_medio_kg, c.peso_referencia_kg)) / nullif(sum(s.quantidade), 0) as peso_medio
    from saldo_pasto_categoria s
    join categorias_animal c on c.id = s.categoria_id
    left join peso_pasto pp on pp.pasto_id = s.pasto_id and pp.categoria_id = s.categoria_id
    group by s.categoria_id
  )
  select
    coalesce(sum(e.quantidade), 0)::int,
    coalesce(sum(e.quantidade * coalesce(pac.peso_medio, c.peso_referencia_kg)), 0)
  from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data, p_proprietario_ids) e
  join categorias_animal c on c.id = e.categoria_id
  left join peso_agregado_categoria pac on pac.categoria_id = e.categoria_id
  where e.quantidade > 0
$$;

-- ---------------------------------------------------------------------
-- 3) fn_relatorio_lotacao_mensal — mesmas 2 consultas de "pontos de mudança" (migração 077)
-- passam a ler só das fazendas validadas.
-- ---------------------------------------------------------------------
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
security definer
set search_path = public
as $$
declare
  v_fazenda_ids_seguro uuid[];
  v_mes_inicio date;
  v_mes_fim    date;
  v_janela_ini date;
  v_janela_fim date;
  v_soma_headcount numeric;
  v_soma_peso_vivo numeric;
  v_dias       int;
  v_area_media numeric;
  v_tipo_pecuaria_id uuid;
  v_ind        record;
  v_pontos     date[];
  v_ponto      date;
  v_fim_intervalo   date;
  v_dias_intervalo  int;
  i int;
begin
  select array_agg(f.id) into v_fazenda_ids_seguro
  from fazendas f
  where f.id = any(p_fazenda_ids) and f.conta_id = fn_conta_atual();

  select id into v_tipo_pecuaria_id from tipos_uso_area where nome = 'Pecuária';
  v_mes_inicio := date_trunc('month', p_data_inicio)::date;

  while v_mes_inicio <= p_data_fim loop
    v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;
    v_janela_ini := greatest(v_mes_inicio, p_data_inicio);
    v_janela_fim := least(v_mes_fim, p_data_fim);

    select array_agg(distinct d order by d) into v_pontos
    from (
      select v_janela_ini as d
      union
      select data from movimentacoes_rebanho
      where data between v_janela_ini and v_janela_fim
        and (
          (fazenda_id = any(v_fazenda_ids_seguro)
            and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL', 'MUDANCA_CATEGORIA', 'DESMAME',
                         'MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO'))
          or (fazenda_origem_id = any(v_fazenda_ids_seguro) and tipo = 'TRANSFERENCIA')
          or (fazenda_destino_id = any(v_fazenda_ids_seguro) and tipo = 'TRANSFERENCIA')
        )
      union
      select data from pesagens
      where fazenda_id = any(v_fazenda_ids_seguro) and data between v_janela_ini and v_janela_fim
    ) x;

    v_soma_headcount := 0;
    v_soma_peso_vivo := 0;
    v_dias := 0;

    for i in 1 .. array_length(v_pontos, 1) loop
      v_ponto := v_pontos[i];
      v_fim_intervalo := case when i < array_length(v_pontos, 1) then v_pontos[i + 1] - 1 else v_janela_fim end;
      v_dias_intervalo := v_fim_intervalo - v_ponto + 1;
      if v_dias_intervalo > 0 then
        select * into v_ind from fn_indicadores_rebanho_dia(v_fazenda_ids_seguro, v_ponto, p_proprietario_ids);
        v_soma_headcount := v_soma_headcount + v_ind.headcount * v_dias_intervalo;
        v_soma_peso_vivo := v_soma_peso_vivo + v_ind.peso_vivo_total * v_dias_intervalo;
        v_dias := v_dias + v_dias_intervalo;
      end if;
    end loop;

    select coalesce(sum(fn_area_media_ponderada(f.id, v_tipo_pecuaria_id, v_janela_ini, v_janela_fim)), 0)
      into v_area_media
    from unnest(v_fazenda_ids_seguro) as f(id);

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
