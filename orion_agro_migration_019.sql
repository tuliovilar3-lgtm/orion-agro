-- =====================================================================
-- ORION AGRO — Migração 019
-- Rode DEPOIS da migração 018 (precisa do valor 'MUDANCA_PASTO' já
-- comitado em tipo_movimentacao).
--
-- Controle de rebanho por pasto (opt-in via fazendas.controla_pasto):
-- toggle na fazenda, hierarquia módulo > pasto/talhão (só PECUARIA
-- liberado por enquanto), módulo+pasto "Geral" automático em toda
-- fazenda (trigger pra fazendas novas + backfill pras existentes),
-- validação da soma das áreas dos pastos contra a área de Pecuária,
-- e as colunas pasto_id/pasto_destino_id em movimentacoes_rebanho
-- (com backfill dos lançamentos existentes apontando pro pasto
-- "Geral" da fazenda de cada um).
-- =====================================================================

alter table fazendas
  add column controla_pasto boolean not null default false;

comment on column fazendas.controla_pasto is
  'Opt-in pro controle de rebanho por pasto. Se falso, a fazenda usa só o módulo/pasto "Geral" (que sempre existe, mesmo com controla_pasto=false) e a UI de módulos/pastos fica escondida. Ligar depois não precisa de migração de dados — o "Geral" já existe desde a criação da fazenda.';

create type tipo_utilizacao_modulo as enum ('PECUARIA', 'AGRICULTURA');

create table modulos (
  id              uuid primary key default gen_random_uuid(),
  fazenda_id      uuid not null references fazendas(id),
  nome            text not null,
  tipo_utilizacao tipo_utilizacao_modulo not null default 'PECUARIA',
  ativo           boolean not null default true,
  ordem           int not null default 0,
  created_at      timestamptz not null default now(),
  constraint uq_modulo_nome_fazenda unique (fazenda_id, nome),
  -- só PECUARIA por enquanto — AGRICULTURA fica reservado no enum pra
  -- não precisar de migração de schema quando talhão for implementado
  constraint ck_modulo_tipo_utilizacao check (tipo_utilizacao = 'PECUARIA')
);
alter table modulos disable row level security;

create table pastos (
  id              uuid primary key default gen_random_uuid(),
  modulo_id       uuid not null references modulos(id),
  nome            text not null,
  -- livre (sem histórico por data, diferente de movimentacoes_area) —
  -- validado contra a área de Pecuária no momento do cadastro/edição,
  -- não reconciliado retroativamente se a área de Pecuária encolher
  -- depois (ver fn_validar_area_pasto)
  area_ha         numeric(12,2),
  ativo           boolean not null default true,
  ordem           int not null default 0,
  created_at      timestamptz not null default now(),
  constraint uq_pasto_nome_modulo unique (modulo_id, nome)
);
alter table pastos disable row level security;

-- toda fazenda nova já ganha módulo + pasto "Geral" automaticamente —
-- fazenda que não liga controla_pasto nunca vê essa tela, mas todo
-- lançamento de rebanho sempre tem pra onde apontar
create or replace function fn_criar_modulo_pasto_geral()
returns trigger as $$
declare
  v_modulo_id uuid;
begin
  insert into modulos (fazenda_id, nome, tipo_utilizacao, ordem)
  values (new.id, 'Geral', 'PECUARIA', 0)
  returning id into v_modulo_id;

  insert into pastos (modulo_id, nome, ordem)
  values (v_modulo_id, 'Geral', 0);

  return new;
end;
$$ language plpgsql;

create trigger trg_criar_modulo_pasto_geral
after insert on fazendas
for each row execute function fn_criar_modulo_pasto_geral();

-- backfill: fazendas que já existiam antes desta migração não passaram
-- pelo trigger acima (ele só roda em INSERT daqui pra frente)
insert into modulos (fazenda_id, nome, tipo_utilizacao, ordem)
select f.id, 'Geral', 'PECUARIA', 0
from fazendas f
where not exists (select 1 from modulos m where m.fazenda_id = f.id and m.nome = 'Geral');

