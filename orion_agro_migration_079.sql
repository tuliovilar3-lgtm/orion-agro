-- Migração 079: corrige "column reference is ambiguous" em fn_resumo_rebanho_atual
--
-- Bug real encontrado ao testar a migração 078: `returns table(fazenda_id uuid, categoria_id
-- uuid, ..., quantidade integer, peso_medio_kg numeric)` faz o PL/pgSQL criar automaticamente
-- variáveis de saída com esses mesmos nomes, visíveis em toda a função — e as consultas novas da
-- migração 078 referenciavam `fazenda_id`/`categoria_id`/etc. sem indicar de qual tabela,
-- deixando ambíguo se era a coluna ou a variável de saída. `fn_indicadores_rebanho_dia` não teve
-- esse problema porque é `language sql` (sem variáveis de PL/pgSQL) e suas colunas de saída
-- (`headcount`/`peso_vivo_total`) não colidem com nenhum nome de coluna usado internamente.
--
-- Correção: qualifica toda referência com o alias da tabela (m., d., s., p., ...) dentro de
-- fn_resumo_rebanho_atual — mesma lógica da migração 078, só que sem a ambiguidade.

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
    select m.fazenda_id, m.pasto_id, m.categoria_id, m.quantidade as delta
    from movimentacoes_rebanho m
    where m.tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and m.data <= current_date
    union all
    select m.fazenda_destino_id, m.pasto_destino_id, m.categoria_id, m.quantidade
    from movimentacoes_rebanho m
    where m.tipo = 'TRANSFERENCIA' and m.data <= current_date
    union all
    select m.fazenda_id, m.pasto_id, m.categoria_destino_id, m.quantidade
    from movimentacoes_rebanho m
    where m.tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and m.data <= current_date
    union all
    select m.fazenda_id, m.pasto_destino_id, m.categoria_id, m.quantidade
    from movimentacoes_rebanho m
    where m.tipo = 'MUDANCA_PASTO' and m.data <= current_date
    union all
    select m.fazenda_id, m.pasto_id, m.categoria_id, -m.quantidade
    from movimentacoes_rebanho m
    where m.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and m.data <= current_date
    union all
    select m.fazenda_origem_id, m.pasto_id, m.categoria_id, -m.quantidade
    from movimentacoes_rebanho m
    where m.tipo = 'TRANSFERENCIA' and m.data <= current_date
    union all
    select m.fazenda_id, m.pasto_id, m.categoria_id, -m.quantidade
    from movimentacoes_rebanho m
    where m.tipo = 'MUDANCA_CATEGORIA' and m.data <= current_date
    union all
    select m.fazenda_id, m.pasto_id, m.categoria_id, -m.quantidade
    from movimentacoes_rebanho m
    where m.tipo = 'MUDANCA_PASTO' and m.data <= current_date
  ),
  saldo_pasto_categoria as (
    select d.fazenda_id, d.pasto_id, d.categoria_id, sum(d.delta) as quantidade
    from deltas d
    where p_fazenda_ids is null or d.fazenda_id = any(p_fazenda_ids)
    group by d.fazenda_id, d.pasto_id, d.categoria_id
    having sum(d.delta) > 0
  ),
  peso_pasto as (
    select distinct on (p.pasto_id, p.categoria_id) p.pasto_id, p.categoria_id, p.peso_medio_kg
    from pesagens p
    where (p_fazenda_ids is null or p.fazenda_id = any(p_fazenda_ids)) and p.data <= current_date
    order by p.pasto_id, p.categoria_id, p.data desc, p.created_at desc
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
