-- =====================================================================
-- ORION AGRO — Migração 031
--
-- Simplifica o lote de nascimento de bezerros: remove a dimensão de mês
-- (mes_nascimento), mantém só a safra. Decisão do usuário após revisar
-- a migração 030 na prática — mês exigia um segundo campo em todo
-- lançamento (obrigatório em Compra/Saldo Inicial, seletor de dois
-- níveis nas saídas) sem ganho proporcional: o objetivo de "simples e
-- robusto" do sistema pesa mais que o detalhamento por mês, que de
-- qualquer forma não sobrevive além do lançamento de entrada (uma
-- movimentação de saída não carrega "qual mês" foi puxado, só quanto).
-- Perda real: não dá mais pra perguntar "quantos nasceram em junho"
-- depois do lançamento inicial — só "quantos da safra 2025/2026" (via
-- fn_saldo_categoria_safra). A data exata de cada Nascimento/Compra/
-- Saldo Inicial continua no campo `data` de cada lançamento, só não
-- alimenta mais uma dimensão de saldo separada.
-- =====================================================================

alter table movimentacoes_rebanho drop column mes_nascimento;

comment on column movimentacoes_rebanho.safra_nascimento_ano_inicio is
  'Ano de início da safra de nascimento do bezerro (ex.: 2025 para "2025/2026"). Sugerido automaticamente a partir da data (regra julho-junho), mas sempre editável — a parição real pode cair fora da janela calendário.';

-- ---------------------------------------------------------------------
-- fn_validar_lote_nascimento_bezerro: mesmas regras da migração 030,
-- exigindo apenas safra (não mais mês).
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
    if new.safra_nascimento_ano_inicio is null then
      raise exception 'Informe a safra de nascimento do lote de bezerros envolvido.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_safra: substitui fn_saldo_categoria_safra_mes,
-- agora só por (fazenda, categoria, safra).
-- ---------------------------------------------------------------------

drop function if exists fn_saldo_categoria_safra_mes(uuid, uuid, int, date, date);

create or replace function fn_saldo_categoria_safra(
  p_fazenda_id uuid, p_categoria_id uuid, p_safra int, p_data date
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
      and safra_nascimento_ano_inicio = p_safra
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_lotes_nascimento_disponiveis: retorna agora só (safra, saldo) —
-- muda o formato de retorno, por isso precisa de drop antes do create.
-- ---------------------------------------------------------------------

drop function if exists fn_lotes_nascimento_disponiveis(uuid, uuid, date);

create or replace function fn_lotes_nascimento_disponiveis(p_fazenda_id uuid, p_categoria_id uuid, p_data date)
returns table(safra int, saldo int)
language plpgsql
stable
as $$
begin
  return query
  select t.safra_nascimento_ano_inicio, s.saldo
  from (
    select distinct safra_nascimento_ano_inicio
    from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio is not null
      and data <= p_data
  ) t
  cross join lateral (
    select fn_saldo_categoria_safra(p_fazenda_id, p_categoria_id, t.safra_nascimento_ano_inicio, p_data) as saldo
  ) s
  where s.saldo > 0
  order by t.safra_nascimento_ano_inicio;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_validar_saldo_categoria: checagem do lote agora via
-- fn_saldo_categoria_safra (sem mês).
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

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- fn_delta_para_par_lote / fn_checar_saldo_lote_futuro: mesma
-- trajetória da migração 030, agora só por safra (sem mês) — mudam de
-- assinatura, por isso precisam de drop das versões antigas.
-- ---------------------------------------------------------------------

drop function if exists fn_delta_para_par_lote(tipo_movimentacao, uuid, uuid, uuid, uuid, int, date, int, uuid, uuid, int, date);

create or replace function fn_delta_para_par_lote(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_safra int, p_quantidade int,
  p_par_fazenda_id uuid, p_par_categoria_id uuid, p_par_safra int
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_safra is null or p_par_safra is null or p_safra <> p_par_safra then
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

drop function if exists fn_checar_saldo_lote_futuro(uuid, tipo_movimentacao, uuid, uuid, uuid, uuid, int, date, date, int);

create or replace function fn_checar_saldo_lote_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_safra int, p_data date, p_quantidade int
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
    select distinct fazenda_id, categoria_id, safra from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.safra_nascimento_ano_inicio),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.safra_nascimento_ano_inicio),
        (p_fazenda_id, p_categoria_id, p_safra),
        (p_fazenda_destino_id, p_categoria_id, p_safra)
    ) as t(fazenda_id, categoria_id, safra)
    where fazenda_id is not null and categoria_id is not null and safra is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.safra_nascimento_ano_inicio = v_par.safra
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_safra(v_par.fazenda_id, v_par.categoria_id, v_par.safra, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_lote(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.safra_nascimento_ano_inicio, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.safra)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_lote(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_safra, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.safra)
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

-- ---------------------------------------------------------------------
-- fn_validar_edicao_movimentacao / fn_validar_delete_movimentacao:
-- chamam fn_checar_saldo_lote_futuro sem mês.
-- ---------------------------------------------------------------------

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

  return old;
end;
$$ language plpgsql;

-- =====================================================================
-- FIM DA MIGRAÇÃO 031
-- =====================================================================
