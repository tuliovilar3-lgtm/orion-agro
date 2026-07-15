-- =====================================================================
-- ORION AGRO — Migração 027
--
-- Venda abate passa a exigir peso morto ou rendimento de carcaça. Sem
-- um dos dois, fn_calcular_valores_movimentacao caía no fallback de
-- peso vivo/30 pra calcular a arroba — que embute uma suposição
-- silenciosa de 50% de rendimento. Outros tipos comerciais (compra,
-- venda em pé, consumo/doação) continuam livres pra usar esse
-- fallback quando o rendimento real não é conhecido.
-- =====================================================================

alter table movimentacoes_rebanho
  add constraint ck_venda_abate_peso_morto_ou_rendimento check (
    tipo <> 'VENDA_ABATE' or peso_morto_kg is not null or rendimento_carcaca_pct is not null
  );

-- =====================================================================
-- FIM DA MIGRAÇÃO 027
-- =====================================================================
