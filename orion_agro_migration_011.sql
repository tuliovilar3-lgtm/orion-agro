-- =====================================================================
-- ORION AGRO — Migração 011
-- Rode DEPOIS da migração 010 (execução separada). Adiciona saldo
-- inicial (com trava de confirmação) e ajuste de estoque.
-- =====================================================================

-- 1) colunas novas
alter table fazendas
  add column saldo_inicial_confirmado boolean not null default false,
  add column saldo_inicial_confirmado_em timestamptz;

alter table movimentacoes_rebanho
  add column direcao_ajuste direcao_ajuste;

-- 2) constraints novas
alter table movimentacoes_rebanho
  add constraint ck_direcao_ajuste check (
    (tipo = 'AJUSTE_ESTOQUE' and direcao_ajuste is not null)
    or
    (tipo <> 'AJUSTE_ESTOQUE' and direcao_ajuste is null)
  );

alter table movimentacoes_rebanho
  add constraint ck_observacao_ajuste_obrigatoria check (
    tipo <> 'AJUSTE_ESTOQUE' or (observacao is not null and length(trim(observacao)) > 0)
  );

alter table movimentacoes_rebanho
  add constraint ck_peso_medio_obrigatorio_saldo_inicial check (
    tipo <> 'SALDO_INICIAL' or peso_medio_kg is not null
  );

create unique index uq_saldo_inicial_por_categoria
  on movimentacoes_rebanho (fazenda_id, categoria_id)
  where tipo = 'SALDO_INICIAL';

-- 3) fn_saldo_categoria — inclui SALDO_INICIAL e AJUSTE_ESTOQUE
create or replace function fn_saldo_categoria(p_fazenda_id uuid, p_categoria_id uuid, p_data date)
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
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'AJUSTE_ESTOQUE' and direcao_ajuste = 'ENTRADA' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'AJUSTE_ESTOQUE' and direcao_ajuste = 'SAIDA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- 4) fn_validar_saldo_categoria — checa saldo em AJUSTE_ESTOQUE de saída
create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem uuid;
  v_saldo            int;
begin
  if new.tipo in ('VENDA_PE', 'VENDA_ABATE', 'MORTE', 'CONSUMO_DOACAO', 'DESMAME', 'MUDANCA_CATEGORIA') then
    v_fazenda_checagem := new.fazenda_id;
  elsif new.tipo = 'TRANSFERENCIA' then
    v_fazenda_checagem := new.fazenda_origem_id;
  elsif new.tipo = 'AJUSTE_ESTOQUE' and new.direcao_ajuste = 'SAIDA' then
    v_fazenda_checagem := new.fazenda_id;
  else
    return new;
  end if;

  v_saldo := fn_saldo_categoria(v_fazenda_checagem, new.categoria_id, new.data);

  if v_saldo < new.quantidade then
    raise exception 'Saldo insuficiente: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
      v_saldo, new.data, new.quantidade;
  end if;

  return new;
end;
$$ language plpgsql;

-- 5) fn_delta_para_par — novo parâmetro p_direcao_ajuste
create or replace function fn_delta_para_par(
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_quantidade int,
  p_par_fazenda_id uuid,
  p_par_categoria_id uuid,
  p_direcao_ajuste direcao_ajuste default null
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
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
  elsif p_tipo = 'AJUSTE_ESTOQUE' then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      if p_direcao_ajuste = 'ENTRADA' then
        v_total := v_total + p_quantidade;
      else
        v_total := v_total - p_quantidade;
      end if;
    end if;
  end if;
  return v_total;
end;
$$;

-- 6) fn_checar_edicao_movimentacao — novo parâmetro p_direcao_ajuste
create or replace function fn_checar_edicao_movimentacao(
  p_id uuid,
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_data date,
  p_quantidade int,
  p_direcao_ajuste direcao_ajuste default null
) returns table(
  tem_movimentacoes_futuras boolean,
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  categoria_saldo_negativo text,
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
  v_tem_futuras    boolean := false;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id),
        (v_old.fazenda_id, v_old.categoria_destino_id),
        (v_old.fazenda_destino_id, v_old.categoria_id),
        (p_fazenda_id, p_categoria_id),
        (p_fazenda_id, p_categoria_destino_id),
        (p_fazenda_destino_id, p_categoria_id)
    ) as t(fazenda_id, categoria_id)
    where fazenda_id is not null and categoria_id is not null
  )
  loop
    if exists (
      select 1 from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data > p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
    ) then
      v_tem_futuras := true;
    end if;

    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
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
      v_saldo := fn_saldo_categoria(v_par.fazenda_id, v_par.categoria_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.categoria_destino_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_old.direcao_ajuste)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, p_direcao_ajuste)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
        v_pior_categoria := v_par.categoria_id;
      end if;
    end loop;
  end loop;

  tem_movimentacoes_futuras := v_tem_futuras;
  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  select nome into categoria_saldo_negativo from categorias_animal where id = v_pior_categoria;

  return next;
