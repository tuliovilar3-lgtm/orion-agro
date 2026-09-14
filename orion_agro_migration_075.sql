-- Migração 075: CORREÇÃO URGENTE da migração 074 (peso ponderado)
--
-- A migração 074 introduziu um "ledger" (soma entradas − soma saídas de peso_total_kg) pra
-- calcular peso médio ponderado. Isso quebra sempre que um animal CRESCE entre entrar numa
-- categoria+pasto e sair dela — o caso mais óbvio é Desmame: o peso registrado na saída
-- (peso real do bezerro no desmame, maior) é subtraído de uma base que só somou o peso pequeno
-- do nascimento, criando um "buraco" contábil que nunca se fecha. Confirmado com dado real:
-- "Bezerra 00 a 08 Meses" em Fazenda Nossa Sra. Aparecida deu peso médio de -7.217 kg — um
-- resultado absurdo, pior que o bug original (peso não ponderado).
--
-- CORREÇÃO: em vez de reconstruir o histórico inteiro numa consulta (ledger), a mistura
-- ponderada passa a acontecer NA HORA DE GRAVAR (fn_compilar_pesagem_movimentacao) — toda
-- movimentação que ENTRA numa categoria+pasto que já tem estoque compila o peso como a média
-- ponderada entre o que já estava lá (o último peso já compilado pra esse trio) e o que está
-- chegando. Saída nunca mexe na média de quem fica (nenhuma subtração de peso, então nunca pode
-- ficar negativo). Isso permite reverter as 3 funções de LEITURA (fn_relatorio_rebanho_por_pasto,
-- fn_resumo_rebanho_atual, fn_indicadores_rebanho_dia) e o auto-preenchimento
-- (fn_calcular_peso_total_movimentacao) pro comportamento original de sempre ("pega o peso mais
-- recente compilado") — só que agora esse peso compilado JÁ é a média ponderada correta, sem
-- precisar de nenhuma lógica nova em quem lê.
--
-- Também refaz (backfill) todo o histórico de `pesagens` já compilado, reproduzindo a mesma
-- mistura ponderada em ordem cronológica — sem isso, só movimentações NOVAS (depois desta
-- migração) ficariam corretas, e todo o histórico real já carregado continuaria mostrando o
-- peso "não ponderado" de antes.

-- ---------------------------------------------------------------------
-- 1) Reverte fn_relatorio_rebanho_por_pasto pro comportamento original (pega o peso mais
-- recente compilado pra esse trio — sem ledger).
-- ---------------------------------------------------------------------
create or replace function fn_relatorio_rebanho_por_pasto(
  p_fazenda_id uuid, p_data date, p_proprietario_ids uuid[] default null
)
returns table(
  pasto_id uuid,
  pasto_nome text,
  pasto_ordem int,
  categoria_id uuid,
  categoria_nome text,
  quantidade int,
  peso_medio_kg numeric
)
language plpgsql
as $$
declare
  v_pasto      record;
  v_categoria  record;
  v_qtd        int;
  v_peso       numeric;
  v_prop       uuid;
begin
  for v_pasto in (
    select p.id, p.nome, p.ordem
    from pastos p
    join modulos m on m.id = p.modulo_id
    where m.fazenda_id = p_fazenda_id
    order by m.ordem, p.ordem
  )
  loop
    for v_categoria in (
      select c.id, c.nome, c.peso_referencia_kg
      from categorias_animal c
      order by c.ordem_ciclo, c.nome
    )
    loop
      if p_proprietario_ids is null then
        v_qtd := fn_saldo_categoria_pasto(p_fazenda_id, v_categoria.id, v_pasto.id, p_data);
      else
        v_qtd := 0;
        foreach v_prop in array p_proprietario_ids
        loop
          v_qtd := v_qtd + fn_saldo_categoria_pasto_proprietario(p_fazenda_id, v_categoria.id, v_pasto.id, v_prop, p_data);
        end loop;
      end if;

      if v_qtd > 0 then
        select pz.peso_medio_kg into v_peso
        from pesagens pz
        where pz.fazenda_id = p_fazenda_id and pz.categoria_id = v_categoria.id
          and pz.pasto_id = v_pasto.id and pz.data <= p_data
        order by pz.data desc
        limit 1;

        pasto_id := v_pasto.id;
        pasto_nome := v_pasto.nome;
        pasto_ordem := v_pasto.ordem;
        categoria_id := v_categoria.id;
        categoria_nome := v_categoria.nome;
        quantidade := v_qtd;
        peso_medio_kg := coalesce(v_peso, v_categoria.peso_referencia_kg);

        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Reverte fn_resumo_rebanho_atual pro comportamento original.
