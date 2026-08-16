-- Addendum à migração 044 — só necessário se você já rodou o
-- orion_agro_migration_044.sql original antes desta correção.
-- fn_validar_delete_pessoa passa a checar também proprietario_id em
-- movimentacoes_rebanho e fazenda_proprietarios — sem isso, excluir uma
-- pessoa vinculada como proprietário de gado batia numa violação de FK
-- crua em vez da mensagem amigável já usada pros outros vínculos.

create or replace function fn_validar_delete_pessoa()
returns trigger as $$
begin
  if exists (select 1 from movimentacoes_rebanho where cliente_fornecedor_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa já está referenciada em movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from movimentacoes_rebanho where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de gado em uma ou mais movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from fazendas where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de uma fazenda. Inative-a em vez disso.';
  end if;

  if exists (select 1 from fazenda_proprietarios where pessoa_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa está vinculada como proprietária de gado em uma fazenda. Remova o vínculo (editar a fazenda) antes de excluir.';
  end if;

  delete from pessoa_papeis where pessoa_id = old.id;

  return old;
end;
$$ language plpgsql;
