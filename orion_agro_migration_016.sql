-- =====================================================================
-- ORION AGRO — Migração 016 (correção da 015)
--
-- A tabela grupos_categoria_papel veio com RLS ativado automaticamente
-- pelo Supabase (comportamento padrão mais novo do SQL editor para
-- tabelas criadas via CREATE TABLE), diferente de todas as outras
-- tabelas do projeto, que não têm RLS. Isso fazia a consulta com a
-- anon key (usada pelo app) retornar sempre 0 linhas, mesmo com as 8
-- linhas existindo de fato (confirmado pelos IDs válidos já gravados
-- em categorias_animal.grupo_categoria_papel_id).
-- =====================================================================

alter table grupos_categoria_papel disable row level security;

-- =====================================================================
-- FIM DA MIGRAÇÃO 016
-- =====================================================================
