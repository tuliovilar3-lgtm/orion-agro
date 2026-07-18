-- =====================================================================
-- ORION AGRO — Migração 029
--
-- Corrige bug da migração 028: fn_validar_delete_pesagem bloqueava até
-- a própria exclusão em cascata (on delete cascade) quando a
-- movimentação de origem era apagada, porque não distinguia "usuário
-- tentando excluir o peso direto na tela de Pesagens" (deve bloquear)
-- de "a movimentação de origem já foi apagada e isso é só a cascata
-- limpando o registro compilado" (deve deixar passar). A trigger passa
-- a checar se a movimentação ainda existe: se não existe mais (cascata
-- em andamento), libera a exclusão.
-- =====================================================================

create or replace function fn_validar_delete_pesagem()
returns trigger as $$
begin
  if old.movimentacao_id is not null
     and exists (select 1 from movimentacoes_rebanho where id = old.movimentacao_id) then
    raise exception 'Esse peso foi registrado automaticamente por uma movimentação — edite ou exclua a movimentação para alterá-lo.';
  end if;
  return old;
end;
$$ language plpgsql;

-- =====================================================================
-- FIM DA MIGRAÇÃO 029
-- =====================================================================