-- ---------------------------------------------------------------------
create or replace function fn_resumo_rebanho_atual(p_fazenda_ids uuid[])
returns table(
  fazenda_id uuid,
  categoria_id uuid,
  categoria_nome text,
  grupo_nome text,
  sexo sexo_categoria,
  quantidade integer,
  peso_medio_kg numeric
)
language plpgsql
stable
as $$
begin
  return query
  select
    e.fazenda_id,
    e.categoria_id,
    e.categoria_nome,
    g.nome as grupo_nome,
    c.sexo,
    e.saldo_atual::int as quantidade,
    coalesce(
      (select p.peso_medio_kg from pesagens p
       where p.fazenda_id = e.fazenda_id and p.categoria_id = e.categoria_id and p.data <= current_date
       order by p.data desc limit 1),
      c.peso_referencia_kg
    ) as peso_medio_kg
  from vw_estoque_rebanho e
  join categorias_animal c on c.id = e.categoria_id
  join grupos_categoria g on g.id = c.grupo_id
  where e.saldo_atual > 0
    and (p_fazenda_ids is null or e.fazenda_id = any(p_fazenda_ids));
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Reverte fn_indicadores_rebanho_dia pro comportamento original.
-- ---------------------------------------------------------------------
create or replace function fn_indicadores_rebanho_dia(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(headcount int, peso_vivo_total numeric)
language sql
stable
as $$
  select
    coalesce(sum(e.quantidade), 0)::int,
    coalesce(sum(e.quantidade * coalesce(
      (select p.peso_medio_kg from pesagens p
       where p.fazenda_id = any(p_fazenda_ids) and p.categoria_id = e.categoria_id and p.data <= p_data
       order by p.data desc limit 1),
      c.peso_referencia_kg
    )), 0)
  from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data, p_proprietario_ids) e
  join categorias_animal c on c.id = e.categoria_id
  where e.quantidade > 0
$$;

-- ---------------------------------------------------------------------
-- 4) Reverte o auto-preenchimento de peso (MUDANCA_PASTO sem peso informado) pro comportamento
-- original — "peso mais recente conhecido na origem". Seguro de novo porque, com o gatilho de
-- compilação corrigido (item 5), esse "mais recente" já é a média ponderada certa.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5) fn_compilar_pesagem_movimentacao: CORREÇÃO DE VERDADE — toda movimentação que ENTRA numa
-- categoria+pasto que já tem estoque agora compila a MÉDIA PONDERADA entre o que já estava
-- compilado ali e o que está chegando (quantidade × peso de cada lado). Uma movimentação de
-- saída pura (Morte/Venda/Consumo/etc., sem "destino") continua só refletindo o próprio peso,
-- como sempre — saída nunca subtrai nada da média de quem fica, então o resultado nunca pode
-- ficar negativo (é sempre a média de dois números positivos).
-- ---------------------------------------------------------------------
create or replace function fn_compilar_pesagem_movimentacao()
returns trigger as $$
declare
  v_fazenda_id           uuid;
  v_categoria_id         uuid;
  v_pasto_id             uuid;
  v_eh_entrada           boolean;
  v_qtd_antes            int := 0;
  v_peso_antes           numeric;
  v_peso_final           numeric;
  v_peso_anterior_origem numeric;
