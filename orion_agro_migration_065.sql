-- Migração 065: Mudança de Categoria e Desmame passam a contar no saldo
-- por proprietário (fn_saldo_categoria_proprietario / _pasto_proprietario)
--
-- Bug real: fn_saldo_categoria_proprietario nunca contava
-- MUDANCA_CATEGORIA/DESMAME como entrada nem saída — diferente de
-- fn_saldo_categoria (saldo da fazenda inteira, sem corte por
-- proprietário), que já tratava isso corretamente (débito na categoria de
-- origem, crédito na categoria de destino). Isso quebra mesmo com um único
-- proprietário cadastrado: assim que uma categoria passa a receber a
-- maior parte do seu estoque via reclassificação (ex.: Garrote 12-24 →
-- Boi 24-36), o saldo "visto" pelo proprietário fica sistematicamente
-- menor que o saldo real da fazenda naquela categoria, e uma venda dentro
-- do saldo real acaba sendo bloqueada por "saldo insuficiente para esse
-- proprietário".
--
-- Correção: fn_saldo_categoria_proprietario e
-- fn_saldo_categoria_pasto_proprietario passam a tratar
-- MUDANCA_CATEGORIA/DESMAME exatamente como fn_saldo_categoria/
-- fn_saldo_categoria_pasto já tratam, só que com o filtro adicional de
-- proprietario_id. As funções de trajetória de edição/exclusão
-- (fn_delta_para_par_proprietario/fn_checar_saldo_proprietario_futuro e
-- as variantes cruzadas com pasto) precisam de um parâmetro novo,
-- p_categoria_destino_id, pra conseguir considerar o lado "destino" dessas
-- movimentações — mudança de assinatura, por isso o `drop function`
-- antes do `create or replace` (mesmo princípio já usado em migrações
-- anteriores que trocaram assinatura de função, ex. 031).
--
-- Também adicionado: MUDANCA_CATEGORIA passa a ser validada no saldo por
-- proprietário (e na checagem cruzada pasto×proprietário) no momento do
-- INSERT — hoje só a checagem por fazenda inteira cobria esse tipo,
-- deixando a checagem por proprietário mais frouxa que a da fazenda pra
-- esse caso específico. Defesa em profundidade, mesmo padrão já usado
-- pros demais tipos.

-- ---------------------------------------------------------------------
-- 1. fn_saldo_categoria_proprietario — corpo (assinatura não muda)
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
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
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
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. fn_saldo_categoria_pasto_proprietario — corpo (assinatura não muda)
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_pasto_proprietario(
  p_fazenda_id uuid, p_categoria_id uuid, p_pasto_id uuid, p_proprietario_id uuid, p_data date
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
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. fn_delta_para_par_proprietario — ganha p_categoria_destino_id
--    (mudança de assinatura: drop antes de recriar)
-- ---------------------------------------------------------------------

drop function if exists fn_delta_para_par_proprietario(
  tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, int, uuid, uuid, uuid
);

create or replace function fn_delta_para_par_proprietario(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_categoria_destino_id uuid, p_proprietario_id uuid, p_quantidade int,
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
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo in ('MUDANCA_CATEGORIA', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_destino_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
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

-- ---------------------------------------------------------------------
-- 4. fn_checar_saldo_proprietario_futuro — ganha p_categoria_destino_id
-- ---------------------------------------------------------------------

drop function if exists fn_checar_saldo_proprietario_futuro(
  uuid, tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, date, int
);

create or replace function fn_checar_saldo_proprietario_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_categoria_destino_id uuid, p_proprietario_id uuid, p_data date, p_quantidade int
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
        (v_old.fazenda_id, v_old.categoria_destino_id, v_old.proprietario_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.proprietario_id),
        (p_fazenda_id, p_categoria_id, p_proprietario_id),
        (p_fazenda_id, p_categoria_destino_id, p_proprietario_id),
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
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id)
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
                                    v_old.categoria_id, v_old.categoria_destino_id, v_old.proprietario_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_proprietario(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id, p_proprietario_id, p_quantidade,
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

-- ---------------------------------------------------------------------
-- 5. fn_delta_para_par_pasto_proprietario — ganha p_categoria_destino_id
-- ---------------------------------------------------------------------

drop function if exists fn_delta_para_par_pasto_proprietario(
  tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, uuid, uuid, int, uuid, uuid, uuid, uuid
);

create or replace function fn_delta_para_par_pasto_proprietario(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_categoria_destino_id uuid, p_pasto_id uuid, p_pasto_destino_id uuid, p_proprietario_id uuid, p_quantidade int,
  p_par_fazenda_id uuid, p_par_categoria_id uuid, p_par_pasto_id uuid, p_par_proprietario_id uuid
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
-- 6. fn_checar_saldo_pasto_proprietario_futuro — ganha p_categoria_destino_id
-- ---------------------------------------------------------------------

drop function if exists fn_checar_saldo_pasto_proprietario_futuro(
  uuid, tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, uuid, uuid, date, int
);

create or replace function fn_checar_saldo_pasto_proprietario_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_categoria_destino_id uuid, p_pasto_id uuid, p_pasto_destino_id uuid, p_proprietario_id uuid, p_data date, p_quantidade int
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
    select distinct fazenda_id, categoria_id, pasto_id, proprietario_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_id, v_old.proprietario_id),
        (v_old.fazenda_id, v_old.categoria_destino_id, v_old.pasto_id, v_old.proprietario_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.pasto_destino_id, v_old.proprietario_id),
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_destino_id, v_old.proprietario_id),
        (p_fazenda_id, p_categoria_id, p_pasto_id, p_proprietario_id),
        (p_fazenda_id, p_categoria_destino_id, p_pasto_id, p_proprietario_id),
        (p_fazenda_destino_id, p_categoria_id, p_pasto_destino_id, p_proprietario_id),
        (p_fazenda_id, p_categoria_id, p_pasto_destino_id, p_proprietario_id)
    ) as t(fazenda_id, categoria_id, pasto_id, proprietario_id)
    where fazenda_id is not null and categoria_id is not null and pasto_id is not null and proprietario_id is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.proprietario_id = v_par.proprietario_id
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
      v_saldo := fn_saldo_categoria_pasto_proprietario(v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_par.proprietario_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_pasto_proprietario(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.categoria_destino_id, v_old.pasto_id, v_old.pasto_destino_id, v_old.proprietario_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_par.proprietario_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_pasto_proprietario(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id, p_pasto_id, p_pasto_destino_id, p_proprietario_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_par.proprietario_id)
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
-- 7. fn_validar_edicao_movimentacao / fn_validar_delete_movimentacao —
--    call sites atualizados pra passar categoria_destino_id
-- ---------------------------------------------------------------------

create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check            record;
  v_check_lote       record;
  v_check_prop       record;
  v_check_pasto_prop record;
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
      new.categoria_id, new.categoria_destino_id, new.proprietario_id, new.data, new.quantidade
    );
    if v_check_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo desse proprietário ficaria negativo (%) em %.',
        v_check_prop.saldo_minimo, v_check_prop.data_saldo_negativo;
    end if;

    select * into v_check_pasto_prop from fn_checar_saldo_pasto_proprietario_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.categoria_destino_id, new.pasto_id, new.pasto_destino_id, new.proprietario_id, new.data, new.quantidade
    );
    if v_check_pasto_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo desse proprietário no pasto ficaria negativo (%) em %.',
        v_check_pasto_prop.saldo_minimo, v_check_pasto_prop.data_saldo_negativo;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create or replace function fn_validar_delete_movimentacao()
returns trigger as $$
declare
  v_check_pasto_prop record;
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
      old.categoria_id, old.categoria_destino_id, old.proprietario_id, old.data, 0
    );
    if v_check_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo desse proprietário ficaria negativo (%) em %.',
        v_check_prop.saldo_minimo, v_check_prop.data_saldo_negativo;
    end if;

    select * into v_check_pasto_prop from fn_checar_saldo_pasto_proprietario_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.categoria_destino_id, old.pasto_id, old.pasto_destino_id, old.proprietario_id, old.data, 0
    );
    if v_check_pasto_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo desse proprietário no pasto ficaria negativo (%) em %.',
        v_check_pasto_prop.saldo_minimo, v_check_pasto_prop.data_saldo_negativo;
    end if;
  end if;

  return old;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 8. fn_validar_saldo_categoria — MUDANCA_CATEGORIA passa a ser checada
