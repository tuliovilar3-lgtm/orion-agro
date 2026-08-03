-- =====================================================================
-- ORION AGRO — Migração 041
-- Cor customizada por pasto (opcional) — hoje todos os pastos de um
-- mesmo módulo compartilham a mesma cor automática no mapa
-- (corCategorica por módulo), dificultando distinguir pastos vizinhos
-- num módulo com muitos pastos. Quando nula, o frontend continua
-- caindo pra cor automática do módulo — nenhuma mudança de
-- comportamento pros pastos que nunca tiverem cor escolhida.
-- =====================================================================

alter table pastos add column cor text;
comment on column pastos.cor is
  'Cor customizada do pasto no mapa (hex, ex. #1C8C7C) — quando nula, usa a cor automática do módulo.';

-- =====================================================================
-- FIM DA MIGRAÇÃO 041
-- =====================================================================
