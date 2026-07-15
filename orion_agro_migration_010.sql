-- =====================================================================
-- ORION AGRO — Migração 010
-- Rode esta migração SOZINHA, numa execução separada da migração 011.
-- O Postgres não permite usar um valor de enum recém-adicionado (em
-- constraints, funções etc.) na mesma transação em que ele foi criado.
-- =====================================================================

alter type tipo_movimentacao add value 'SALDO_INICIAL';
alter type tipo_movimentacao add value 'AJUSTE_ESTOQUE';

create type direcao_ajuste as enum ('ENTRADA', 'SAIDA');

-- =====================================================================
-- FIM DA MIGRAÇÃO 010 — rode a 011 numa nova execução, depois desta
-- =====================================================================
