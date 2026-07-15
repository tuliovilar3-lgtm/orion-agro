-- =====================================================================
-- ORION AGRO — Migração 004
-- Incremental sobre o banco já criado. Rode no SQL editor do Supabase.
-- =====================================================================

-- DESMAME passa a exigir categoria_destino_id (a categoria jovem para
-- a qual o bezerro evolui após o desmame), igual MUDANCA_CATEGORIA já
-- exigia. Já checamos: não há lançamento de DESMAME existente, então
-- não há dado que viole essa regra.
alter table movimentacoes_rebanho drop constraint ck_categoria_destino;

alter table movimentacoes_rebanho add constraint ck_categoria_destino check (
  (tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and categoria_destino_id is not null
     and categoria_destino_id <> categoria_id)
  or
  (tipo not in ('MUDANCA_CATEGORIA', 'DESMAME') and categoria_destino_id is null)
);

-- view de estoque: DESMAME agora soma entrada na categoria destino
-- (a saída da categoria origem já estava correta antes)
create or replace view vw_estoque_rebanho as
with entradas as (
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo in ('NASCIMENTO', 'COMPRA')
  union all
  select fazenda_destino_id as fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_destino_id as categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo in ('MUDANCA_CATEGORIA', 'DESMAME')
),
saidas as (
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME')
  union all
  select fazenda_origem_id as fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'MUDANCA_CATEGORIA'
)
select
  f.id as fazenda_id,
  f.nome as fazenda_nome,
  c.id as categoria_id,
  c.nome as categoria_nome,
  coalesce(sum(e.quantidade), 0) - coalesce(sum(s.quantidade), 0) as saldo_atual
from fazendas f
cross join categorias_animal c
left join entradas e on e.fazenda_id = f.id and e.categoria_id = c.id
left join saidas s on s.fazenda_id = f.id and s.categoria_id = c.id
where c.ativa = true and f.ativo = true
group by f.id, f.nome, c.id, c.nome;

-- =====================================================================
-- FIM DA MIGRAÇÃO 004
-- =====================================================================
