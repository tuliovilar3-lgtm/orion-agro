-- Migração 073: peso médio vira obrigatório em TODA movimentação, sem exceção (Fase 0 do
-- projeto de ledger de peso ponderado)
--
-- Até aqui, Mudança de Pasto era o único tipo isento de peso médio (ck_peso_medio_obrigatorio
-- tinha uma exceção só pra ela) — "se não informado, o lote continua com o último peso
-- conhecido, sem gravar nada". Pra um ledger de peso ponderado funcionar (peso_total_kg somado
-- ao longo de todas as movimentações), TODA movimentação precisa carregar um peso real — mesmo
-- que seja só o mesmo de sempre, sem intenção de registrar uma pesagem nova. Decisão do usuário:
-- "Todas as movimentações de gado devem obrigatoriamente envolver o peso, mesmo que não seja
-- atualizado."

-- 1) fn_calcular_peso_total_movimentacao ganha a resolução automática de peso pra Mudança de
-- Pasto sem peso informado — mesmo princípio de "sem fallback cruzado" já usado em toda
-- resolução de peso do sistema (pesagem mais recente pra fazenda+categoria+pasto exatos, senão
-- o peso de referência da categoria). Fica na mesma função (já é `before insert or update`, já
-- roda antes de fn_calcular_valores_movimentacao) pra não precisar coordenar ordem entre dois
-- triggers novos.
create or replace function fn_calcular_peso_total_movimentacao()
returns trigger as $$
declare
  v_peso numeric;
begin
  if new.tipo = 'MUDANCA_PASTO' and new.peso_medio_kg is null then
    select p.peso_medio_kg into v_peso
    from pesagens p
    where p.fazenda_id = new.fazenda_id
      and p.categoria_id = new.categoria_id
      and p.pasto_id = new.pasto_id
      and p.data <= new.data
    order by p.data desc
    limit 1;

    if v_peso is null then
      select c.peso_referencia_kg into v_peso from categorias_animal c where c.id = new.categoria_id;
    end if;

    new.peso_medio_kg := v_peso;
  end if;

  if new.peso_medio_kg is not null and new.quantidade is not null then
    new.peso_total_kg := round(new.peso_medio_kg * new.quantidade, 2);
  end if;
  return new;
end;
$$ language plpgsql;

-- 2) remove a exceção — peso vira not null sem exceção nenhuma. NOT VALID pra não quebrar
-- lançamentos antigos de Mudança de Pasto que ficaram sem peso sob a regra anterior (mesmo
-- padrão já usado quando essa constraint nasceu, migração 028).
alter table movimentacoes_rebanho drop constraint ck_peso_medio_obrigatorio;
alter table movimentacoes_rebanho add constraint ck_peso_medio_obrigatorio
  check (peso_medio_kg is not null) not valid;

-- 3) fn_compilar_pesagem_movimentacao só compila uma pesagem de verdade pra Mudança de Pasto
-- quando o peso realmente muda em relação ao mais recente já conhecido — senão, agora que toda
-- Mudança de Pasto carrega peso sempre (item 1), cada uma geraria uma entrada redundante em
-- "Pesagens recentes" mesmo sem nenhuma pesagem nova de verdade. Os demais tipos sempre exigiram
-- peso digitado ativamente pelo usuário pra aquele lançamento específico — continuam compilando
-- sempre, mesmo que o número coincida por acaso com o anterior.
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
      where p.fazenda_id = v_fazenda_id
        and p.categoria_id = v_categoria_id
        and p.pasto_id = v_pasto_id
        and p.movimentacao_id is distinct from new.id
        and p.data <= new.data
      order by p.data desc
      limit 1;
    end if;

    if new.tipo = 'MUDANCA_PASTO' and v_peso_anterior is not null and v_peso_anterior = new.peso_medio_kg then
      -- sem mudança de verdade — não compila pesagem nova. Ainda remove uma compilação antiga
      -- desta mesma movimentação (caso uma edição tenha voltado o peso a coincidir com o
      -- anterior, depois de já ter uma pesagem compilada com um valor diferente)
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