insert into pastos (modulo_id, nome, ordem)
select m.id, 'Geral', 0
from modulos m
where m.nome = 'Geral'
  and not exists (select 1 from pastos p where p.modulo_id = m.id and p.nome = 'Geral');

-- soma das áreas de todos os pastos da fazenda não pode ultrapassar a
-- área alocada em "Pecuária" (fn_area_por_uso na data de hoje — opção
-- simples combinada com o usuário, sem histórico por data no pasto)
create or replace function fn_validar_area_pasto()
returns trigger as $$
declare
  v_fazenda_id       uuid;
  v_tipo_pecuaria_id uuid;
  v_area_pecuaria    numeric;
  v_soma_pastos      numeric;
begin
  select fazenda_id into v_fazenda_id from modulos where id = new.modulo_id;
  select id into v_tipo_pecuaria_id from tipos_uso_area where nome = 'Pecuária';
  v_area_pecuaria := fn_area_por_uso(v_fazenda_id, v_tipo_pecuaria_id, current_date);

  select coalesce(sum(p.area_ha), 0) into v_soma_pastos
  from pastos p
  join modulos m on m.id = p.modulo_id
  where m.fazenda_id = v_fazenda_id and p.id <> new.id;

  v_soma_pastos := v_soma_pastos + coalesce(new.area_ha, 0);

  if v_soma_pastos > v_area_pecuaria then
    raise exception 'A soma das áreas dos pastos (% ha) ultrapassaria a área alocada em Pecuária (% ha).',
      v_soma_pastos, v_area_pecuaria;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_area_pasto
before insert or update on pastos
for each row execute function fn_validar_area_pasto();

-- ---------------------------------------------------------------------
-- pasto_id / pasto_destino_id em movimentacoes_rebanho
-- ---------------------------------------------------------------------

alter table movimentacoes_rebanho
  add column pasto_id uuid references pastos(id),
  add column pasto_destino_id uuid references pastos(id);

-- backfill: todo lançamento existente aponta pro pasto "Geral" da sua
-- fazenda (mr.fazenda_id — em TRANSFERENCIA isso é a fazenda de
-- origem, ver payload.fazenda_id = fazendaOrigemId no frontend)
update movimentacoes_rebanho mr
set pasto_id = p.id
from modulos m
join pastos p on p.modulo_id = m.id and p.nome = 'Geral'
where m.fazenda_id = mr.fazenda_id
  and m.nome = 'Geral'
  and mr.pasto_id is null;

-- TRANSFERENCIA também recebe o pasto de destino, com base no "Geral"
-- da fazenda de destino
update movimentacoes_rebanho mr
set pasto_destino_id = p.id
from modulos m
join pastos p on p.modulo_id = m.id and p.nome = 'Geral'
where mr.tipo = 'TRANSFERENCIA'
  and m.fazenda_id = mr.fazenda_destino_id
  and m.nome = 'Geral';

alter table movimentacoes_rebanho
  alter column pasto_id set not null;

alter table movimentacoes_rebanho
  add constraint ck_pasto_destino check (
    (tipo = 'MUDANCA_PASTO' and pasto_destino_id is not null and pasto_destino_id <> pasto_id)
    or
    (tipo = 'TRANSFERENCIA' and pasto_destino_id is not null)
    or
    (tipo not in ('MUDANCA_PASTO', 'TRANSFERENCIA') and pasto_destino_id is null)
  );

-- coluna antiga, texto livre, nunca lida nem escrita pelo frontend —
-- substituída pelas colunas estruturadas acima
alter table movimentacoes_rebanho
  drop column if exists local_pasto;

-- =====================================================================
-- FIM DA MIGRAÇÃO 019
-- =====================================================================
