-- =====================================================================
-- ORION AGRO — Migração 018
-- Rode esta migração SOZINHA, numa execução separada da migração 019.
-- O Postgres não permite usar um valor de enum recém-adicionado (em
-- constraints, funções etc.) na mesma transação em que ele foi criado.
--
-- Controle de rebanho por pasto (opt-in via fazendas.controla_pasto) —
-- este novo tipo é usado só pra mover animais de um pasto pra outro
-- sem mudar categoria.
-- =====================================================================

alter type tipo_movimentacao add value 'MUDANCA_PASTO';

-- =====================================================================
-- FIM DA MIGRAÇÃO 018 — rode a 019 numa nova execução, depois desta
-- =====================================================================
