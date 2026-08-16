-- =====================================================================
-- ORION AGRO — Migração 045
--
-- Simplifica proprietário do lote de gado: remove o vínculo por
-- fazenda (fazenda_proprietarios, migração 044) e passa a tratar
-- proprietário como uma lista global — qualquer pessoa cadastrada com
-- papel PROPRIETARIO fica selecionável em qualquer lançamento, em
-- qualquer fazenda, sem precisar de nenhum passo de vínculo antes.
--
-- Decisão do usuário, revertendo a Fase 1 (migração 044): "o gado de um
-- proprietário pode ser transferido de uma fazenda para outra" — amarrar
-- proprietário por fazenda cria fricção justamente no caso mais comum
-- (Transferência) sem ganho real, já que fn_saldo_categoria_proprietario
-- (mantida sem alteração) já rastreia o saldo por fazenda+categoria+
-- proprietário de qualquer forma, independente de qualquer vínculo
-- prévio. Simplicidade > precisão de uma lista filtrada por fazenda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Remove a checagem "proprietário pertence à fazenda" — deixa de
-- fazer sentido, já que proprietário não é mais escopado por fazenda.
-- ---------------------------------------------------------------------

drop trigger if exists trg_validar_proprietario_pertence_fazenda on movimentacoes_rebanho;
drop function if exists fn_validar_proprietario_pertence_fazenda();

-- ---------------------------------------------------------------------
-- 2) Remove fazenda_proprietarios e a função que listava por fazenda —
-- nada mais consulta essa tabela (o frontend passa a buscar direto
-- pessoa_papeis, igual já fazia pro seletor de dono da terra).
-- ---------------------------------------------------------------------

drop function if exists fn_proprietarios_disponiveis_fazenda(uuid);
drop table if exists fazenda_proprietarios;

-- ---------------------------------------------------------------------
-- 3) fn_validar_delete_pessoa: remove a checagem de fazenda_proprietarios
-- (tabela não existe mais) — mantém as demais, inclusive a de
-- movimentacoes_rebanho.proprietario_id (essa continua valendo, já que
-- a coluna e o vínculo direto com a movimentação não mudaram).
-- ---------------------------------------------------------------------

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

  delete from pessoa_papeis where pessoa_id = old.id;

  return old;
end;
$$ language plpgsql;

-- =====================================================================
-- FIM DA MIGRAÇÃO 045
-- =====================================================================
