-- Migração 074: peso médio sempre como média ponderada (ledger de peso vivo)
--
-- Bug real reportado pelo usuário: um pasto com 2 animais de 380 kg recebeu (via Mudança de
-- Pasto) mais 2 animais de 440 kg da mesma categoria, e o "peso médio" da categoria naquele
-- pasto continuou mostrando 380 kg — deveria ser 410 kg (média ponderada).
--
-- Causa raiz: "peso médio atual de uma categoria" (em fn_relatorio_rebanho_por_pasto,
-- fn_resumo_rebanho_atual e fn_indicadores_rebanho_dia) sempre foi resolvido como "a última
-- linha escrita em `pesagens` pra esse trio exato" — nunca uma média ponderada de fato. No caso
-- relatado, a otimização "só compila pesagem quando o peso muda" (migração 073c) comparou o
-- peso levado (440) contra o peso já conhecido NA ORIGEM (também 440, sem mudança) e concluiu
-- que nada precisava ser compilado — sem nenhuma noção de que o PASTO DE DESTINO já tinha um
-- sub-lote diferente (380) com quem esses animais precisavam se misturar.
--
-- Correção: um "ledger de peso vivo" — mesmo princípio já usado pro saldo de cabeças
-- (fn_saldo_categoria_pasto: soma entradas, subtrai saídas) só que somando peso_total_kg (já
-- sempre derivado = peso_medio_kg × quantidade desde a Fase 0, migração 073) em vez de
-- quantidade. Uma Pesagem MANUAL (lançada na tela de Pesagens, nunca uma compilada
-- automaticamente de movimentação) recalibra o ledger — "reseta" o histórico anterior e vira a
-- nova base a partir daquela data (Opção A, já confirmada pelo usuário na discussão original).
--
-- Pedido explícito do usuário: essa ponderação vale pra QUALQUER lugar que resolve "peso médio
-- atual de uma categoria", não só o relatório por pasto — por isso o mesmo ledger também
-- substitui a leitura em fn_resumo_rebanho_atual (Painel) e fn_indicadores_rebanho_dia
-- (Relatório de Lotação + Relatórios Financeiros), além do auto-preenchimento de peso numa
-- Mudança de Pasto sem peso informado (fn_calcular_peso_total_movimentacao).

-- ---------------------------------------------------------------------
-- fn_peso_vivo_total_categoria_pasto: peso vivo total (kg) de uma categoria num pasto, numa
-- data — soma ponderada via ledger (mesma classificação de entrada/saída de
-- fn_saldo_categoria_pasto, só que somando peso_total_kg em vez de quantidade), reiniciado a
-- partir da Pesagem manual mais recente pra esse trio (se existir alguma).
-- ---------------------------------------------------------------------
create or replace function fn_peso_vivo_total_categoria_pasto(
  p_fazenda_id uuid, p_categoria_id uuid, p_pasto_id uuid, p_data date
)
returns numeric
language plpgsql
stable
as $$
declare
  v_data_reset date;
  v_peso_reset numeric;
  v_base       numeric := 0;
  v_entradas   numeric;
  v_saidas     numeric;
begin
  select p.data, p.peso_medio_kg into v_data_reset, v_peso_reset
  from pesagens p
  where p.fazenda_id = p_fazenda_id and p.categoria_id = p_categoria_id and p.pasto_id = p_pasto_id
    and p.movimentacao_id is null and p.data <= p_data
  order by p.data desc, p.created_at desc
  limit 1;

  if v_data_reset is not null then
    v_base := v_peso_reset * fn_saldo_categoria_pasto(p_fazenda_id, p_categoria_id, p_pasto_id, v_data_reset);
  end if;

  select coalesce(sum(peso_total_kg), 0) into v_entradas
  from (
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
    union all
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
    union all
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
    union all
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
  ) e;

  select coalesce(sum(peso_total_kg), 0) into v_saidas
  from (
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
    union all
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
    union all
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
    union all
    select peso_total_kg from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
      and (v_data_reset is null or data > v_data_reset)
  ) s;

  return v_base + v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_peso_vivo_total_categoria_fazendas: mesma ideia, agregada sobre todos os pastos de uma ou
