-- =====================================================================
-- ORION AGRO — Migração 030
--
-- Lote de nascimento (safra + mês de nascimento) para bezerros. Estação
-- de monta/parição concentra os nascimentos numa janela do ano — a
-- fazenda quer rastrear de qual safra e mês cada bezerro é, e respeitar
-- esse saldo por lote em qualquer movimentação que envolva bezerro
-- (não só no desmame), senão o saldo por lote vira bagunça.
--
-- Regras fechadas com o usuário:
-- - Safra é sugerida automaticamente (regra julho-junho, já usada nos
--   filtros de relatório) mas SEMPRE editável — casos de borda da
--   parição real podem cair fora da janela calendário.
-- - Mês de nascimento é sempre o mês/ano exatos (data completa quando
--   vem do próprio Nascimento; manual quando a movimentação não tem a
--   data de nascimento real — Compra, Saldo Inicial).
-- - Lote NÃO cruza com pasto (dimensão independente, mais simples) —
--   é só fazenda + categoria + safra + mês.
-- - Bezerro só entra no sistema por Nascimento, Compra ou Saldo
--   Inicial. Mudança de Categoria nunca pode envolver categoria de
--   bezerro (nem como origem, nem como destino) — a única evolução de
--   bezerro é o Desmame.
-- - Desmame passa a exigir categoria destino com era 08-12 (não basta
--   ser do grupo Jovem genérico).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas novas — nulas, só usadas quando a categoria envolvida é
-- Bezerro/Bezerra Mamando (mesmo princípio de categoria_destino_id,
-- causa_morte etc: campo que só faz sentido em alguns lançamentos).
-- ---------------------------------------------------------------------

alter table movimentacoes_rebanho
  add column safra_nascimento_ano_inicio int,
  add column mes_nascimento date;

comment on column movimentacoes_rebanho.safra_nascimento_ano_inicio is
  'Ano de início da safra de nascimento do bezerro (ex.: 2025 para "2025/2026"). Sugerido automaticamente a partir da data (regra julho-junho), mas sempre editável — a parição real pode cair fora da janela calendário.';
comment on column movimentacoes_rebanho.mes_nascimento is
  'Primeiro dia do mês de nascimento do bezerro (ex.: 2025-06-01). Calculado da própria data em Nascimento; informado manualmente em Compra/Saldo Inicial, já que a data do lançamento não é a data de nascimento.';

-- ---------------------------------------------------------------------
-- fn_categoria_e_bezerro: true se a categoria tem o papel Bezerro/
-- Bezerra Mamando (grupos_categoria_papel.nome) — helper reaproveitado
-- em várias triggers abaixo.
-- ---------------------------------------------------------------------

create or replace function fn_categoria_e_bezerro(p_categoria_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from categorias_animal c
    join grupos_categoria_papel g on g.id = c.grupo_categoria_papel_id
    where c.id = p_categoria_id
      and g.nome in ('Bezerros Mamando', 'Bezerras Mamando')
  );
$$;

-- ---------------------------------------------------------------------
-- 2) Validações de lote de nascimento:
-- - Mudança de Categoria nunca pode envolver bezerro, nem como origem
--   nem como destino — a única evolução de bezerro é o Desmame, e
--   bezerro só entra por Nascimento/Compra/Saldo Inicial.
-- - Desmame exige categoria destino com era 08-12 (não só grupo Jovem).
-- - Todo lançamento cuja categoria (de origem) é bezerro exige
--   safra_nascimento_ano_inicio e mes_nascimento preenchidos —
--   Nascimento, Compra, Saldo Inicial (entram no lote), Morte, Venda em
--   Pé, Venda Abate, Consumo/Doação, Transferência e Desmame (saem do
--   lote). Adicionada como trigger comum (não dá pra checar a
--   categoria com um CHECK simples, que não acessa outras tabelas) —
--   roda pra frente a partir de agora, sem invalidar retroativamente
--   lançamentos antigos (mesmo princípio do peso médio na migração 028).
-- ---------------------------------------------------------------------

create or replace function fn_validar_lote_nascimento_bezerro()
returns trigger as $$
declare
  v_origem_bezerro  boolean;
  v_destino_bezerro boolean;
  v_era_destino     text;
begin
  v_origem_bezerro := fn_categoria_e_bezerro(new.categoria_id);
  v_destino_bezerro := new.categoria_destino_id is not null and fn_categoria_e_bezerro(new.categoria_destino_id);

  if new.tipo = 'MUDANCA_CATEGORIA' then
    if v_origem_bezerro or v_destino_bezerro then
      raise exception 'Mudança de Categoria não pode ser usada com categoria de bezerro — bezerros só evoluem de categoria pelo Desmame, e só entram no sistema por Nascimento, Compra ou Saldo Inicial.';
    end if;
    return new;
  end if;

  if new.tipo = 'DESMAME' then
    select era into v_era_destino from categorias_animal where id = new.categoria_destino_id;
    if v_era_destino is distinct from '08-12' then
      raise exception 'A categoria destino do Desmame precisa ter era 08-12.';
    end if;
  end if;

  if v_origem_bezerro and new.tipo in (
    'NASCIMENTO', 'COMPRA', 'SALDO_INICIAL',
    'MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA'
  ) then
    if new.safra_nascimento_ano_inicio is null or new.mes_nascimento is null then
      raise exception 'Informe a safra e o mês de nascimento do lote de bezerros envolvido.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_lote_nascimento_bezerro
