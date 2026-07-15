-- =====================================================================
-- ORION AGRO — Migração 012
-- Rode no SQL editor do Supabase (execução única, sem restrição de
-- enum como nas migrações 010/011 — aqui não criamos valor de enum
-- novo, só removemos o uso do AJUSTE_ESTOQUE).
--
-- Remove o tipo AJUSTE_ESTOQUE (uma correção no meio do período
-- distorceria fechamentos de safra/ano, já que não é uma movimentação
-- real). O Postgres não permite excluir um valor já existente de um
-- enum, então ele continua tecnicamente definido, mas fica bloqueado
-- por constraint — nunca mais pode ser usado.
--
-- Saldo inicial passa a poder ser reeditado mesmo depois de confirmado
-- (sem trava definitiva), desde que não deixe o saldo negativo em
-- nenhum ponto da trajetória — a mesma proteção que já vale pra edição
-- de qualquer lançamento. A tela pede confirmação explícita antes.
--
-- Também adiciona proteção contra saldo negativo em EXCLUSÕES, que
-- antes só existia para edições.
-- =====================================================================

-- 0) limpa o lançamento de teste de AJUSTE_ESTOQUE feito durante o
--    desenvolvimento, antes de bloquear o tipo de vez
delete from movimentacoes_rebanho where tipo = 'AJUSTE_ESTOQUE';

-- 1) fn_saldo_categoria — remove os ramos de AJUSTE_ESTOQUE
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
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- 2) fn_validar_saldo_categoria — remove o ramo de AJUSTE_ESTOQUE
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

-- 3) fn_delta_para_par — remove o ramo de AJUSTE_ESTOQUE (mantém o
--    parâmetro p_direcao_ajuste, sem uso, pra não precisar de DROP)
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
  end if;
  return v_total;
end;
$$;

-- 4) fn_checar_edicao_movimentacao — para de referenciar
--    v_old.direcao_ajuste (a coluna vai ser removida no passo 8)
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
                                    v_par.fazenda_id, v_par.categoria_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id)
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

-- 5) fn_validar_edicao_movimentacao — para de passar new.direcao_ajuste
create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
    new.categoria_id, new.categoria_destino_id, new.data, new.quantidade
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível editar: o saldo da categoria % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  return new;
end;
$$ language plpgsql;

-- 6) remove a trava definitiva do saldo inicial confirmado
drop trigger if exists trg_bloquear_saldo_inicial_confirmado on movimentacoes_rebanho;
drop function if exists fn_bloquear_saldo_inicial_confirmado();

-- 7) nova proteção: exclusão de qualquer movimentação também não pode
--    deixar o saldo negativo em nenhum ponto da trajetória (antes só
--    existia essa checagem para edição)
create or replace function fn_validar_delete_movimentacao()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
    old.categoria_id, old.categoria_destino_id, old.data, 0
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível excluir: o saldo da categoria % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_validar_delete_movimentacao on movimentacoes_rebanho;
create trigger trg_validar_delete_movimentacao
before delete on movimentacoes_rebanho
for each row execute function fn_validar_delete_movimentacao();

-- 8) vw_estoque_rebanho — remove os ramos de AJUSTE_ESTOQUE
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

-- 9) fn_relatorio_movimentacao_rebanho — remove as colunas de ajuste
--    (precisa DROP: mudar colunas de retorno não é permitido via
--    CREATE OR REPLACE)
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
    fn_saldo_categoria(p_fazenda_id, c.id, p_data_fim)
  from categorias_animal c
  where c.ativa = true
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- 10) remove a constraint de observação obrigatória do ajuste (a de
--     direção é removida automaticamente junto com a coluna no passo 12)
alter table movimentacoes_rebanho drop constraint if exists ck_observacao_ajuste_obrigatoria;

-- 11) bloqueia o tipo AJUSTE_ESTOQUE de vez (o valor do enum continua
--     existindo tecnicamente, mas nunca mais pode ser usado)
alter table movimentacoes_rebanho
  add constraint ck_ajuste_estoque_desabilitado check (tipo <> 'AJUSTE_ESTOQUE');

-- 12) remove a coluna direcao_ajuste (não é mais usada por nada)
alter table movimentacoes_rebanho drop column if exists direcao_ajuste;

-- =====================================================================
-- FIM DA MIGRAÇÃO 012
-- =====================================================================
