-- Migração 073b: hotfix — desempate determinístico na resolução de "peso mais recente"
--
-- Bug real encontrado ao verificar a migração 073 contra dado real: as duas resoluções de
-- "peso mais recente pra fazenda+categoria+pasto" (a que preenche peso_medio_kg de uma Mudança
-- de Pasto sem peso informado, em fn_calcular_peso_total_movimentacao, e a que decide se uma
-- pesagem precisa ser compilada de novo, em fn_compilar_pesagem_movimentacao) fazem
-- `order by data desc limit 1` sem nenhum desempate — quando existem 2+ pesagens com a MESMA
-- data mais recente pra esse trio (comum aqui: a redistribuição via auditoria, migração/carga de
-- dados reais, gravou várias linhas de MUDANCA_PASTO na mesma data pro mesmo pasto+categoria de
-- destino), o Postgres pode devolver uma linha diferente em cada consulta — fazendo as duas
-- funções "discordarem" sobre qual é o peso atual, mesmo sem nenhuma mudança real. Foi assim que
-- o teste de verificação da 073 pegou uma pesagem compilada onde o esperado era nenhuma.
--
-- Fix: acrescentar `created_at desc` como critério de desempate nas duas consultas, garantindo
-- que as duas sempre leiam exatamente a mesma linha quando há empate de data.

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
    order by p.data desc, p.created_at desc
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
