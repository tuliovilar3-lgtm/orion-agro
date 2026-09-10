-- =====================================================================
-- ORION AGRO — Migração 055
--
-- Módulo Financeiro — trava de estorno: uma movimentação de rebanho
-- (Compra/Venda em Pé/Venda Abate) cujo lançamento financeiro vinculado
-- já está CONFIRMADO (pago/recebido) não pode mais ser editada nem
-- excluída direto no pecuário — hoje qualquer edição resincroniza o
-- lançamento e volta o status pra PENDENTE silenciosamente (ver
-- fn_compilar_lancamento_financeiro_movimentacao, migração 054), o que
-- desfaz uma confirmação de pagamento/recebimento sem nenhum aviso.
--
-- A partir desta migração, editar/excluir a movimentação enquanto o
-- lançamento estiver CONFIRMADO é bloqueado com uma exceção — o
-- usuário precisa primeiro "Estornar" o lançamento em Financeiro (novo
-- botão em app/financeiro/page.tsx, volta o status pra PENDENTE) antes
-- de conseguir editar/excluir a movimentação de origem.
-- =====================================================================

create or replace function fn_validar_edicao_movimentacao_lancamento_confirmado()
returns trigger as $$
begin
  if exists (
    select 1 from lancamentos_financeiros
    where movimentacao_id = old.id and status = 'CONFIRMADO'
  ) then
    raise exception 'Esta movimentação tem um lançamento financeiro já confirmado. Estorne o lançamento em Financeiro antes de editar ou excluir esta movimentação.';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger trg_validar_edicao_movimentacao_lancamento_confirmado
before update or delete on movimentacoes_rebanho
for each row execute function fn_validar_edicao_movimentacao_lancamento_confirmado();