end;
$$;

-- 7) fn_validar_edicao_movimentacao — passa direcao_ajuste adiante
create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
    new.categoria_id, new.categoria_destino_id, new.data, new.quantidade, new.direcao_ajuste
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível editar: o saldo da categoria % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  return new;
end;
$$ language plpgsql;

-- 8) trava do saldo inicial confirmado
create or replace function fn_bloquear_saldo_inicial_confirmado()
returns trigger as $$
declare
  v_fazenda_id uuid;
  v_tipo       tipo_movimentacao;
  v_confirmado boolean;
begin
  if TG_OP = 'DELETE' then
    v_fazenda_id := old.fazenda_id;
    v_tipo := old.tipo;
  else
    v_fazenda_id := new.fazenda_id;
    v_tipo := new.tipo;
  end if;

  if v_tipo = 'SALDO_INICIAL' then
    select saldo_inicial_confirmado into v_confirmado from fazendas where id = v_fazenda_id;
    if v_confirmado then
      raise exception 'O saldo inicial dessa fazenda já foi confirmado e não pode mais ser alterado. Use um ajuste de estoque para corrigir.';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$ language plpgsql;

drop trigger if exists trg_bloquear_saldo_inicial_confirmado on movimentacoes_rebanho;
create trigger trg_bloquear_saldo_inicial_confirmado
before insert or update or delete on movimentacoes_rebanho
for each row execute function fn_bloquear_saldo_inicial_confirmado();

-- 9) vw_estoque_rebanho — inclui SALDO_INICIAL e AJUSTE_ESTOQUE
create or replace view vw_estoque_rebanho as
with entradas as (
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL')
  union all
  select fazenda_destino_id as fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_destino_id as categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo in ('MUDANCA_CATEGORIA', 'DESMAME')
  union all
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'AJUSTE_ESTOQUE' and direcao_ajuste = 'ENTRADA'
),
saidas as (
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME')
  union all
  select fazenda_origem_id as fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'MUDANCA_CATEGORIA'
  union all
  select fazenda_id, categoria_id, data, quantidade
  from movimentacoes_rebanho
  where tipo = 'AJUSTE_ESTOQUE' and direcao_ajuste = 'SAIDA'
)
select
  f.id as fazenda_id,
  f.nome as fazenda_nome,
  c.id as categoria_id,
  c.nome as categoria_nome,
  coalesce(sum(e.quantidade), 0) - coalesce(sum(s.quantidade), 0) as saldo_atual
from fazendas f
cross join categorias_animal c
left join entradas e on e.fazenda_id = f.id and e.categoria_id = c.id
left join saidas s on s.fazenda_id = f.id and s.categoria_id = c.id
where c.ativa = true and f.ativo = true
group by f.id, f.nome, c.id, c.nome;

-- 10) fn_relatorio_movimentacao_rebanho — colunas de saldo inicial e ajuste
-- (precisa dropar antes: mudar as colunas de retorno não é permitido em
-- CREATE OR REPLACE, só quando é estritamente uma adição no final)
drop function if exists fn_relatorio_movimentacao_rebanho(uuid, date, date);

create or replace function fn_relatorio_movimentacao_rebanho(
  p_fazenda_id uuid,
  p_data_inicio date,
  p_data_fim date
) returns table (
  categoria_id uuid,
  categoria_nome text,
  ordem_ciclo int,
  estoque_inicial int,
  entrada_saldo_inicial int,
  entrada_nascimento int,
  entrada_compra int,
  entrada_desmame int,
  entrada_transferencia int,
  entrada_mudanca_categoria int,
  entrada_ajuste int,
  saida_morte int,
  saida_venda int,
  saida_desmame int,
  saida_transferencia int,
  saida_consumo_doacao int,
  saida_mudanca_categoria int,
  saida_ajuste int,
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
    fn_saldo_categoria(p_fazenda_id, c.id, p_data_inicio - 1),
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'SALDO_INICIAL'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'NASCIMENTO'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'COMPRA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_destino_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_destino_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_destino_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'AJUSTE_ESTOQUE'
        and m.direcao_ajuste = 'ENTRADA' and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'MORTE'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo in ('VENDA_PE', 'VENDA_ABATE')
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_origem_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'CONSUMO_DOACAO'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = p_fazenda_id and m.categoria_id = c.id and m.tipo = 'AJUSTE_ESTOQUE'
        and m.direcao_ajuste = 'SAIDA' and m.data between p_data_inicio and p_data_fim), 0)::int,
    fn_saldo_categoria(p_fazenda_id, c.id, p_data_fim)
  from categorias_animal c
  where c.ativa = true
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 011
-- =====================================================================