before insert or update on movimentacoes_rebanho
for each row execute function fn_validar_lote_nascimento_bezerro();

-- ---------------------------------------------------------------------
-- 3) fn_saldo_categoria_safra_mes: mesma ideia de fn_saldo_categoria,
-- só que refinada pro lote de nascimento (fazenda + categoria + safra +
-- mês) em vez de pasto — dimensão independente, não cruza com pasto
-- (decisão explícita, pra não multiplicar a complexidade: fazenda +
-- pasto + lote ao mesmo tempo).
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_safra_mes(
  p_fazenda_id uuid, p_categoria_id uuid, p_safra int, p_mes date, p_data date
)
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
      and safra_nascimento_ano_inicio = p_safra and mes_nascimento = p_mes
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra and mes_nascimento = p_mes
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra and mes_nascimento = p_mes
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra and mes_nascimento = p_mes
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) fn_validar_saldo_categoria passa a checar também o saldo do lote
-- de nascimento, quando aplicável — mesmo princípio de defesa em
-- profundidade já usado pro nível de pasto.
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem uuid;
  v_saldo            int;
  v_saldo_pasto      int;
  v_saldo_lote       int;
  v_nome_pasto       text;
  v_fazenda_lote     uuid;
begin
  if new.tipo in ('VENDA_PE', 'VENDA_ABATE', 'MORTE', 'CONSUMO_DOACAO', 'DESMAME', 'MUDANCA_CATEGORIA') then
    v_fazenda_checagem := new.fazenda_id;
  elsif new.tipo = 'TRANSFERENCIA' then
    v_fazenda_checagem := new.fazenda_origem_id;
  elsif new.tipo = 'MUDANCA_PASTO' then
    v_fazenda_checagem := null;
  else
    return new;
  end if;

  if v_fazenda_checagem is not null then
    v_saldo := fn_saldo_categoria(v_fazenda_checagem, new.categoria_id, new.data);
    if v_saldo < new.quantidade then
      raise exception 'Saldo insuficiente: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_saldo, new.data, new.quantidade;
    end if;
  end if;

  v_saldo_pasto := fn_saldo_categoria_pasto(new.fazenda_id, new.categoria_id, new.pasto_id, new.data);
  if v_saldo_pasto < new.quantidade then
    select nome into v_nome_pasto from pastos where id = new.pasto_id;
    raise exception 'Saldo insuficiente no pasto %: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
      v_nome_pasto, v_saldo_pasto, new.data, new.quantidade;
  end if;

  if new.safra_nascimento_ano_inicio is not null and new.mes_nascimento is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA') then
    v_fazenda_lote := case when new.tipo = 'TRANSFERENCIA' then new.fazenda_origem_id else new.fazenda_id end;
    v_saldo_lote := fn_saldo_categoria_safra_mes(
      v_fazenda_lote, new.categoria_id, new.safra_nascimento_ano_inicio, new.mes_nascimento, new.data
    );
    if v_saldo_lote < new.quantidade then
      raise exception 'Saldo insuficiente no lote de nascimento (safra %/%, mês %): % cabeça(s) disponível(is) na data %, mas % foi(ram) solicitada(s).',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        to_char(new.mes_nascimento, 'MM/YYYY'), v_saldo_lote, new.data, new.quantidade;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 5) Trajetória de edição/exclusão ciente do lote — mesmo espírito de
