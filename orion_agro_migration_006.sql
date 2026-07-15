-- =====================================================================
-- ORION AGRO — Migração 006
-- Incremental sobre o banco já criado. Rode no SQL editor do Supabase.
-- Já checamos: nenhuma categoria existente usa sexo = 'MISTO', então
-- essa constraint não quebra nada hoje.
-- =====================================================================

alter table categorias_animal
  add constraint ck_sexo_categoria_obrigatorio check (sexo in ('MACHO', 'FEMEA'));

-- =====================================================================
-- FIM DA MIGRAÇÃO 006
-- =====================================================================