begin
  v_fazenda_id := coalesce(new.fazenda_destino_id, new.fazenda_id);
  v_categoria_id := coalesce(new.categoria_destino_id, new.categoria_id);
  v_pasto_id := coalesce(new.pasto_destino_id, new.pasto_id);

  if new.peso_medio_kg is not null and new.peso_medio_kg > 0 then
    -- só os tipos que de fato somam quantidade num (fazenda,categoria,pasto) — os mesmos já
    -- usados como "entrada" em fn_saldo_categoria_pasto — participam da mistura ponderada;
    -- Morte/Venda/Abate/Consumo-Doação (saída pura, sem destino) seguem só refletindo o próprio
    -- peso, como sempre.
    v_eh_entrada := new.tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL', 'TRANSFERENCIA', 'MUDANCA_CATEGORIA', 'DESMAME', 'MUDANCA_PASTO');
    v_peso_final := new.peso_medio_kg;

    if v_eh_entrada then
      -- quantidade que já estava em (v_fazenda_id, v_categoria_id, v_pasto_id) ANTES desta
      -- movimentação — fn_saldo_categoria_pasto(..., new.data) já inclui a contribuição desta
      -- própria linha (o trigger roda AFTER insert/update), por isso subtrai new.quantidade
      v_qtd_antes := greatest(0, fn_saldo_categoria_pasto(v_fazenda_id, v_categoria_id, v_pasto_id, new.data) - new.quantidade);

      select p.peso_medio_kg into v_peso_antes
      from pesagens p
      where p.fazenda_id = v_fazenda_id and p.categoria_id = v_categoria_id and p.pasto_id = v_pasto_id
        and p.movimentacao_id is distinct from new.id and p.data <= new.data
      order by p.data desc, p.created_at desc
      limit 1;

      if v_qtd_antes > 0 and v_peso_antes is not null then
        v_peso_final := round((v_qtd_antes * v_peso_antes + new.quantidade * new.peso_medio_kg) / (v_qtd_antes + new.quantidade), 2);
      end if;
    end if;

    -- Mudança de Pasto sem nada pra misturar (destino estava vazio) continua com a mesma
    -- otimização da migração 073c: só compila uma pesagem de verdade quando o peso carregado
    -- difere do que já era conhecido na ORIGEM (evita encher "Pesagens recentes" com entradas
    -- redundantes toda vez que o usuário só move um lote sem repesar) — quando HÁ mistura
    -- (v_qtd_antes > 0), sempre compila, porque o resultado combinado é sempre uma informação
    -- nova (mesmo que o peso desta movimentação em si não tenha mudado).
    if new.tipo = 'MUDANCA_PASTO' and v_qtd_antes = 0 then
      select p.peso_medio_kg into v_peso_anterior_origem
      from pesagens p
      where p.fazenda_id = new.fazenda_id and p.categoria_id = new.categoria_id and p.pasto_id = new.pasto_id
        and p.movimentacao_id is distinct from new.id and p.data <= new.data
      order by p.data desc, p.created_at desc
      limit 1;
    end if;

    if new.tipo = 'MUDANCA_PASTO' and v_qtd_antes = 0
       and v_peso_anterior_origem is not null and v_peso_anterior_origem = new.peso_medio_kg then
      delete from pesagens where movimentacao_id = new.id;
    else
      insert into pesagens (conta_id, fazenda_id, categoria_id, pasto_id, data, peso_medio_kg, movimentacao_id, observacao)
      values (new.conta_id, v_fazenda_id, v_categoria_id, v_pasto_id, new.data, v_peso_final, new.id,
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

-- ---------------------------------------------------------------------
-- 6) Remove as funções de ledger da migração 074 — provaram-se incorretas em geral (crescimento
-- entre entrada e saída) e não são mais usadas por nada depois da reversão acima.
-- ---------------------------------------------------------------------
drop function if exists fn_peso_vivo_total_categoria_pasto(uuid, uuid, uuid, date);
drop function if exists fn_peso_vivo_total_categoria_fazendas(uuid[], uuid, date);

-- ---------------------------------------------------------------------
-- 7) BACKFILL: refaz todo o histórico de `pesagens` já compilado (movimentacao_id not null),
-- reproduzindo em ordem cronológica a mesma mistura ponderada do item 5 — sem isso, só
-- movimentações NOVAS ficariam corretas, e o histórico real já carregado continuaria com o
-- "peso da última movimentação" de antes desta correção.
-- ---------------------------------------------------------------------
do $$
declare
  v_trio       record;
  v_evento     record;
  v_qtd        numeric := 0;
  v_peso       numeric;
  v_peso_final numeric;
