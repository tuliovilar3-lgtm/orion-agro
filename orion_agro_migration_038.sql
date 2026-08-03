-- =====================================================================
-- ORION AGRO — Migração 038
-- Fase A do plano "Reorganização de Fazendas, Áreas e Pessoas":
--   1. Nível Retiro (Fazenda → Retiro → Módulo → Pasto)
--   2. pastos.area_produtiva_ha (área total já existia como area_ha)
--   3. Generalização de clientes_fornecedores → pessoas + pessoa_papeis
--      (papéis múltiplos: CLIENTE, FORNECEDOR, PROPRIETARIO)
--   4. Campos novos em fazendas (proprietário, área útil, documentos,
--      sistema produtivo, endereço, latitude/longitude)
--   5. Exclusão de fazenda (bloqueada se houver qualquer movimentação;
--      cascata sobre módulo/pasto/retiro "Geral" quando permitida)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RETIRO — novo nível organizacional entre fazenda e módulo. Mesmo
-- padrão de auto-criação/proteção já usado em módulo/pasto: toda
-- fazenda ganha um retiro "Geral" sozinho, protegido contra exclusão.
-- modulos.fazenda_id é mantido (não removido) para não precisar
-- reescrever a cadeia de triggers que já assume módulo→fazenda direto
-- (saldo, reconciliação de área, trajetória de edição) — retiro_id é
-- só uma camada de organização/filtro por cima.
-- ---------------------------------------------------------------------

create table retiros (
  id              uuid primary key default gen_random_uuid(),
  fazenda_id      uuid not null references fazendas(id),
  nome            text not null,
  ativo           boolean not null default true,
  ordem           int not null default 0,
  -- retiro "Geral" auto-criado — mesma proteção de sistema de módulo/pasto
  sistema         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint uq_retiro_nome_fazenda unique (fazenda_id, nome)
);
alter table retiros disable row level security;

alter table modulos add column retiro_id uuid references retiros(id);

-- backfill: cria o retiro "Geral" pra cada fazenda existente e aponta
-- os módulos já cadastrados pra ele
insert into retiros (fazenda_id, nome, ordem, sistema)
select id, 'Geral', 0, true from fazendas;

update modulos m
set retiro_id = r.id
from retiros r
where r.fazenda_id = m.fazenda_id and r.sistema = true;

alter table modulos alter column retiro_id set not null;

create or replace function fn_validar_delete_retiro()
returns trigger as $$
begin
  if old.sistema and coalesce(current_setting('orion.excluindo_fazenda', true), 'false') <> 'true' then
    raise exception 'O retiro "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (select 1 from modulos where retiro_id = old.id) then
    raise exception 'Não é possível excluir: existem módulos nesse retiro. Exclua-os primeiro.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_retiro
before delete on retiros
for each row execute function fn_validar_delete_retiro();

-- fn_criar_modulo_pasto_geral (trigger after insert on fazendas) passa a
-- criar também o retiro "Geral" e linkar o módulo "Geral" a ele
create or replace function fn_criar_modulo_pasto_geral()
returns trigger as $$
declare
  v_retiro_id uuid;
  v_modulo_id uuid;
begin
  insert into retiros (fazenda_id, nome, ordem, sistema)
  values (new.id, 'Geral', 0, true)
  returning id into v_retiro_id;

  insert into modulos (fazenda_id, retiro_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.id, v_retiro_id, 'Geral', 'PECUARIA', 0, true)
  returning id into v_modulo_id;

  insert into pastos (modulo_id, nome, ordem, sistema)
  values (v_modulo_id, 'Geral', 0, true);

  return new;
end;
$$ language plpgsql;

-- fn_validar_delete_pasto / fn_validar_delete_modulo passam a liberar a
-- proteção de sistema=true quando a exclusão vem de uma cascata de
-- exclusão de fazenda (flag de sessão setado por fn_validar_delete_fazenda)
create or replace function fn_validar_delete_pasto()
returns trigger as $$
begin
  if old.sistema and coalesce(current_setting('orion.excluindo_fazenda', true), 'false') <> 'true' then
    raise exception 'O pasto "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (
    select 1 from movimentacoes_rebanho
    where pasto_id = old.id or pasto_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: esse pasto já tem movimentações lançadas. Inative-o em vez disso.';
  end if;

  if exists (select 1 from pesagens where pasto_id = old.id) then
    raise exception 'Não é possível excluir: esse pasto já tem pesagens registradas. Inative-o em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create or replace function fn_validar_delete_modulo()
