-- =====================================================================
-- ORION AGRO — Migração 023
--
-- controla_pasto deixa de ser por fazenda e vira uma configuração
-- única pro grupo inteiro — tabela singleton `configuracoes`.
-- =====================================================================

create table configuracoes (
  id              uuid primary key default gen_random_uuid(),
  controla_pasto  boolean not null default false,
  updated_at      timestamptz not null default now()
);
create unique index uq_configuracoes_singleton on configuracoes ((true));
alter table configuracoes disable row level security;

-- preserva o estado atual: liga a config global se QUALQUER fazenda já
-- tinha controla_pasto ligado
insert into configuracoes (controla_pasto)
select coalesce(bool_or(controla_pasto), false) from fazendas;

alter table fazendas drop column controla_pasto;

-- =====================================================================
-- FIM DA MIGRAÇÃO 023
-- =====================================================================
