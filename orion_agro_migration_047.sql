-- =====================================================================
-- Migração 047 — Fase 2 do multi-tenant: módulos e limites por conta
-- =====================================================================
--
-- Contexto (ver memória de projeto project_multi_tenant_saas e a Fase 1
-- na migração 046): agora que os dados já são isolados por conta_id +
-- RLS, esta fase introduz o mecanismo de venda avulsa de módulo —
-- `conta_modulos` é a fonte da verdade de quais módulos uma conta
-- contratou (não uma tabela de planos fixos: cada módulo pode ser
-- vendido individualmente, confirmado com o usuário). `conta_limites`
-- é uma tabela genérica pra limites numéricos que não são "tela que
-- aparece/some" — hoje cobre Multifazendas (quantas fazendas a conta
-- pode cadastrar) e Multiproprietário (quantas pessoas podem ter o
-- papel PROPRIETARIO), mas o desenho é genérico o bastante pra
-- comportar outros limites futuros (ex.: nº de usuários) sem migração
-- nova de schema.
--
-- Permissão final de módulo (checada só no frontend, em
-- contexts/AuthContext.tsx): conta_modulos ∩ usuario_modulos — mesmo o
-- dono da conta não vê um módulo que a própria conta não contratou.
--
-- Ausência de linha em conta_limites pra um tipo_limite = sem limite
-- (ilimitado) — decisão deliberada pra não exigir nenhum seed pra
-- contas com uso irrestrito. Por isso a "Conta Principal" (usuário
-- atual) não ganha nenhuma linha em conta_limites nesta migração.
--
-- conta_modulos, ao contrário, PRECISA de seed pra "Conta Principal":
-- sem isso, a interseção conta_modulos ∩ usuario_modulos daria vazio e
-- o usuário atual perderia acesso a tudo. Contas novas (Fase 4 em
-- diante) nascem de propósito SEM nenhuma linha em conta_modulos —
-- módulo vendido avulso precisa ser atribuído explicitamente, sem
-- "grandfather clause" nenhuma pra quem ainda não comprou nada.
-- =====================================================================

create table conta_modulos (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  modulo     text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_conta_modulo unique (conta_id, modulo)
);
alter table conta_modulos enable row level security;
create policy conta_modulos_por_conta on conta_modulos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table conta_limites (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  tipo_limite text not null,
  valor      int not null check (valor >= 0),
  created_at timestamptz not null default now(),
  constraint uq_conta_limite unique (conta_id, tipo_limite)
);
alter table conta_limites enable row level security;
create policy conta_limites_por_conta on conta_limites for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- seed: "Conta Principal" ganha todos os módulos do catálogo atual
-- liberados (lib/modulos.ts) — grandfather clause só pra esta conta
-- específica, que já usava o sistema inteiro antes de módulos por
-- plano existirem.
insert into conta_modulos (conta_id, modulo)
select c.id, m.modulo
from contas c
cross join (values
  ('fazendas'), ('categorias'), ('pessoas'), ('movimentacoes'), ('pesagens'),
  ('resumo_movimentacao'), ('relatorios_movimentacoes'), ('relatorio_lotacao'),
  ('mudanca_pasto'), ('rebanho_por_pasto')
) as m(modulo)
where c.nome = 'Conta Principal';
