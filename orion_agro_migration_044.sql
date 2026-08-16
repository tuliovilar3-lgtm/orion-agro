-- =====================================================================
-- ORION AGRO — Migração 044
--
-- Proprietário do lote de gado na movimentação de rebanho. Em algumas
-- fazendas mais de um proprietário tem animais na mesma fazenda (ex.:
-- parceria, arrendamento, sociedade entre parentes) — diferente do
-- proprietário da terra (fazendas.proprietario_id, singular, cadastral).
--
-- Decisões fechadas com o usuário:
-- - Dimensão nova e independente do ledger, mesmo molde já usado pra
--   pasto e safra de nascimento: coluna própria em movimentacoes_rebanho,
--   saldo por (fazenda, categoria, proprietario, data), trajetória de
--   edição/exclusão própria, checagem de saldo insuficiente própria.
-- - NÃO cruza com pasto — o gado de um proprietário pode se misturar no
--   mesmo pasto de outro, mesmo princípio já usado pra não cruzar
--   pasto×safra (complexidade desproporcional sem necessidade real).
-- - PRECISA alimentar separação financeira: como o lançamento em lote já
--   é linha-a-linha (categoria+quantidade+peso+preço por linha, com
--   desconto/acréscimo já rateado por linha), proprietário por linha
--   já resolve o valor por proprietário sem nenhuma lógica nova de
--   rateio — só mais um campo por linha, igual safra.
-- - Totalmente opcional (nullable, sem exigência condicional como safra
--   tem pra bezerro) — a maioria das fazendas continua com 0 ou 1
--   proprietário vinculado, então o campo nunca aparece pra elas.
-- - Proprietários "selecionáveis" numa fazenda são só os vinculados a
--   ela via fazenda_proprietarios (tabela nova) — não expõe a lista
--   inteira de pessoas com papel PROPRIETARIO do sistema todo, separado
--   do proprietario_id singular já existente no cadastro da fazenda
--   (dono da terra, que pode ou não coincidir com os donos do gado).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) fazenda_proprietarios: quais pessoas (papel PROPRIETARIO) podem
-- ser atribuídas como dono de um lote de gado numa fazenda específica.
-- ---------------------------------------------------------------------

create table fazenda_proprietarios (
  id           uuid primary key default gen_random_uuid(),
  fazenda_id   uuid not null references fazendas(id),
  pessoa_id    uuid not null references pessoas(id),
  criado_em    timestamptz not null default now(),
  unique (fazenda_id, pessoa_id)
);

comment on table fazenda_proprietarios is
  'Pessoas (papel PROPRIETARIO) autorizadas a serem atribuídas como dono de um lote de gado nessa fazenda — separado de fazendas.proprietario_id, que é o dono da terra (cadastral, singular).';

-- ---------------------------------------------------------------------
-- 2) Coluna nova em movimentacoes_rebanho — nullable, mesmo princípio
-- de safra_nascimento_ano_inicio: só é preenchida quando o usuário
-- explicitamente atribui a linha a um proprietário.
-- ---------------------------------------------------------------------

alter table movimentacoes_rebanho add column proprietario_id uuid references pessoas(id);

comment on column movimentacoes_rebanho.proprietario_id is
  'Proprietário do lote de gado dessa linha, quando a fazenda tem mais de um proprietário vinculado (fazenda_proprietarios). Opcional — a maioria dos lançamentos não usa.';

-- ---------------------------------------------------------------------
-- 3) TRIGGER: quando preenchido, proprietario_id precisa estar
-- vinculado à fazenda do lançamento (mesmo princípio de
-- fn_validar_pasto_pertence_fazenda) — em TRANSFERENCIA, checa a
-- fazenda de origem (de onde o lote está saindo).
-- ---------------------------------------------------------------------

create or replace function fn_validar_proprietario_pertence_fazenda()
returns trigger as $$
declare
  v_fazenda_esperada uuid;
begin
  if new.proprietario_id is null then
    return new;
  end if;

  v_fazenda_esperada := coalesce(new.fazenda_origem_id, new.fazenda_id);

  if not exists (
    select 1 from fazenda_proprietarios
    where fazenda_id = v_fazenda_esperada and pessoa_id = new.proprietario_id
  ) then
    raise exception 'O proprietário selecionado não está vinculado a essa fazenda.';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_proprietario_pertence_fazenda
before insert or update on movimentacoes_rebanho
for each row execute function fn_validar_proprietario_pertence_fazenda();

-- ---------------------------------------------------------------------
-- 4) fn_saldo_categoria_proprietario: mesma receita de
-- fn_saldo_categoria_safra, por (fazenda, categoria, proprietario).
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_proprietario(
  p_fazenda_id uuid, p_categoria_id uuid, p_proprietario_id uuid, p_data date
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
      and proprietario_id = p_proprietario_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) fn_validar_saldo_categoria passa a checar também o saldo por