returns trigger as $$
begin
  if old.sistema and coalesce(current_setting('orion.excluindo_fazenda', true), 'false') <> 'true' then
    raise exception 'O módulo "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (select 1 from pastos where modulo_id = old.id) then
    raise exception 'Não é possível excluir: exclua os pastos/talhões desse módulo primeiro.';
  end if;

  return old;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 2. Área produtiva por pasto (area_ha existente passa a significar
-- "área total" na interface).
-- ---------------------------------------------------------------------

alter table pastos add column area_produtiva_ha numeric(12,2);
comment on column pastos.area_produtiva_ha is
  'Área realmente aproveitável pra pastagem, descontando brejo/pedra/mata dentro do pasto — usada como denominador da lotação (UA/ha) no lugar da área total (area_ha).';

-- ---------------------------------------------------------------------
-- 3. Generalização de Cliente/Fornecedor → Pessoas, com papéis
-- múltiplos (uma pessoa pode ser Proprietário e Cliente ao mesmo
-- tempo, por exemplo — o antigo enum tipo (CLIENTE/FORNECEDOR/AMBOS)
-- não suporta combinações arbitrárias).
-- ---------------------------------------------------------------------

alter table clientes_fornecedores rename to pessoas;

create type papel_pessoa as enum ('CLIENTE', 'FORNECEDOR', 'PROPRIETARIO');

create table pessoa_papeis (
  id          uuid primary key default gen_random_uuid(),
  pessoa_id   uuid not null references pessoas(id),
  papel       papel_pessoa not null,
  constraint uq_pessoa_papel unique (pessoa_id, papel)
);
alter table pessoa_papeis disable row level security;

insert into pessoa_papeis (pessoa_id, papel)
select id, 'CLIENTE'::papel_pessoa from pessoas where tipo in ('CLIENTE', 'AMBOS')
union all
select id, 'FORNECEDOR'::papel_pessoa from pessoas where tipo in ('FORNECEDOR', 'AMBOS');

alter table pessoas drop column tipo;
drop type tipo_cliente_fornecedor;

-- ---------------------------------------------------------------------
-- 4. Campos novos em fazendas: proprietário, área útil, documentos de
-- propriedade, sistema produtivo, endereço, coordenadas. Todos
-- opcionais exceto proprietario_id e area_util_ha, que passam a ser
-- exigidos só no formulário novo de cadastro (fazendas já existentes
-- ficam com null até serem editadas).
-- ---------------------------------------------------------------------

create type sistema_produtivo_fazenda as enum
  ('CRIA', 'RECRIA', 'RECRIA_ENGORDA', 'CICLO_COMPLETO', 'AGRICULTURA');

alter table fazendas
  add column proprietario_id uuid references pessoas(id),
  add column area_util_ha    numeric(12,2),
  add column ie              text,
  add column incra           text,
  add column numero_itr      text,
  add column caepf           text,
  add column sistema_produtivo sistema_produtivo_fazenda,
  add column pais            text,
  add column cep             text,
  add column endereco        text,
  add column numero          text,
  add column bairro          text,
  add column cidade          text,
  add column estado          text,
  add column telefone        text,
  add column latitude        numeric(10,7),
  add column longitude       numeric(10,7);

-- ---------------------------------------------------------------------
-- 5. Exclusão de fazenda: só permitida se não houver nenhuma
-- movimentação (rebanho, área ou pesagem) referenciando-a. Passando
-- essa checagem, apaga em cascata retiro/módulo/pasto "Geral" (que
-- normalmente são protegidos contra exclusão) via flag de sessão.
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_fazenda()
returns trigger as $$
begin
  if exists (
    select 1 from movimentacoes_rebanho
    where fazenda_id = old.id or fazenda_origem_id = old.id or fazenda_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: essa fazenda já tem movimentações de rebanho lançadas. Inative-a em vez disso.';
  end if;

  if exists (select 1 from movimentacoes_area where fazenda_id = old.id) then
    raise exception 'Não é possível excluir: essa fazenda já tem movimentações de área lançadas. Inative-a em vez disso.';
  end if;

  if exists (select 1 from pesagens where fazenda_id = old.id) then
    raise exception 'Não é possível excluir: essa fazenda já tem pesagens registradas. Inative-a em vez disso.';
  end if;

  perform set_config('orion.excluindo_fazenda', 'true', true);
  delete from pastos where modulo_id in (select id from modulos where fazenda_id = old.id);
  delete from modulos where fazenda_id = old.id;
  delete from retiros where fazenda_id = old.id;
  perform set_config('orion.excluindo_fazenda', 'false', true);

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_fazenda
before delete on fazendas
for each row execute function fn_validar_delete_fazenda();

-- =====================================================================
-- FIM DA MIGRAÇÃO 038
-- =====================================================================
