-- Migração 069: fn_salvar_linha_saldo_inicial grava conta_id explícito no
-- insert de saldo_inicial_safras
--
-- Mesma classe de bug já corrigida nas migrações 063/064: o insert em
-- saldo_inicial_safras dependia do default fn_conta_atual(), que resolve
-- via auth.uid() da sessão. Funciona sempre que a RPC é chamada pelo app
-- (sessão autenticada normal), mas quebra em qualquer chamada sem
-- auth.uid() (ex.: script com a chave service_role, usado nesta sessão só
-- pra verificar a função antes de liberar pro frontend). Corrigido lendo
-- conta_id da própria linha-mãe (movimentacoes_rebanho, já resolvida —
-- por default ou explícito — no passo anterior desta mesma função) em vez
-- de depender do default de novo no insert filho.

create or replace function fn_salvar_linha_saldo_inicial(
  p_movimentacao_id uuid,
  p_fazenda_id uuid,
  p_categoria_id uuid,
  p_data date,
  p_quantidade int,
  p_peso_medio_kg numeric,
  p_peso_total_kg numeric,
  p_pasto_id uuid,
  p_proprietario_id uuid,
  p_safra_coluna int,
  p_detalhamento jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_conta_id uuid;
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

  select conta_id into v_conta_id from movimentacoes_rebanho where id = v_id;

  delete from saldo_inicial_safras where movimentacao_id = v_id;

  if coalesce(jsonb_array_length(p_detalhamento), 0) > 1 then
    insert into saldo_inicial_safras (conta_id, movimentacao_id, safra_nascimento_ano_inicio, quantidade)
    select v_conta_id, v_id, (item->>'safra')::int, (item->>'quantidade')::int
    from jsonb_array_elements(p_detalhamento) as item;
  end if;

  return v_id;
end;
$$;
