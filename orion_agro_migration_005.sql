-- =====================================================================
-- ORION AGRO — Migração 005
-- Incremental sobre o banco já criado. Rode no SQL editor do Supabase.
-- Não valida dados existentes (a trigger só passa a valer para novos
-- lançamentos, a partir de agora), então é seguro rodar mesmo que o
-- saldo histórico já esteja negativo em algum ponto.
-- =====================================================================

create or replace function fn_saldo_categoria(p_fazenda_id uuid, p_categoria_id uuid, p_data date)
returns integer
language plpgsql
stable
as $$
declare
  v_entradas int;
  v_saidas   int;
begin
  select coalesce(sum(quantidade), 0) into v_entradas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo in ('NASCIMENTO', 'COMPRA') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem uuid;
  v_saldo            int;
begin
  if new.tipo in ('VENDA_PE', 'VENDA_ABATE', 'MORTE', 'CONSUMO_DOACAO', 'DESMAME', 'MUDANCA_CATEGORIA') then
    v_fazenda_checagem := new.fazenda_id;
  elsif new.tipo = 'TRANSFERENCIA' then
    v_fazenda_checagem := new.fazenda_origem_id;
  else
    return new;
  end if;

  v_saldo := fn_saldo_categoria(v_fazenda_checagem, new.categoria_id, new.data);

  if v_saldo < new.quantidade then
    raise exception 'Saldo insuficiente: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
      v_saldo, new.data, new.quantidade;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validar_saldo_categoria on movimentacoes_rebanho;
create trigger trg_validar_saldo_categoria
before insert on movimentacoes_rebanho
for each row execute function fn_validar_saldo_categoria();

-- =====================================================================
-- FIM DA MIGRAÇÃO 005
-- =====================================================================
