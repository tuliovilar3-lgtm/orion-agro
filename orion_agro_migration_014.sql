-- =====================================================================
-- ORION AGRO — Migração 014
--
-- 1) Exige saldo inicial confirmado antes de qualquer outra
--    movimentação (trigger nova, não existia antes).
-- 2) Relatório de movimentação de rebanho passa a aceitar múltiplas
--    fazendas (array), agregando os resultados por categoria. A
--    coluna "Saldo inic." deixa de existir: qualquer saldo inicial
--    lançado dentro do período filtrado passa a compor o "Estoque
--    inicial" em vez de aparecer como entrada. Transferências 100%
--    internas ao grupo de fazendas selecionado (origem e destino
--    ambas no grupo) não aparecem mais como entrada/saída, já que
--    não mudam o total do grupo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) saldo inicial obrigatório antes de qualquer outra movimentação
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_inicial_obrigatorio()
returns trigger as $$
declare
  v_fazenda_ids uuid[];
  v_fazenda_id  uuid;
  v_confirmado  boolean;
begin
  if new.tipo = 'SALDO_INICIAL' then
    return new;
  end if;

  if new.tipo = 'TRANSFERENCIA' then
    v_fazenda_ids := array[new.fazenda_origem_id, new.fazenda_destino_id];
  else
    v_fazenda_ids := array[new.fazenda_id];
  end if;

  foreach v_fazenda_id in array v_fazenda_ids
  loop
    select saldo_inicial_confirmado into v_confirmado from fazendas where id = v_fazenda_id;
    if not coalesce(v_confirmado, false) then
      raise exception 'É necessário preencher e confirmar o saldo inicial da fazenda antes de lançar outras movimentações.';
    end if;
  end loop;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validar_saldo_inicial_obrigatorio on movimentacoes_rebanho;
create trigger trg_validar_saldo_inicial_obrigatorio
before insert on movimentacoes_rebanho
for each row execute function fn_validar_saldo_inicial_obrigatorio();

-- ---------------------------------------------------------------------
-- 2) relatório de movimentação — multi-fazenda
-- ---------------------------------------------------------------------

drop function if exists fn_relatorio_movimentacao_rebanho(uuid, date, date);

create or replace function fn_relatorio_movimentacao_rebanho(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date
) returns table (
  categoria_id uuid,
  categoria_nome text,
  ordem_ciclo int,
  estoque_inicial int,
  entrada_nascimento int,
  entrada_compra int,
  entrada_desmame int,
  entrada_transferencia int,
  entrada_mudanca_categoria int,
  saida_morte int,
  saida_venda int,
  saida_desmame int,
  saida_transferencia int,
  saida_consumo_doacao int,
  saida_mudanca_categoria int,
  estoque_final int
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.nome,
    c.ordem_ciclo,
    coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_inicio - 1))
      from unnest(p_fazenda_ids) as f(id)), 0)::int
    + coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'SALDO_INICIAL'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'NASCIMENTO'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'COMPRA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_destino_id = any(p_fazenda_ids) and not (m.fazenda_origem_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MORTE'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo in ('VENDA_PE', 'VENDA_ABATE')
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_origem_id = any(p_fazenda_ids) and not (m.fazenda_destino_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'CONSUMO_DOACAO'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_fim))
      from unnest(p_fazenda_ids) as f(id)), 0)::int
  from categorias_animal c
  where c.ativa = true
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 014
-- =====================================================================
