-- =====================================================================
-- ORION AGRO — Migração 008
-- Incremental sobre o banco já criado. Rode no SQL editor do Supabase.
-- Restrições de plausibilidade biológica e financeira.
-- Já checamos: nenhum lançamento existente viola essas regras.
-- =====================================================================

alter table movimentacoes_rebanho
  add constraint ck_peso_medio_positivo check (peso_medio_kg is null or peso_medio_kg > 0);

alter table movimentacoes_rebanho
  add constraint ck_peso_total_positivo check (peso_total_kg is null or peso_total_kg > 0);

alter table movimentacoes_rebanho
  add constraint ck_peso_morto_positivo check (peso_morto_kg is null or peso_morto_kg > 0);

alter table movimentacoes_rebanho
  add constraint ck_peso_morto_nao_excede_vivo check (
    peso_morto_kg is null or peso_total_kg is null or peso_morto_kg <= peso_total_kg
  );

alter table movimentacoes_rebanho
  add constraint ck_rendimento_carcaca_positivo check (
    rendimento_carcaca_pct is null or rendimento_carcaca_pct > 0
  );

alter table movimentacoes_rebanho
  add constraint ck_valor_arroba_positivo check (valor_arroba is null or valor_arroba > 0);

alter table movimentacoes_rebanho
  add constraint ck_valor_cabeca_positivo check (valor_cabeca is null or valor_cabeca > 0);

alter table movimentacoes_rebanho
  add constraint ck_valor_kg_positivo check (valor_kg is null or valor_kg > 0);

alter table movimentacoes_rebanho
  add constraint ck_valor_total_positivo check (valor_total is null or valor_total > 0);

alter table movimentacoes_rebanho
  add constraint ck_data_nao_futura check (data <= current_date);

-- =====================================================================
-- FIM DA MIGRAÇÃO 008
-- =====================================================================
