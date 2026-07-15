-- =====================================================================
-- ORION AGRO — Migração 020
-- Rode DEPOIS da migração 019.
--
-- Controle de rebanho por pasto — parte 2: saldo e trajetória de
-- edição/exclusão passam a considerar o pasto, não só a fazenda.
--
-- fn_delta_para_par e fn_checar_edicao_movimentacao mudam de
-- quantidade de parâmetros (e fn_checar_edicao_movimentacao também
-- muda as colunas de retorno) — CREATE OR REPLACE não troca a função
-- existente nesse caso, cria uma segunda sobrecarga (mesmo problema já
-- visto na migração 013). Por isso as duas são dropadas explicitamente
-- pela assinatura atual antes de recriar.
-- =====================================================================

drop function if exists fn_checar_edicao_movimentacao(
  uuid, tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, date, integer
);

drop function if exists fn_delta_para_par(
  tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid
);

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_pasto: mesma ideia de fn_saldo_categoria, mas
-- refinada pro nível de pasto. Fazenda que não usa controla_pasto só
-- tem o pasto "Geral", então o saldo por pasto coincide com o saldo da
-- fazenda inteira nesse caso. Vale sempre:
-- fn_saldo_categoria(fazenda, categoria, data) = soma, sobre todos os
-- pastos da fazenda, de fn_saldo_categoria_pasto(fazenda, categoria,
-- pasto, data) — MUDANCA_PASTO sempre entra e sai dentro da mesma
-- fazenda, então não altera esse total.
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_pasto(p_fazenda_id uuid, p_categoria_id uuid, p_pasto_id uuid, p_data date)
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
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_delta_para_par — agora recebe pasto_id/pasto_destino_id e um
-- p_par_pasto_id, respondendo "quanto essa linha contribui pro trio
-- (fazenda, categoria, pasto)" em vez de só (fazenda, categoria).
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par(
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_pasto_id uuid,
  p_pasto_destino_id uuid,
  p_quantidade int,
  p_par_fazenda_id uuid,
  p_par_categoria_id uuid,
  p_par_pasto_id uuid
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo in ('MUDANCA_CATEGORIA', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_destino_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo = 'TRANSFERENCIA' then
    if p_fazenda_origem_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_destino_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_destino_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo = 'MUDANCA_PASTO' then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_destino_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  end if;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_checar_edicao_movimentacao — trios (fazenda, categoria, pasto) no
-- lugar dos pares (fazenda, categoria). Checar a trajetória em todo
-- trio afetado no nível de pasto cobre também o nível de fazenda
-- inteira (soma dos pastos = saldo da fazenda), então não precisa mais
-- checar fazenda e pasto separadamente aqui.
-- ---------------------------------------------------------------------

create or replace function fn_checar_edicao_movimentacao(
  p_id uuid,
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_pasto_id uuid,
  p_pasto_destino_id uuid,
  p_data date,
  p_quantidade int
) returns table(
  tem_movimentacoes_futuras boolean,
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  categoria_saldo_negativo text,
  pasto_saldo_negativo text,
  saldo_minimo int
)
language plpgsql
as $$
declare
  v_old            movimentacoes_rebanho%rowtype;
  v_par            record;
  v_data           date;
  v_saldo          int;
  v_pior_saldo     int;
  v_pior_data      date;
  v_pior_categoria uuid;
  v_pior_pasto     uuid;
  v_tem_futuras    boolean := false;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id, pasto_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_id),
        (v_old.fazenda_id, v_old.categoria_destino_id, v_old.pasto_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.pasto_destino_id),
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_destino_id),
        (p_fazenda_id, p_categoria_id, p_pasto_id),
        (p_fazenda_id, p_categoria_destino_id, p_pasto_id),
        (p_fazenda_destino_id, p_categoria_id, p_pasto_destino_id),
        (p_fazenda_id, p_categoria_id, p_pasto_destino_id)
    ) as t(fazenda_id, categoria_id, pasto_id)
    where fazenda_id is not null and categoria_id is not null and pasto_id is not null
  )
  loop
    if exists (
      select 1 from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data > p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
        )
    ) then
      v_tem_futuras := true;
    end if;

    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_pasto(v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.categoria_destino_id,
                                    v_old.pasto_id, v_old.pasto_destino_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id,
                                    p_pasto_id, p_pasto_destino_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
        v_pior_categoria := v_par.categoria_id;
        v_pior_pasto := v_par.pasto_id;
      end if;
    end loop;
  end loop;

  tem_movimentacoes_futuras := v_tem_futuras;
  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  select nome into categoria_saldo_negativo from categorias_animal where id = v_pior_categoria;
  select nome into pasto_saldo_negativo from pastos where id = v_pior_pasto;

  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_validar_saldo_categoria — passa a checar também o saldo do pasto
-- específico (cobre MUDANCA_PASTO, que não muda o saldo da fazenda).
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem uuid;
  v_saldo            int;
  v_saldo_pasto      int;
  v_nome_pasto       text;
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

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- fn_validar_pasto_pertence_fazenda — garante que pasto_id (e
-- pasto_destino_id, quando usado) realmente pertencem à fazenda do
-- lançamento.
-- ---------------------------------------------------------------------

create or replace function fn_validar_pasto_pertence_fazenda()
returns trigger as $$
declare
  v_fazenda_pasto         uuid;
  v_fazenda_pasto_destino uuid;
  v_fazenda_esperada      uuid;
begin
  select m.fazenda_id into v_fazenda_pasto
  from pastos p join modulos m on m.id = p.modulo_id
  where p.id = new.pasto_id;

  v_fazenda_esperada := coalesce(new.fazenda_origem_id, new.fazenda_id);
  if v_fazenda_pasto is distinct from v_fazenda_esperada then
    raise exception 'O pasto selecionado não pertence à fazenda do lançamento.';
  end if;

  if new.pasto_destino_id is not null then
    select m.fazenda_id into v_fazenda_pasto_destino
    from pastos p join modulos m on m.id = p.modulo_id
    where p.id = new.pasto_destino_id;

    v_fazenda_esperada := coalesce(new.fazenda_destino_id, new.fazenda_id);
    if v_fazenda_pasto_destino is distinct from v_fazenda_esperada then
      raise exception 'O pasto de destino selecionado não pertence à fazenda de destino do lançamento.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validar_pasto_pertence_fazenda on movimentacoes_rebanho;
create trigger trg_validar_pasto_pertence_fazenda
before insert or update on movimentacoes_rebanho
for each row execute function fn_validar_pasto_pertence_fazenda();

-- ---------------------------------------------------------------------
-- fn_validar_edicao_movimentacao / fn_validar_delete_movimentacao —
-- só os pontos de chamada mudam (passam pasto_id/pasto_destino_id e
-- usam a nova coluna pasto_saldo_negativo na mensagem de erro).
-- ---------------------------------------------------------------------

create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check record;
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

  return new;
end;
$$ language plpgsql;

create or replace function fn_validar_delete_movimentacao()
returns trigger as $$
declare
  v_check record;
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

  return old;
end;
$$ language plpgsql;

-- =====================================================================
-- FIM DA MIGRAÇÃO 020
-- =====================================================================
