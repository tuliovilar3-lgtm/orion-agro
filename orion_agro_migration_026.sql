-- =====================================================================
-- ORION AGRO — Migração 026
--
-- Agrupamento de lançamentos em lote: movimentacoes_rebanho ganha uma
-- coluna grupo_lancamento_id (puramente um id de correlação, sem
-- tabela própria) pra permitir que app/movimentacoes/page.tsx mostre
-- as linhas de um mesmo lote agrupadas numa única listagem e reabra o
-- lote inteiro pra edição, incluindo desconto/acréscimo. Cada linha
-- continua uma movimentação independente pro resto do sistema.
-- =====================================================================

alter table movimentacoes_rebanho add column grupo_lancamento_id uuid;

create index idx_mov_grupo_lancamento on movimentacoes_rebanho(grupo_lancamento_id) where grupo_lancamento_id is not null;

-- =====================================================================
-- FIM DA MIGRAÇÃO 026
-- =====================================================================