-- proprietário, quando informado — mesmo princípio de defesa em
-- profundidade já usado pro nível de pasto e de lote de nascimento.
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem   uuid;
  v_saldo              int;
  v_saldo_pasto        int;
  v_saldo_lote         int;
  v_saldo_proprietario int;
  v_nome_pasto         text;
  v_fazenda_lote       uuid;
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

  if new.safra_nascimento_ano_inicio is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA') then
    v_fazenda_lote := case when new.tipo = 'TRANSFERENCIA' then new.fazenda_origem_id else new.fazenda_id end;
    v_saldo_lote := fn_saldo_categoria_safra(v_fazenda_lote, new.categoria_id, new.safra_nascimento_ano_inicio, new.data);
    if v_saldo_lote < new.quantidade then
      raise exception 'Saldo insuficiente no lote de nascimento (safra %/%): % cabeça(s) disponível(is) na data %, mas % foi(ram) solicitada(s).',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        v_saldo_lote, new.data, new.quantidade;
    end if;
  end if;

  if new.proprietario_id is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA') then
    v_fazenda_lote := case when new.tipo = 'TRANSFERENCIA' then new.fazenda_origem_id else new.fazenda_id end;
    v_saldo_proprietario := fn_saldo_categoria_proprietario(v_fazenda_lote, new.categoria_id, new.proprietario_id, new.data);
    if v_saldo_proprietario < new.quantidade then
      raise exception 'Saldo insuficiente para esse proprietário: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_saldo_proprietario, new.data, new.quantidade;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 6) Trajetória de edição/exclusão ciente de proprietário — mesma
-- receita de fn_delta_para_par_lote/fn_checar_saldo_lote_futuro (que
-- por sua vez já espelha fn_delta_para_par/fn_checar_edicao_movimentacao
-- do nível de pasto), agora pra dimensão (fazenda, categoria,
-- proprietario). Fica numa função própria, chamada como checagem
-- adicional dentro das triggers de editar/apagar já existentes.
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par_proprietario(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_proprietario_id uuid, p_quantidade int,
  p_par_fazenda_id uuid, p_par_categoria_id uuid, p_par_proprietario_id uuid
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_proprietario_id is null or p_par_proprietario_id is null or p_proprietario_id <> p_par_proprietario_id then
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

create or replace function fn_checar_saldo_proprietario_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_proprietario_id uuid, p_data date, p_quantidade int
) returns table(saldo_ficaria_negativo boolean, data_saldo_negativo date, saldo_minimo int)
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
    select distinct fazenda_id, categoria_id, proprietario_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.proprietario_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.proprietario_id),
        (p_fazenda_id, p_categoria_id, p_proprietario_id),
        (p_fazenda_destino_id, p_categoria_id, p_proprietario_id)
    ) as t(fazenda_id, categoria_id, proprietario_id)
    where fazenda_id is not null and categoria_id is not null and proprietario_id is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.proprietario_id = v_par.proprietario_id
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_proprietario(v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_proprietario(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.proprietario_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_proprietario(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_proprietario_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id)
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

-- fn_validar_edicao_movimentacao / fn_validar_delete_movimentacao
-- passam a checar também a trajetória por proprietário, além das já
-- existentes (pasto e lote de nascimento).

create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check      record;
  v_check_lote record;
  v_check_prop record;
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

  if new.safra_nascimento_ano_inicio is not null then
    select * into v_check_lote from fn_checar_saldo_lote_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.safra_nascimento_ano_inicio, new.data, new.quantidade
    );
    if v_check_lote.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo do lote de nascimento (safra %/%) ficaria negativo (%) em %.',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        v_check_lote.saldo_minimo, v_check_lote.data_saldo_negativo;
    end if;
  end if;

  if new.proprietario_id is not null then
    select * into v_check_prop from fn_checar_saldo_proprietario_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.proprietario_id, new.data, new.quantidade
    );
    if v_check_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo desse proprietário ficaria negativo (%) em %.',
        v_check_prop.saldo_minimo, v_check_prop.data_saldo_negativo;
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
  v_check_prop record;
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

  if old.safra_nascimento_ano_inicio is not null then
    select * into v_check_lote from fn_checar_saldo_lote_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.safra_nascimento_ano_inicio, old.data, 0
    );
    if v_check_lote.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo do lote de nascimento (safra %/%) ficaria negativo (%) em %.',
        old.safra_nascimento_ano_inicio, old.safra_nascimento_ano_inicio + 1,
        v_check_lote.saldo_minimo, v_check_lote.data_saldo_negativo;
    end if;
  end if;

  if old.proprietario_id is not null then
    select * into v_check_prop from fn_checar_saldo_proprietario_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.proprietario_id, old.data, 0
    );
    if v_check_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo desse proprietário ficaria negativo (%) em %.',
        v_check_prop.saldo_minimo, v_check_prop.data_saldo_negativo;
    end if;
  end if;

  return old;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 7) fn_proprietarios_disponiveis_fazenda: lista os proprietários
