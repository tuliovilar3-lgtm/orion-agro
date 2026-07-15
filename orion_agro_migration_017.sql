-- =====================================================================
-- ORION AGRO — Migração 017
--
-- Gestão de áreas: uso do solo por fazenda, com histórico editável.
-- Mesma arquitetura da movimentação de rebanho: ledger de eventos
-- (movimentacoes_area) + saldo por tipo de uso calculado por data
-- (fn_area_por_uso). Inclui relatório de distribuição com média
-- ponderada pelos dias (não média simples).
-- =====================================================================

create type tipo_movimentacao_area as enum ('SALDO_INICIAL', 'MUDANCA_USO');

create table tipos_uso_area (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);
alter table tipos_uso_area disable row level security;

create table movimentacoes_area (
  id                    uuid primary key default gen_random_uuid(),
  fazenda_id            uuid not null references fazendas(id),
  tipo                  tipo_movimentacao_area not null,
  data                  date not null,
  tipo_uso_origem_id    uuid references tipos_uso_area(id),
  tipo_uso_destino_id   uuid not null references tipos_uso_area(id),
  area_ha               numeric(12,2) not null check (area_ha > 0),
  cultura               text,
  observacao            text,
  created_at            timestamptz not null default now(),
  constraint ck_area_movimentacao_origem check (
    (tipo = 'SALDO_INICIAL' and tipo_uso_origem_id is null)
    or (tipo = 'MUDANCA_USO' and tipo_uso_origem_id is not null and tipo_uso_origem_id <> tipo_uso_destino_id)
  )
);
alter table movimentacoes_area disable row level security;

create unique index uq_saldo_inicial_area_por_tipo
  on movimentacoes_area (fazenda_id, tipo_uso_destino_id)
  where tipo = 'SALDO_INICIAL';

create or replace function fn_area_por_uso(p_fazenda_id uuid, p_tipo_uso_id uuid, p_data date)
returns numeric
language plpgsql
stable
as $$
declare
  v_entradas numeric;
  v_saidas   numeric;
begin
  select coalesce(sum(area_ha), 0) into v_entradas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_destino_id = p_tipo_uso_id and data <= p_data;

  select coalesce(sum(area_ha), 0) into v_saidas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_origem_id = p_tipo_uso_id and data <= p_data;

  return v_entradas - v_saidas;
end;
$$;

create or replace function fn_validar_saldo_area()
returns trigger as $$
declare
  v_area_disponivel numeric;
  v_area_total      numeric;
  v_area_alocada    numeric;
begin
  if new.tipo = 'MUDANCA_USO' then
    v_area_disponivel := fn_area_por_uso(new.fazenda_id, new.tipo_uso_origem_id, new.data);
    if v_area_disponivel < new.area_ha then
      raise exception 'Área insuficiente: % ha disponível(is) nesse tipo de uso na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel, new.data, new.area_ha;
    end if;
  elsif new.tipo = 'SALDO_INICIAL' then
    select area_ha into v_area_total from fazendas where id = new.fazenda_id;
    if v_area_total is not null then
      select coalesce(sum(area_ha), 0) into v_area_alocada
        from movimentacoes_area where fazenda_id = new.fazenda_id and tipo = 'SALDO_INICIAL';
      if (v_area_alocada + new.area_ha) > v_area_total then
        raise exception 'A área total da fazenda é % ha — a soma dos tipos de uso não pode ultrapassar isso.', v_area_total;
      end if;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_saldo_area
before insert on movimentacoes_area
for each row execute function fn_validar_saldo_area();

create or replace function fn_delta_area_para_tipo(
  p_tipo tipo_movimentacao_area,
  p_tipo_uso_origem_id uuid,
  p_tipo_uso_destino_id uuid,
  p_area_ha numeric,
  p_par_tipo_uso_id uuid
) returns numeric
language plpgsql
immutable
as $$
declare
  v_total numeric := 0;
begin
  if p_tipo_uso_destino_id = p_par_tipo_uso_id then
    v_total := v_total + p_area_ha;
  end if;
  if p_tipo = 'MUDANCA_USO' and p_tipo_uso_origem_id = p_par_tipo_uso_id then
    v_total := v_total - p_area_ha;
  end if;
  return v_total;
end;
$$;

create or replace function fn_checar_edicao_area(
  p_id uuid,
  p_fazenda_id uuid,
  p_tipo tipo_movimentacao_area,
  p_tipo_uso_origem_id uuid,
  p_tipo_uso_destino_id uuid,
  p_data date,
  p_area_ha numeric
) returns table(
  tem_movimentacoes_futuras boolean,
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  tipo_uso_saldo_negativo text,
  saldo_minimo numeric
)
language plpgsql
as $$
declare
  v_old         movimentacoes_area%rowtype;
  v_tipo_uso_id uuid;
  v_data        date;
  v_saldo       numeric;
  v_pior_saldo  numeric;
  v_pior_data   date;
  v_pior_tipo   uuid;
  v_tem_futuras boolean := false;
