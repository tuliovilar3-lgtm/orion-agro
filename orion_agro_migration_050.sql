-- =====================================================================
-- Migração 050 — módulos de domínio + recursos
-- =====================================================================
--
-- Contexto (ver memória de projeto project_multi_tenant_saas): o
-- catálogo de módulos vendidos por conta (conta_modulos, migração 047)
-- era granular por TELA (Fazendas, Movimentações, Pesagens...), mas
-- todas as telas de hoje são sub-partes de um único domínio implícito
-- "Pecuária". Esta migração introduz o conceito de módulo de DOMÍNIO
-- (Pecuária, Agricultura, Máquinas, Clima, Financeiro — só Pecuária
-- tem telas reais hoje) e o de RECURSO — flag independente, combinável
-- livremente, contratado por dentro de um domínio já ativo (ex.:
-- "controle por pasto" dentro de Pecuária). Confirmado com o usuário:
-- "controle por pasto" (hoje configuracoes.controla_pasto, toggle
-- grátis self-service em Fazendas) vira recurso pago — só liberável
-- pelo Suporte, mesmo modelo de Multifazendas/Multiproprietário
-- (conta_limites).
-- =====================================================================

create table conta_recursos (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  dominio    text not null,
  recurso    text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_conta_recurso unique (conta_id, dominio, recurso)
);
alter table conta_recursos enable row level security;
create policy conta_recursos_por_conta on conta_recursos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- ---------------------------------------------------------------------
-- conta_modulos.modulo passa a guardar id de DOMÍNIO em vez de id de
-- TELA — reinterpreta a coluna existente em vez de criar tabela nova,
-- já que só muda a granularidade do valor guardado. Seguro fazer
-- direto (sem coluna de transição) porque só existe uma conta real em
-- produção hoje ("Conta Principal") — mesmo raciocínio de risco já
-- aceito noutras migrações desta base (ex.: 046, 049).
-- ---------------------------------------------------------------------
create temporary table tmp_contas_pecuaria as
  select distinct conta_id from conta_modulos;

delete from conta_modulos;

alter table conta_modulos rename column modulo to dominio;

-- qualquer tela liberada antes implica que a conta "tem" o domínio
-- Pecuária agora (todas as 10 telas do catálogo atual pertencem a esse
-- domínio único)
insert into conta_modulos (conta_id, dominio, ativo)
select conta_id, 'pecuaria', true from tmp_contas_pecuaria;

-- ---------------------------------------------------------------------
-- controle por pasto vira recurso pago — toda conta que já tinha
-- ligado o toggle self-service ganha o recurso de graça aqui, sem
-- perder a funcionalidade que já usava
-- ---------------------------------------------------------------------
insert into conta_recursos (conta_id, dominio, recurso, ativo)
select conta_id, 'pecuaria', 'controle_pasto', true
from configuracoes
where controla_pasto = true;