-- fn_delta_para_par/fn_checar_edicao_movimentacao, só que pra dimensão
-- de lote (fazenda + categoria + safra + mês) em vez de pasto. Fica
-- numa função própria, separada de fn_checar_edicao_movimentacao (que
-- não muda de assinatura) — só é chamada quando o lançamento envolve
-- lote de nascimento, como uma checagem adicional de defesa em
-- profundidade dentro das triggers de editar/apagar já existentes (não
-- entra na tela como um segundo aviso "sim/não" — se desse negativo,
-- bloqueia direto, igual qualquer outra violação de saldo).
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par_lote(
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_safra int,
  p_mes date,
  p_quantidade int,
  p_par_fazenda_id uuid,
  p_par_categoria_id uuid,
  p_par_safra int,
  p_par_mes date
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_safra is null or p_mes is null or p_par_safra is null or p_par_mes is null
     or p_safra <> p_par_safra or p_mes <> p_par_mes then
    return 0;
  end if;

  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo = 'TRANSFERENCIA' then
    if p_fazenda_origem_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_destino_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  end if;
  return v_total;
end;
$$;

create or replace function fn_checar_saldo_lote_futuro(
  p_id uuid,
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_safra int,
  p_mes date,
  p_data date,
  p_quantidade int
) returns table(
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  saldo_minimo int
)
language plpgsql
as $$
declare
  v_old        movimentacoes_rebanho%rowtype;
  v_par        record;
  v_data       date;
  v_saldo      int;
  v_pior_saldo int;
  v_pior_data  date;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id, safra, mes from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.safra_nascimento_ano_inicio, v_old.mes_nascimento),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.safra_nascimento_ano_inicio, v_old.mes_nascimento),
        (p_fazenda_id, p_categoria_id, p_safra, p_mes),
        (p_fazenda_destino_id, p_categoria_id, p_safra, p_mes)
    ) as t(fazenda_id, categoria_id, safra, mes)
    where fazenda_id is not null and categoria_id is not null and safra is not null and mes is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.safra_nascimento_ano_inicio = v_par.safra and m.mes_nascimento = v_par.mes
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_safra_mes(v_par.fazenda_id, v_par.categoria_id, v_par.safra, v_par.mes, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_lote(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.safra_nascimento_ano_inicio, v_old.mes_nascimento, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.safra, v_par.mes)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_lote(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_safra, p_mes, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.safra, v_par.mes)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
      end if;
    end loop;
  end loop;

  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  return next;
end;
$$;

-- fn_validar_edicao_movimentacao e fn_validar_delete_movimentacao
-- passam a checar também a trajetória do lote de nascimento, além da
-- trajetória de pasto que já checavam.

create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check      record;
  v_check_lote record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
    new.categoria_id, new.categoria_destino_id, new.pasto_id, new.pasto_destino_id,
    new.data, new.quantidade
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível editar: o saldo da categoria % no pasto % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.pasto_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  if new.safra_nascimento_ano_inicio is not null and new.mes_nascimento is not null then
    select * into v_check_lote from fn_checar_saldo_lote_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.safra_nascimento_ano_inicio, new.mes_nascimento, new.data, new.quantidade
    );
    if v_check_lote.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo do lote de nascimento (safra %/%, mês %) ficaria negativo (%) em %.',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        to_char(new.mes_nascimento, 'MM/YYYY'), v_check_lote.saldo_minimo, v_check_lote.data_saldo_negativo;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create or replace function fn_validar_delete_movimentacao()
returns trigger as $$
declare
  v_check      record;
  v_check_lote record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
    old.categoria_id, old.categoria_destino_id, old.pasto_id, old.pasto_destino_id,
    old.data, 0
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível excluir: o saldo da categoria % no pasto % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.pasto_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  if old.safra_nascimento_ano_inicio is not null and old.mes_nascimento is not null then
    select * into v_check_lote from fn_checar_saldo_lote_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.safra_nascimento_ano_inicio, old.mes_nascimento, old.data, 0
    );
    if v_check_lote.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo do lote de nascimento (safra %/%, mês %) ficaria negativo (%) em %.',
        old.safra_nascimento_ano_inicio, old.safra_nascimento_ano_inicio + 1,
        to_char(old.mes_nascimento, 'MM/YYYY'), v_check_lote.saldo_minimo, v_check_lote.data_saldo_negativo;
    end if;
  end if;

  return old;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- fn_lotes_nascimento_disponiveis: lista os lotes (safra + mês de
-- nascimento) com saldo > 0 numa fazenda+categoria numa data — alimenta
-- o seletor de lote no frontend (Desmame e as demais movimentações de
-- saída — Morte, Venda em Pé, Venda Abate, Consumo/Doação,
-- Transferência — quando a categoria envolvida é bezerro), mostrando
-- só a quantidade disponível, sem informação de peso (não faz sentido
-- pro lote de origem).
-- ---------------------------------------------------------------------

create or replace function fn_lotes_nascimento_disponiveis(p_fazenda_id uuid, p_categoria_id uuid, p_data date)
returns table(safra int, mes date, saldo int)
language plpgsql
stable
as $$
begin
  return query
  select t.safra_nascimento_ano_inicio, t.mes_nascimento, s.saldo
  from (
    select distinct safra_nascimento_ano_inicio, mes_nascimento
    from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio is not null and mes_nascimento is not null
      and data <= p_data
  ) t
  cross join lateral (
    select fn_saldo_categoria_safra_mes(p_fazenda_id, p_categoria_id, t.safra_nascimento_ano_inicio, t.mes_nascimento, p_data) as saldo
  ) s
  where s.saldo > 0
  order by t.safra_nascimento_ano_inicio, t.mes_nascimento;
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 030
-- =====================================================================