--    também no saldo por proprietário e na checagem cruzada pasto×
--    proprietário no momento do INSERT (hoje só a checagem por fazenda
--    inteira cobria esse tipo — defesa em profundidade, mesmo padrão já
--    usado pros demais tipos).
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem   uuid;
  v_saldo              int;
  v_saldo_pasto        int;
  v_saldo_lote         int;
  v_saldo_proprietario int;
  v_saldo_pasto_prop   int;
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
    v_saldo_lote := fn_saldo_categoria_safra(
      v_fazenda_lote, new.categoria_id, new.safra_nascimento_ano_inicio, new.data
    );
    if v_saldo_lote < new.quantidade then
      raise exception 'Saldo insuficiente no lote de nascimento (safra %/%): % cabeça(s) disponível(is) na data %, mas % foi(ram) solicitada(s).',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        v_saldo_lote, new.data, new.quantidade;
    end if;
  end if;

  if new.proprietario_id is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA', 'MUDANCA_CATEGORIA') then
    v_fazenda_lote := case when new.tipo = 'TRANSFERENCIA' then new.fazenda_origem_id else new.fazenda_id end;
    v_saldo_proprietario := fn_saldo_categoria_proprietario(v_fazenda_lote, new.categoria_id, new.proprietario_id, new.data);
    if v_saldo_proprietario < new.quantidade then
      raise exception 'Saldo insuficiente para esse proprietário: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_saldo_proprietario, new.data, new.quantidade;
    end if;
  end if;

  -- checagem cruzada pasto × proprietário (migração 051) — cobre
  -- MUDANCA_PASTO também (checagem de saldo simples acima não cobre
  -- esse tipo pra fazenda/proprietário, só pra pasto puro)
  if new.proprietario_id is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA', 'MUDANCA_PASTO', 'MUDANCA_CATEGORIA') then
    v_saldo_pasto_prop := fn_saldo_categoria_pasto_proprietario(new.fazenda_id, new.categoria_id, new.pasto_id, new.proprietario_id, new.data);
    if v_saldo_pasto_prop < new.quantidade then
      select nome into v_nome_pasto from pastos where id = new.pasto_id;
      raise exception 'Saldo insuficiente para esse proprietário no pasto %: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_nome_pasto, v_saldo_pasto_prop, new.data, new.quantidade;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;
