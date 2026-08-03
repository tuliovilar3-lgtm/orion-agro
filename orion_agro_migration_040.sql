-- =====================================================================
-- ORION AGRO — Migração 040
-- Remove o nível Retiro por completo (schema, triggers e coluna) —
-- introduzido oculto na migração 038 "pronto pro futuro", mas o
-- usuário decidiu que não precisa dessa camada. Nunca teve UI, então
-- não há dado real de usuário a migrar; só desfaz a infraestrutura.
-- =====================================================================

-- fn_criar_modulo_pasto_geral: volta a criar só módulo + pasto "Geral"
-- (sem retiro)
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

-- fn_validar_delete_fazenda: cascata não passa mais por retiros
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
  perform set_config('orion.excluindo_fazenda', 'false', true);

  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_validar_delete_retiro on retiros;
drop function if exists fn_validar_delete_retiro();

alter table modulos drop column retiro_id;

drop table retiros;

-- =====================================================================
-- FIM DA MIGRAÇÃO 040
-- =====================================================================
