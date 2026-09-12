-- Migração 064: corrige fn_compilar_pesagem_movimentacao() pra gravar
-- conta_id explicitamente (new.conta_id, a mesma conta da movimentação
-- que disparou o trigger) em vez de depender do default
-- fn_conta_atual(). Mesmo bug já corrigido na migração 063
-- (fn_criar_modulo_pasto_geral): fn_conta_atual() resolve pelo
-- auth.uid() da sessão — funciona pra qualquer usuário logado normal,
-- mas quebra pra qualquer insert de movimentação feito fora de uma
-- sessão de app autenticada (ex.: um script rodando com a chave
-- service-role, sem auth.uid() nenhum). Descoberto ao inserir Saldo
-- Inicial via script na conta "Fazenda Teste 1".
create or replace function fn_compilar_pesagem_movimentacao()
returns trigger as $$
declare
  v_fazenda_id   uuid;
  v_categoria_id uuid;
  v_pasto_id     uuid;
begin
  v_fazenda_id := coalesce(new.fazenda_destino_id, new.fazenda_id);
  v_categoria_id := coalesce(new.categoria_destino_id, new.categoria_id);
  v_pasto_id := coalesce(new.pasto_destino_id, new.pasto_id);

  if new.peso_medio_kg is not null and new.peso_medio_kg > 0 then
    insert into pesagens (conta_id, fazenda_id, categoria_id, pasto_id, data, peso_medio_kg, movimentacao_id, observacao)
    values (new.conta_id, v_fazenda_id, v_categoria_id, v_pasto_id, new.data, new.peso_medio_kg, new.id,
            'Peso compilado automaticamente da movimentação')
    on conflict (movimentacao_id) do update set
      fazenda_id = excluded.fazenda_id,
      categoria_id = excluded.categoria_id,
      pasto_id = excluded.pasto_id,
      data = excluded.data,
      peso_medio_kg = excluded.peso_medio_kg;
  else
    delete from pesagens where movimentacao_id = new.id;
  end if;

  return new;
end;
$$ language plpgsql;