begin
  for v_trio in (
    select distinct coalesce(fazenda_destino_id, fazenda_id) as fazenda_id,
                     coalesce(categoria_destino_id, categoria_id) as categoria_id,
                     coalesce(pasto_destino_id, pasto_id) as pasto_id
    from movimentacoes_rebanho
    where peso_medio_kg is not null
  )
  loop
    v_qtd := 0;
    v_peso := null;

    for v_evento in (
      -- entradas (mesma classificação de fn_saldo_categoria_pasto), participam da mistura
      select id, data, created_at, quantidade::numeric as quantidade, peso_medio_kg, 'ENTRADA'::text as direcao
      from movimentacoes_rebanho
      where peso_medio_kg is not null and fazenda_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id
        and pasto_id = v_trio.pasto_id and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL')
      union all
      select id, data, created_at, quantidade::numeric, peso_medio_kg, 'ENTRADA'::text
      from movimentacoes_rebanho
      where peso_medio_kg is not null and fazenda_destino_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id
        and pasto_destino_id = v_trio.pasto_id and tipo = 'TRANSFERENCIA'
      union all
      select id, data, created_at, quantidade::numeric, peso_medio_kg, 'ENTRADA'::text
      from movimentacoes_rebanho
      where peso_medio_kg is not null and fazenda_id = v_trio.fazenda_id and categoria_destino_id = v_trio.categoria_id
        and pasto_id = v_trio.pasto_id and tipo in ('MUDANCA_CATEGORIA', 'DESMAME')
      union all
      select id, data, created_at, quantidade::numeric, peso_medio_kg, 'ENTRADA'::text
      from movimentacoes_rebanho
      where peso_medio_kg is not null and fazenda_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id
        and pasto_destino_id = v_trio.pasto_id and tipo = 'MUDANCA_PASTO'
      -- saídas (mesma classificação), só descontam quantidade — nunca mexem na média
      union all
      select id, data, created_at, quantidade::numeric, null::numeric, 'SAIDA'::text
      from movimentacoes_rebanho
      where fazenda_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id and pasto_id = v_trio.pasto_id
        and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME')
      union all
      select id, data, created_at, quantidade::numeric, null::numeric, 'SAIDA'::text
      from movimentacoes_rebanho
      where fazenda_origem_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id and pasto_id = v_trio.pasto_id
        and tipo = 'TRANSFERENCIA'
      union all
      select id, data, created_at, quantidade::numeric, null::numeric, 'SAIDA'::text
      from movimentacoes_rebanho
      where fazenda_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id and pasto_id = v_trio.pasto_id
        and tipo = 'MUDANCA_CATEGORIA'
      union all
      select id, data, created_at, quantidade::numeric, null::numeric, 'SAIDA'::text
      from movimentacoes_rebanho
      where fazenda_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id and pasto_id = v_trio.pasto_id
        and tipo = 'MUDANCA_PASTO'
      -- resets: pesagem MANUAL (não compilada) pra esse trio recalibra a média a partir dali
      union all
      select id, data, created_at, null::numeric, peso_medio_kg, 'RESET'::text
      from pesagens
      where movimentacao_id is null and fazenda_id = v_trio.fazenda_id and categoria_id = v_trio.categoria_id
        and pasto_id = v_trio.pasto_id
      order by data, created_at
    )
    loop
      if v_evento.direcao = 'RESET' then
        v_peso := v_evento.peso_medio_kg;
      elsif v_evento.direcao = 'ENTRADA' then
        if v_qtd > 0 and v_peso is not null then
          v_peso_final := round((v_qtd * v_peso + v_evento.quantidade * v_evento.peso_medio_kg) / (v_qtd + v_evento.quantidade), 2);
        else
          v_peso_final := v_evento.peso_medio_kg;
        end if;
        v_qtd := v_qtd + v_evento.quantidade;
        v_peso := v_peso_final;
        update pesagens set peso_medio_kg = v_peso_final where movimentacao_id = v_evento.id;
      else
        v_qtd := greatest(0, v_qtd - v_evento.quantidade);
      end if;
    end loop;
  end loop;
end $$;
