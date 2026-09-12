-- Migração 068: fn_salvar_linha_saldo_inicial — grava a linha-mãe de
-- Saldo Inicial e o detalhamento por safra (saldo_inicial_safras,
-- migração 066) numa única transação
--
-- Descoberto ao implementar a UI do detalhamento por safra: as triggers
-- de constraint adiáveis (fn_validar_soma_saldo_inicial_safra,
-- fn_validar_quantidade_saldo_inicial_com_safra) só ajudam dentro de UMA
-- transação — mas cada chamada do supabase-js (update/insert/delete) é
-- sua própria transação, com auto-commit. Editar uma linha já dividida
-- em 2 chamadas separadas (1: atualiza quantidade da linha-mãe; 2: apaga
-- e reinsere o detalhamento) falha no meio: a chamada 1 sozinha já runs
-- a checagem "soma do detalhamento antigo bate com a quantidade nova?" e
-- estoura, porque o detalhamento só é corrigido na chamada 2 (que nunca
-- chega a rodar). Precisa das duas mudanças na mesma transação — dá pra
-- fazer client-side com o supabase-js (sem BEGIN/COMMIT exposto), então
-- vira uma função de banco (RPC), que já roda inteira numa transação só.

create or replace function fn_salvar_linha_saldo_inicial(
  p_movimentacao_id uuid, -- null = insere linha nova
  p_fazenda_id uuid,
  p_categoria_id uuid,
  p_data date,
  p_quantidade int,
  p_peso_medio_kg numeric,
  p_peso_total_kg numeric,
  p_pasto_id uuid,
  p_proprietario_id uuid,
  p_safra_coluna int, -- safra_nascimento_ano_inicio da linha-mãe (null se categoria não é bezerro)
  p_detalhamento jsonb -- array de {"safra": int, "quantidade": int}; null/0-1 item = sem detalhamento
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_movimentacao_id is not null then
    update movimentacoes_rebanho set
      quantidade = p_quantidade,
      peso_medio_kg = p_peso_medio_kg,
      peso_total_kg = p_peso_total_kg,
      pasto_id = p_pasto_id,
      proprietario_id = p_proprietario_id,
      data = p_data,
      safra_nascimento_ano_inicio = p_safra_coluna
    where id = p_movimentacao_id;
    v_id := p_movimentacao_id;
  else
    insert into movimentacoes_rebanho (
      fazenda_id, categoria_id, tipo, data, quantidade, peso_medio_kg, peso_total_kg,
      pasto_id, proprietario_id, safra_nascimento_ano_inicio
    ) values (
      p_fazenda_id, p_categoria_id, 'SALDO_INICIAL', p_data, p_quantidade, p_peso_medio_kg, p_peso_total_kg,
      p_pasto_id, p_proprietario_id, p_safra_coluna
    )
    returning id into v_id;
  end if;

  delete from saldo_inicial_safras where movimentacao_id = v_id;

  if coalesce(jsonb_array_length(p_detalhamento), 0) > 1 then
    insert into saldo_inicial_safras (movimentacao_id, safra_nascimento_ano_inicio, quantidade)
    select v_id, (item->>'safra')::int, (item->>'quantidade')::int
    from jsonb_array_elements(p_detalhamento) as item;
  end if;

  return v_id;
end;
$$;
