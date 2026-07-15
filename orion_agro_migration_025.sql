-- =====================================================================
-- ORION AGRO — Migração 025
--
-- Exclusão de módulo/pasto sem histórico. Mesmo princípio já usado em
-- categorias de animal: só é possível excluir se não houver nenhuma
-- movimentação/pesagem lançada; caso contrário, só inativar. O par
-- "Geral" auto-criado (fn_criar_modulo_pasto_geral) ganha uma coluna
-- `sistema` pra nunca poder ser excluído pela UI, mesmo se renomeado.
-- =====================================================================

alter table modulos add column sistema boolean not null default false;
alter table pastos add column sistema boolean not null default false;

-- backfill: identifica o par "Geral" auto-criado pelo nome/ordem
-- (melhor esforço — se o usuário já tiver renomeado o par "Geral" em
-- alguma fazenda antes dessa migração, marque manualmente depois)
update modulos set sistema = true where nome = 'Geral' and ordem = 0;
update pastos set sistema = true where nome = 'Geral' and ordem = 0;

create or replace function fn_criar_modulo_pasto_geral()
returns trigger as $$
declare
  v_modulo_id uuid;
begin
  insert into modulos (fazenda_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.id, 'Geral', 'PECUARIA', 0, true)
  returning id into v_modulo_id;

  insert into pastos (modulo_id, nome, ordem, sistema)
  values (v_modulo_id, 'Geral', 0, true);

  return new;
end;
$$ language plpgsql;

create or replace function fn_validar_delete_pasto()
returns trigger as $$
begin
  if old.sistema then
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

create trigger trg_validar_delete_pasto
before delete on pastos
for each row execute function fn_validar_delete_pasto();

create or replace function fn_validar_delete_modulo()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'O módulo "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (select 1 from pastos where modulo_id = old.id) then
    raise exception 'Não é possível excluir: exclua os pastos/talhões desse módulo primeiro.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_modulo
before delete on modulos
for each row execute function fn_validar_delete_modulo();

-- =====================================================================
-- FIM DA MIGRAÇÃO 025
-- =====================================================================