-- mais fazendas — soma fn_peso_vivo_total_categoria_pasto sobre cada pasto (mesmo princípio já
-- usado pra saldo de cabeças: fn_saldo_categoria = soma, sobre todos os pastos, de
-- fn_saldo_categoria_pasto). Necessário fazer por pasto (não um "reset" único pra fazenda
-- inteira) porque cada pasto pode ter sido repesado fisicamente em datas diferentes — um reset
-- de fazenda inteira ignoraria isso e misturaria pasto recém-pesado com pasto desatualizado.
-- ---------------------------------------------------------------------
create or replace function fn_peso_vivo_total_categoria_fazendas(
  p_fazenda_ids uuid[], p_categoria_id uuid, p_data date
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_pasto record;
begin
  for v_pasto in (
    select p.id as pasto_id, m.fazenda_id
    from pastos p
    join modulos m on m.id = p.modulo_id
    where m.fazenda_id = any(p_fazenda_ids)
  )
  loop
    v_total := v_total + fn_peso_vivo_total_categoria_pasto(v_pasto.fazenda_id, p_categoria_id, v_pasto.pasto_id, p_data);
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_relatorio_rebanho_por_pasto: peso_medio_kg passa a ser a média ponderada do ledger
-- (peso vivo total do PASTO INTEIRO, sem filtro de proprietário — peso médio não depende de
-- quem é o dono — dividido pela quantidade total do pasto), em vez da última pesagem escrita.
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
  v_pasto            record;
  v_categoria        record;
  v_qtd              int;
  v_qtd_total_pasto  int;
  v_peso_vivo        numeric;
  v_prop             uuid;
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
        v_qtd_total_pasto := fn_saldo_categoria_pasto(p_fazenda_id, v_categoria.id, v_pasto.id, p_data);
        v_peso_vivo := case
          when v_qtd_total_pasto > 0 then fn_peso_vivo_total_categoria_pasto(p_fazenda_id, v_categoria.id, v_pasto.id, p_data)
          else null
        end;

        pasto_id := v_pasto.id;
        pasto_nome := v_pasto.nome;
        pasto_ordem := v_pasto.ordem;
        categoria_id := v_categoria.id;
        categoria_nome := v_categoria.nome;
        quantidade := v_qtd;
        peso_medio_kg := case
          when v_peso_vivo is not null and v_peso_vivo > 0 and v_qtd_total_pasto > 0
            then round(v_peso_vivo / v_qtd_total_pasto, 2)
          else v_categoria.peso_referencia_kg
        end;

        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_calcular_peso_total_movimentacao: o auto-preenchimento de peso numa Mudança de Pasto sem
-- peso informado passa a usar a média ponderada do ledger do PASTO DE ORIGEM (o que já está lá
-- antes desse lançamento), em vez de "a última pesagem conhecida" — mesmo princípio de "sem
-- fallback cruzado", só que agora corretamente ponderado.
-- ---------------------------------------------------------------------
create or replace function fn_calcular_peso_total_movimentacao()
returns trigger as $$
declare
  v_peso            numeric;
  v_qtd_origem      int;
  v_peso_vivo_origem numeric;
begin
  if new.tipo = 'MUDANCA_PASTO' and new.peso_medio_kg is null then
    v_qtd_origem := fn_saldo_categoria_pasto(new.fazenda_id, new.categoria_id, new.pasto_id, new.data);
    v_peso_vivo_origem := case
      when v_qtd_origem > 0 then fn_peso_vivo_total_categoria_pasto(new.fazenda_id, new.categoria_id, new.pasto_id, new.data)
      else null
    end;

    if v_peso_vivo_origem is not null and v_peso_vivo_origem > 0 and v_qtd_origem > 0 then
      v_peso := round(v_peso_vivo_origem / v_qtd_origem, 2);
    else
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
-- fn_resumo_rebanho_atual (Painel): peso_medio_kg passa a ser a média ponderada do ledger,
-- somada sobre todos os pastos da(s) fazenda(s) — em vez da última pesagem conhecida.
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
      round(
        nullif(fn_peso_vivo_total_categoria_fazendas(array[e.fazenda_id], e.categoria_id, current_date), 0)
        / nullif(e.saldo_atual, 0),
        2
      ),
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
-- fn_indicadores_rebanho_dia (Relatório de Lotação + Relatórios Financeiros): peso vivo total
-- passa a ser resolvido pela média ponderada do ledger (somada sobre todos os pastos das
-- fazendas selecionadas), em vez da última pesagem conhecida — peso médio continua sem filtro
-- de proprietário (resolvido pelo headcount TOTAL da categoria, nunca o filtrado), mesmo
-- princípio já documentado antes desta migração.
-- ---------------------------------------------------------------------
create or replace function fn_indicadores_rebanho_dia(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(headcount int, peso_vivo_total numeric)
language plpgsql
stable
as $$
declare
  v_headcount       int := 0;
  v_peso_vivo_total numeric := 0;
  v_cat             record;
  v_qtd_total       int;
  v_peso_vivo_cat   numeric;
  v_peso_medio      numeric;
begin
  for v_cat in (
    select e.categoria_id, e.quantidade, c.peso_referencia_kg
    from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data, p_proprietario_ids) e
    join categorias_animal c on c.id = e.categoria_id
    where e.quantidade > 0
  )
  loop
    v_headcount := v_headcount + v_cat.quantidade;

    select coalesce(sum(e2.quantidade), 0) into v_qtd_total
    from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data, null) e2
    where e2.categoria_id = v_cat.categoria_id;

    v_peso_vivo_cat := case
      when v_qtd_total > 0 then fn_peso_vivo_total_categoria_fazendas(p_fazenda_ids, v_cat.categoria_id, p_data)
      else null
    end;

    v_peso_medio := case
      when v_peso_vivo_cat is not null and v_peso_vivo_cat > 0 and v_qtd_total > 0 then v_peso_vivo_cat / v_qtd_total
      else v_cat.peso_referencia_kg
    end;

    v_peso_vivo_total := v_peso_vivo_total + v_cat.quantidade * v_peso_medio;
  end loop;

  headcount := v_headcount;
  peso_vivo_total := v_peso_vivo_total;
  return next;
end;
$$;