begin
  select * into v_old from movimentacoes_area where id = p_id;

  for v_tipo_uso_id in (
    select distinct t from (
      values (v_old.tipo_uso_origem_id), (v_old.tipo_uso_destino_id),
             (p_tipo_uso_origem_id), (p_tipo_uso_destino_id)
    ) as x(t)
    where t is not null
  )
  loop
    if exists (
      select 1 from movimentacoes_area m
      where m.id <> p_id and m.fazenda_id = p_fazenda_id and m.data > p_data
        and (m.tipo_uso_origem_id = v_tipo_uso_id or m.tipo_uso_destino_id = v_tipo_uso_id)
    ) then
      v_tem_futuras := true;
    end if;

    for v_data in (
      select distinct m.data from movimentacoes_area m
      where m.id <> p_id and m.fazenda_id = p_fazenda_id and m.data >= p_data
        and (m.tipo_uso_origem_id = v_tipo_uso_id or m.tipo_uso_destino_id = v_tipo_uso_id)
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_area_por_uso(p_fazenda_id, v_tipo_uso_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_area_para_tipo(v_old.tipo, v_old.tipo_uso_origem_id, v_old.tipo_uso_destino_id,
                                          v_old.area_ha, v_tipo_uso_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_area_para_tipo(p_tipo, p_tipo_uso_origem_id, p_tipo_uso_destino_id,
                                          p_area_ha, v_tipo_uso_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
        v_pior_tipo := v_tipo_uso_id;
      end if;
    end loop;
  end loop;

  tem_movimentacoes_futuras := v_tem_futuras;
  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  select nome into tipo_uso_saldo_negativo from tipos_uso_area where id = v_pior_tipo;

  return next;
end;
$$;

create or replace function fn_validar_edicao_area()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_area(
    old.id, new.fazenda_id, new.tipo, new.tipo_uso_origem_id, new.tipo_uso_destino_id, new.data, new.area_ha
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível editar: a área de % ficaria negativa (%) em %.',
      v_check.tipo_uso_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_edicao_area
before update on movimentacoes_area
for each row execute function fn_validar_edicao_area();

create or replace function fn_validar_delete_area()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_area(
    old.id, old.fazenda_id, old.tipo, old.tipo_uso_origem_id, old.tipo_uso_destino_id, old.data, 0
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível excluir: a área de % ficaria negativa (%) em %.',
      v_check.tipo_uso_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_area
before delete on movimentacoes_area
for each row execute function fn_validar_delete_area();

create or replace function fn_area_media_ponderada(
  p_fazenda_id uuid,
  p_tipo_uso_id uuid,
  p_data_inicio date,
  p_data_fim date
) returns numeric
language plpgsql
stable
as $$
declare
  v_soma numeric := 0;
  v_dias int := 0;
  v_dia  date;
begin
  for v_dia in select generate_series(p_data_inicio, p_data_fim, interval '1 day')::date
  loop
    v_soma := v_soma + fn_area_por_uso(p_fazenda_id, p_tipo_uso_id, v_dia);
    v_dias := v_dias + 1;
  end loop;

  if v_dias = 0 then
    return 0;
  end if;

  return round(v_soma / v_dias, 2);
end;
$$;

create or replace function fn_relatorio_distribuicao_area(
  p_fazenda_id uuid,
  p_data_inicio date,
  p_data_fim date
) returns table(
  mes int,
  ano int,
  tipo_uso_id uuid,
  tipo_uso_nome text,
  area_media_ponderada numeric,
  dias_no_mes int
)
language plpgsql
as $$
declare
  v_mes_inicio date := date_trunc('month', p_data_inicio)::date;
  v_mes_fim    date;
  v_janela_ini date;
  v_janela_fim date;
begin
  while v_mes_inicio <= p_data_fim
  loop
    v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;
    v_janela_ini := greatest(v_mes_inicio, p_data_inicio);
    v_janela_fim := least(v_mes_fim, p_data_fim);

    return query
    select
      extract(month from v_mes_inicio)::int,
      extract(year from v_mes_inicio)::int,
      t.id,
      t.nome,
      fn_area_media_ponderada(p_fazenda_id, t.id, v_janela_ini, v_janela_fim),
      (v_janela_fim - v_janela_ini + 1)::int
    from tipos_uso_area t
    order by t.ordem;

    v_mes_inicio := (v_mes_inicio + interval '1 month')::date;
  end loop;
end;
$$;

insert into tipos_uso_area (nome, ordem) values
  ('Reserva Legal/APP', 1),
  ('Pecuária', 2),
  ('Agricultura', 3),
  ('Área em Reforma', 4),
  ('Área Alagada', 5),
  ('Infraestrutura', 6),
  ('Outros', 7);

-- =====================================================================
-- FIM DA MIGRAÇÃO 017
-- =====================================================================
