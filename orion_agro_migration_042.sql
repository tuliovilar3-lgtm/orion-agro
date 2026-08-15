-- =====================================================================
-- ORION AGRO — Migração 042
-- Modelo de acesso e login (Supabase Auth) — decidido em memória de
-- projeto (permission_model_design): sem perfis/papéis nomeados,
-- permissão direta por usuário → módulo. Dono tem acesso total sem
-- passar por checagem de módulo. Single-tenant (um grupo só).
--
-- RLS continua desligado propositalmente nesta migração — reativar é um
-- passo futuro separado, só depois de login + permissões estarem
-- prontos e testados (ver deployment_roadmap). Enforcement de módulo
-- nesta fase é feito no app (Proxy + client-side), não no banco.
-- =====================================================================

create table usuarios_app (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  dono boolean not null default false,
  ativo boolean not null default true,
  -- 'CAMPO'/'GESTAO': preparado agora pra não exigir migração nova
  -- quando o modo de navegação simplificado (PWA) for implementado —
  -- ainda sem nenhuma tela/rota que leia essa coluna
  modo text not null default 'GESTAO' check (modo in ('CAMPO', 'GESTAO')),
  created_at timestamptz not null default now()
);

comment on table usuarios_app is
  'Dados de app por usuário autenticado (auth.users é só identidade/senha). Um dono por grupo — os demais são funcionários com módulos liberados individualmente.';

-- catálogo de módulos é só uma convenção de string usada pelo frontend
-- (mesmos ids de rota já usados na Sidebar) — sem tabela de módulos
-- própria, igual o modelo já decidido dispensa tabela de perfis
create table usuario_modulos (
  usuario_id uuid not null references usuarios_app(id) on delete cascade,
  modulo text not null,
  primary key (usuario_id, modulo)
);

comment on table usuario_modulos is
  'Um módulo liberado por linha, por usuário — sem perfis/papéis nomeados (decisão em memória permission_model_design). Dono não precisa de linhas aqui: bypassa a checagem inteira.';

-- usada pelo /login (com a chave anônima, antes de qualquer sessão
-- existir) pra decidir entre mostrar o formulário normal de entrar ou o
-- formulário único de "criar conta de dono" — só retorna um boolean,
-- sem expor nenhum dado, então é seguro chamar sem autenticação
create or replace function fn_existe_dono()
returns boolean as $$
  select exists(select 1 from usuarios_app where dono = true);
$$ language sql stable;

-- =====================================================================
-- FIM DA MIGRAÇÃO 042
-- =====================================================================
