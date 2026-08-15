-- =====================================================================
-- ORION AGRO — Migração 043
-- Modo Consulta: terceiro valor de usuarios_app.modo, pra usuários que
-- só precisam ver relatórios (sem lançar nem editar nada). Reaproveita
-- o mesmo mecanismo de permissão por módulo já existente — Consulta não
-- ganha nenhum bloqueio novo de "somente leitura" dentro das telas, só
-- restringe (no frontend) quais módulos podem ser marcados pra esse
-- modo aos 4 relatórios que já são 100% somente-leitura hoje.
-- =====================================================================

alter table usuarios_app drop constraint if exists usuarios_app_modo_check;
alter table usuarios_app add constraint usuarios_app_modo_check
  check (modo in ('CAMPO', 'GESTAO', 'CONSULTA'));

-- =====================================================================
-- FIM DA MIGRAÇÃO 043
-- =====================================================================