-- vinculados a uma fazenda — alimenta o seletor no frontend (só
-- aparece quando o resultado tem 2+ linhas).
-- ---------------------------------------------------------------------

create or replace function fn_proprietarios_disponiveis_fazenda(p_fazenda_id uuid)
returns table(pessoa_id uuid, nome text)
language sql
stable
as $$
  select p.id, p.nome
  from fazenda_proprietarios fp
  join pessoas p on p.id = fp.pessoa_id
  where fp.fazenda_id = p_fazenda_id
  order by p.nome;
$$;

-- ---------------------------------------------------------------------
-- 8) fn_relatorio_movimentacao_rebanho ganha um filtro opcional por
-- proprietário (p_proprietario_ids, default null = sem filtro, mesmo
-- comportamento de hoje). Usada tanto por "Resumo de Movimentação de
-- Rebanho" quanto pela seção "Movimentações do período" do Painel —
-- estender essa função cobre as duas telas com uma mudança só. Fica de
-- fora, de propósito: fn_resumo_rebanho_atual (fotografia de hoje sem
-- período) e o Relatório de Lotação — lotação cruza rebanho com área,
-- e área não tem dimensão de proprietário, então uma "lotação do
-- proprietário X" seria enganosa (numerador de um dono só, denominador
-- da fazenda inteira).
--
-- Assinatura muda (parâmetro novo) — precisa de drop antes do create,
-- mesmo princípio já usado sempre que uma função muda de assinatura
-- (ver fn_saldo_categoria_safra_mes -> fn_saldo_categoria_safra na
-- migração 031), pra não deixar duas versões sobrepostas (PostgREST
-- não lida bem com funções sobrecarregadas do mesmo nome).
-- ---------------------------------------------------------------------

drop function if exists fn_relatorio_movimentacao_rebanho(uuid[], date, date);

create or replace function fn_relatorio_movimentacao_rebanho(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date,
  p_proprietario_ids uuid[] default null
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
    case when p_proprietario_ids is null then
      coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_inicio - 1))
        from unnest(p_fazenda_ids) as f(id)), 0)
    else
      coalesce((select sum(fn_saldo_categoria_proprietario(f.id, c.id, pr.id, p_data_inicio - 1))
        from unnest(p_fazenda_ids) as f(id), unnest(p_proprietario_ids) as pr(id)), 0)
    end::int
    + coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'SALDO_INICIAL'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'NASCIMENTO'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'COMPRA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    -- transferência só conta como entrada/saída do grupo quando cruza a
    -- fronteira do grupo selecionado; transferência 100% interna (origem
    -- e destino ambas no grupo) não muda o total e não aparece aqui
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_destino_id = any(p_fazenda_ids) and not (m.fazenda_origem_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MORTE'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo in ('VENDA_PE', 'VENDA_ABATE')
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_origem_id = any(p_fazenda_ids) and not (m.fazenda_destino_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'CONSUMO_DOACAO'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    case when p_proprietario_ids is null then
      coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_fim))
        from unnest(p_fazenda_ids) as f(id)), 0)
    else
      coalesce((select sum(fn_saldo_categoria_proprietario(f.id, c.id, pr.id, p_data_fim))
        from unnest(p_fazenda_ids) as f(id), unnest(p_proprietario_ids) as pr(id)), 0)
    end::int
  from categorias_animal c
  -- sem filtro de ativa aqui de propósito: uma categoria inativada
  -- some dos formulários de lançamento, mas o histórico dela precisa
  -- continuar aparecendo em relatórios de períodos em que teve
  -- movimentação real. Linhas totalmente zeradas (categoria nunca usada
  -- no período, ativa ou não) são filtradas no frontend, não aqui.
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) fn_validar_delete_pessoa passa a checar também proprietario_id em
-- movimentacoes_rebanho e fazenda_proprietarios — sem isso, tentar
-- excluir uma pessoa vinculada como proprietário de gado bateria numa
-- violação de FK crua (sem ON DELETE definido nas duas colunas novas)
-- em vez da mensagem amigável já usada pros outros vínculos.
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_pessoa()
returns trigger as $$
begin
  if exists (select 1 from movimentacoes_rebanho where cliente_fornecedor_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa já está referenciada em movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from movimentacoes_rebanho where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de gado em uma ou mais movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from fazendas where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de uma fazenda. Inative-a em vez disso.';
  end if;

  if exists (select 1 from fazenda_proprietarios where pessoa_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa está vinculada como proprietária de gado em uma fazenda. Remova o vínculo (editar a fazenda) antes de excluir.';
  end if;

  delete from pessoa_papeis where pessoa_id = old.id;

  return old;
end;
$$ language plpgsql;

-- =====================================================================
-- FIM DA MIGRAÇÃO 044
-- =====================================================================
