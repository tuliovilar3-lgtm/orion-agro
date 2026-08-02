-- =====================================================================
-- ORION AGRO — Migração 037
-- Fase 1 do mapa de fazenda: contorno da propriedade (fazendas) e
-- contorno de cada pasto/talhão (pastos), guardados como GeoJSON.
-- Puramente aditivo — nenhuma tabela existente muda de comportamento;
-- pasto/fazenda sem geometria continuam funcionando exatamente como hoje
-- (geometria é só um jeito alternativo de desenhar, nunca obrigatório —
-- `area_ha` continua podendo ser digitado direto, sem desenhar nada).
-- =====================================================================

alter table fazendas add column geometria jsonb;
alter table pastos add column geometria jsonb;

comment on column fazendas.geometria is
  'Contorno da propriedade (GeoJSON Polygon/MultiPolygon, WGS84) — importado de KML, usado só como referência visual de fundo pra desenhar os pastos por cima. Nunca obrigatório.';
comment on column pastos.geometria is
  'Contorno do pasto/talhão (GeoJSON Polygon/MultiPolygon, WGS84) — desenhado no mapa ou importado de KML casando pelo nome do placemark. Quando presente, a área é calculada a partir dele (mas area_ha continua editável manualmente por cima).';

-- =====================================================================
-- FIM DA MIGRAÇÃO 037
-- =====================================================================
