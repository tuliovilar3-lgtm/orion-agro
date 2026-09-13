-- Migração 073c: hotfix — comparação de "peso mudou?" olhava o pasto errado
--
-- Bug real encontrado ao reverificar a migração 073b contra dado real: `v_pasto_id` (usada pra
-- decidir se compila uma pesagem nova) já é `coalesce(new.pasto_destino_id, new.pasto_id)` —
-- pra MUDANCA_PASTO isso é sempre o pasto de DESTINO. Usar essa mesma variável na comparação
-- "peso mudou?" faz a consulta procurar o peso anterior no destino, não na origem — e como a
-- categoria quase nunca já tinha sido pesada especificamente naquele pasto de destino antes
-- (é justamente por isso que o gado está se movendo pra lá), a comparação sempre dava "sem
-- pesagem anterior" e compilava uma pesagem nova mesmo quando o usuário não mudou peso nenhum.
--
-- O valor "carregado adiante sem editar" (MovimentacaoLotesModal manda l.pesoAtual quando o
-- usuário não mexe no lápis) é o peso já conhecido no pasto de ORIGEM — é contra isso que a
-- comparação precisa ser feita, usando new.pasto_id (sempre a origem, nunca coalescido).

create or replace function fn_compilar_pesagem_movimentacao()
returns trigger as $$
declare
  v_fazenda_id    uuid;
  v_categoria_id  uuid;
  v_pasto_id      uuid;
  v_peso_anterior numeric;
begin
  v_fazenda_id := coalesce(new.fazenda_destino_id, new.fazenda_id);
  v_categoria_id := coalesce(new.categoria_destino_id, new.categoria_id);
  v_pasto_id := coalesce(new.pasto_destino_id, new.pasto_id);

  if new.peso_medio_kg is not null and new.peso_medio_kg > 0 then
    v_peso_anterior := null;
    if new.tipo = 'MUDANCA_PASTO' then
      select p.peso_medio_kg into v_peso_anterior
      from pesagens p
      where p.fazenda_id = new.fazenda_id
        and p.categoria_id = new.categoria_id
        and p.pasto_id = new.pasto_id
        and p.movimentacao_id is distinct from new.id
        and p.data <= new.data
      order by p.data desc, p.created_at desc
      limit 1;
    end if;

    if new.tipo = 'MUDANCA_PASTO' and v_peso_anterior is not null and v_peso_anterior = new.peso_medio_kg then
      delete from pesagens where movimentacao_id = new.id;
    else
      insert into pesagens (conta_id, fazenda_id, categoria_id, pasto_id, data, peso_medio_kg, movimentacao_id, observacao)
      values (new.conta_id, v_fazenda_id, v_categoria_id, v_pasto_id, new.data, new.peso_medio_kg, new.id,
              'Peso compilado automaticamente da movimentação')
      on conflict (movimentacao_id) do update set
        fazenda_id = excluded.fazenda_id,
        categoria_id = excluded.categoria_id,
        pasto_id = excluded.pasto_id,
        data = excluded.data,
        peso_medio_kg = excluded.peso_medio_kg;
    end if;
  else
    delete from pesagens where movimentacao_id = new.id;
  end if;

  return new;
end;
$$ language plpgsql;
