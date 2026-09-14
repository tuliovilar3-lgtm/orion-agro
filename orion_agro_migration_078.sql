-- Migração 078: peso médio por fazenda vira média ponderada ENTRE TODOS OS PASTOS
--
-- Achado ao testar a correção de performance do Relatório de Lotação (migração 077): o peso
-- médio de uma categoria numa fazenda (usado no Painel — fn_resumo_rebanho_atual — e no
-- Relatório de Lotação/Relatórios Financeiros — fn_indicadores_rebanho_dia) nunca foi de fato
-- ponderado entre os pastos — pegava só "a pesagem mais recente pra essa fazenda+categoria",
-- que existe **uma vez por pasto** (cada pasto tem sua própria pesagem compilada), escolhendo
-- uma delas de forma arbitrária, sem considerar de qual pasto ela vem nem quantos animais
-- aquele pasto específico tem. Confirmado com dado real: um mesmo dia mostrava peso médio de
-- 498 kg dessa forma, contra 399 kg quando ponderado corretamente pelos pastos — uma diferença
-- de ~25%, puxada por um único pasto "pesado" sendo tratado como se representasse a fazenda
-- inteira.
--
-- Correção: soma, por categoria, quantidade × peso de CADA pasto (mesma resolução por pasto já
-- usada em fn_relatorio_rebanho_por_pasto) e divide pela quantidade total — numa consulta só,
-- em lote (sem chamar função por pasto), pra continuar rápido mesmo com centenas de pastos.
-- Peso médio continua sem filtro de proprietário (resolvido pelo headcount TOTAL da categoria,
-- nunca o filtrado), mesmo princípio já documentado antes desta migração.

-- ---------------------------------------------------------------------
-- 1) fn_resumo_rebanho_atual (Painel)
-- ---------------------------------------------------------------------
create or replace function fn_resumo_rebanho_atual(p_fazenda_ids uuid[])
returns table(
  fazenda_id uuid,
  categoria_id uuid,
  categoria_nome text,
  grupo_nome text,
  sexo sexo_categoria,
  quantidade integer,
  peso_medio_kg numeric
)
language plpgsql
stable
as $$
begin
  return query
  with deltas as (
    select fazenda_id, pasto_id, categoria_id, quantidade as delta
    from movimentacoes_rebanho
    where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= current_date
    union all
    select fazenda_destino_id, pasto_destino_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= current_date
    union all
    select fazenda_id, pasto_id, categoria_destino_id, quantidade
    from movimentacoes_rebanho
    where tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= current_date
    union all
    select fazenda_id, pasto_destino_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where tipo = 'MUDANCA_PASTO' and data <= current_date
    union all
    select fazenda_id, pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= current_date
    union all
    select fazenda_origem_id, pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= current_date
    union all
    select fazenda_id, pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where tipo = 'MUDANCA_CATEGORIA' and data <= current_date
    union all
    select fazenda_id, pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where tipo = 'MUDANCA_PASTO' and data <= current_date
  ),
  saldo_pasto_categoria as (
    select fazenda_id, pasto_id, categoria_id, sum(delta) as quantidade
    from deltas
    where p_fazenda_ids is null or fazenda_id = any(p_fazenda_ids)
    group by fazenda_id, pasto_id, categoria_id
    having sum(delta) > 0
  ),
  peso_pasto as (
    select distinct on (pasto_id, categoria_id) pasto_id, categoria_id, peso_medio_kg
    from pesagens
    where (p_fazenda_ids is null or fazenda_id = any(p_fazenda_ids)) and data <= current_date
    order by pasto_id, categoria_id, data desc, created_at desc
  ),
  peso_agregado as (
    select
      s.fazenda_id,
      s.categoria_id,
      sum(s.quantidade * coalesce(pp.peso_medio_kg, c.peso_referencia_kg)) / nullif(sum(s.quantidade), 0) as peso_medio
    from saldo_pasto_categoria s
    join categorias_animal c on c.id = s.categoria_id
    left join peso_pasto pp on pp.pasto_id = s.pasto_id and pp.categoria_id = s.categoria_id
    group by s.fazenda_id, s.categoria_id
  )
  select
    e.fazenda_id,
    e.categoria_id,
    e.categoria_nome,
    g.nome as grupo_nome,
    c.sexo,
    e.saldo_atual::int as quantidade,
    coalesce(round(pa.peso_medio, 2), c.peso_referencia_kg) as peso_medio_kg
  from vw_estoque_rebanho e
  join categorias_animal c on c.id = e.categoria_id
  join grupos_categoria g on g.id = c.grupo_id
  left join peso_agregado pa on pa.fazenda_id = e.fazenda_id and pa.categoria_id = e.categoria_id
  where e.saldo_atual > 0
    and (p_fazenda_ids is null or e.fazenda_id = any(p_fazenda_ids));
end;
$$;

-- ---------------------------------------------------------------------
-- 2) fn_indicadores_rebanho_dia (Relatório de Lotação + Relatórios Financeiros)
-- ---------------------------------------------------------------------
create or replace function fn_indicadores_rebanho_dia(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(headcount int, peso_vivo_total numeric)
language sql
stable
as $$
  with deltas as (
    select pasto_id, categoria_id, quantidade as delta
    from movimentacoes_rebanho
    where fazenda_id = any(p_fazenda_ids) and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select pasto_destino_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where fazenda_destino_id = any(p_fazenda_ids) and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select pasto_id, categoria_destino_id, quantidade
    from movimentacoes_rebanho
    where fazenda_id = any(p_fazenda_ids) and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
    union all
    select pasto_destino_id, categoria_id, quantidade
    from movimentacoes_rebanho
    where fazenda_id = any(p_fazenda_ids) and tipo = 'MUDANCA_PASTO' and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_id = any(p_fazenda_ids) and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_origem_id = any(p_fazenda_ids) and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_id = any(p_fazenda_ids) and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
    union all
    select pasto_id, categoria_id, -quantidade
    from movimentacoes_rebanho
    where fazenda_id = any(p_fazenda_ids) and tipo = 'MUDANCA_PASTO' and data <= p_data
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
    where fazenda_id = any(p_fazenda_ids) and data <= p_data
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
