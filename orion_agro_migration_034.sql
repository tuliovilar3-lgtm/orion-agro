-- =====================================================================
-- ORION AGRO — Migração 034
-- Corrige bug de fan-out (produto cartesiano) em vw_estoque_rebanho:
-- os CTEs entradas/saidas eram juntados só por fazenda_id+categoria_id,
-- sem chave ligando uma linha de entrada a uma de saída — categorias com
-- N lançamentos de entrada e M de saída geravam N×M linhas no join,
-- inflando as somas de sum(quantidade) por um fator multiplicativo.
-- Categorias com poucos lançamentos (ou só de um lado) não sofriam o
-- efeito, o que explica por que só algumas ficavam com saldo errado.
-- Correção: agregar entradas e saidas cada uma com seu próprio group by
-- ANTES de juntar com fazenda/categoria, tornando o join 1:1.
-- =====================================================================

create or replace view vw_estoque_rebanho as
with entradas as (
  select fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL')
  union all
  select fazenda_destino_id as fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_destino_id as categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo in ('MUDANCA_CATEGORIA', 'DESMAME')
),
saidas as (
  select fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME')
  union all
  select fazenda_origem_id as fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo = 'MUDANCA_CATEGORIA'
),
entradas_agg as (
  select fazenda_id, categoria_id, sum(quantidade) as total
  from entradas
  group by fazenda_id, categoria_id
),
saidas_agg as (
  select fazenda_id, categoria_id, sum(quantidade) as total
  from saidas
  group by fazenda_id, categoria_id
)
select
  f.id as fazenda_id,
  f.nome as fazenda_nome,
  c.id as categoria_id,
  c.nome as categoria_nome,
  coalesce(e.total, 0) - coalesce(s.total, 0) as saldo_atual
from fazendas f
cross join categorias_animal c
left join entradas_agg e on e.fazenda_id = f.id and e.categoria_id = c.id
left join saidas_agg s on s.fazenda_id = f.id and s.categoria_id = c.id
where c.ativa = true and f.ativo = true;

-- =====================================================================
-- FIM DA MIGRAÇÃO 034
-- =====================================================================
