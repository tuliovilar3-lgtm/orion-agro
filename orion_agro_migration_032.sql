-- =====================================================================
-- ORION AGRO — Migração 032
-- Subtipos de uso de área (Pecuária: Corte/Leite/Ovinocultura/Haras;
-- Agricultura: Soja/Milho/Cana-de-açúcar/Café) — mesmo princípio já
-- usado pro controle de rebanho por pasto (tipo de uso = fazenda,
-- subtipo = pasto): dimensão mais fina, opt-in por grupo, com um
-- subtipo "Geral" sempre existente pra cada tipo de uso.
--
-- Superseeds o campo "cultura" (texto livre, só usado hoje quando
-- tipo_uso destino = Agricultura) — os valores já digitados viram
-- subtipos reais no catálogo (backfill abaixo). "cultura" continua na
-- tabela só como histórico bruto; deixa de ser lido/escrito pelo
-- frontend a partir desta migração.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. subtipos_uso_area — catálogo genérico (mecanismo vale pra
-- qualquer tipo de uso), mas só exposto na UI hoje pra Pecuária e
-- Agricultura, igual tipo_utilizacao_modulo reserva 'AGRICULTURA' sem
-- usar ainda pra módulos/pastos.
-- ---------------------------------------------------------------------

create table subtipos_uso_area (
  id           uuid primary key default gen_random_uuid(),
  tipo_uso_id  uuid not null references tipos_uso_area(id),
  nome         text not null,
  ativo        boolean not null default true,
  -- "Geral" nunca pode ser excluído — precisa sempre existir como
  -- valor padrão pra quando o recurso está desligado (ver sistema em
  -- pastos/modulos, mesmo princípio)
  sistema      boolean not null default false,
  ordem        int not null default 0,
  created_at   timestamptz not null default now(),
  constraint uq_subtipo_nome_tipo_uso unique (tipo_uso_id, nome)
);
alter table subtipos_uso_area disable row level security;

-- "Geral" pra todos os tipos de uso já existentes — garante que todo
-- lançamento sempre tem subtipo pra apontar, mesmo com o recurso
-- desligado (mesmo papel do pasto "Geral" quando controla_pasto = false)
insert into subtipos_uso_area (tipo_uso_id, nome, sistema, ordem)
select id, 'Geral', true, 0 from tipos_uso_area;

-- sugestões iniciais — usuário pode cadastrar outras livremente depois
-- (ver "+ Novo subtipo..." em Gestão de Áreas)
insert into subtipos_uso_area (tipo_uso_id, nome, ordem)
select t.id, s.nome, s.ordem
from tipos_uso_area t
cross join (values
  ('Corte', 1), ('Leite', 2), ('Ovinocultura', 3), ('Haras', 4)
) as s(nome, ordem)
where t.nome = 'Pecuária';

insert into subtipos_uso_area (tipo_uso_id, nome, ordem)
select t.id, s.nome, s.ordem
from tipos_uso_area t
cross join (values
  ('Soja', 1), ('Milho', 2), ('Cana-de-açúcar', 3), ('Café', 4)
) as s(nome, ordem)
where t.nome = 'Agricultura';

-- ---------------------------------------------------------------------
-- 2. movimentacoes_area ganha subtipo_uso_origem_id/subtipo_uso_destino_id
-- — mesmo par origem/destino de tipo_uso_*_id, num nível mais fino.
-- destino sempre obrigatório; origem só existe em MUDANCA_USO.
-- ---------------------------------------------------------------------

alter table movimentacoes_area
  add column subtipo_uso_origem_id  uuid references subtipos_uso_area(id),
  add column subtipo_uso_destino_id uuid references subtipos_uso_area(id);

-- backfill: destino com "cultura" preenchida (só acontecia quando
-- tipo_uso destino = Agricultura) ganha/cria o subtipo correspondente
-- ao texto já digitado; o resto cai no "Geral" do respectivo tipo de
-- uso. Origem (só existe em MUDANCA_USO) sempre cai no "Geral" — não
-- há como saber retroativamente "de qual subtipo" a área saiu.
do $$
declare
  v_row        record;
  v_subtipo_id uuid;
begin
  for v_row in select id, tipo_uso_origem_id, tipo_uso_destino_id, cultura from movimentacoes_area loop
    if v_row.cultura is not null and trim(v_row.cultura) <> '' then
      select id into v_subtipo_id from subtipos_uso_area
        where tipo_uso_id = v_row.tipo_uso_destino_id and nome = trim(v_row.cultura);
      if v_subtipo_id is null then
        insert into subtipos_uso_area (tipo_uso_id, nome)
          values (v_row.tipo_uso_destino_id, trim(v_row.cultura))
          returning id into v_subtipo_id;
      end if;
    else
      select id into v_subtipo_id from subtipos_uso_area
        where tipo_uso_id = v_row.tipo_uso_destino_id and nome = 'Geral';
    end if;
    update movimentacoes_area set subtipo_uso_destino_id = v_subtipo_id where id = v_row.id;

    if v_row.tipo_uso_origem_id is not null then
      select id into v_subtipo_id from subtipos_uso_area
        where tipo_uso_id = v_row.tipo_uso_origem_id and nome = 'Geral';
      update movimentacoes_area set subtipo_uso_origem_id = v_subtipo_id where id = v_row.id;
    end if;
  end loop;
end $$;

alter table movimentacoes_area
  alter column subtipo_uso_destino_id set not null;

alter table movimentacoes_area
  add constraint ck_subtipo_area_origem check (
    (tipo = 'SALDO_INICIAL' and subtipo_uso_origem_id is null)
    or (tipo = 'MUDANCA_USO' and subtipo_uso_origem_id is not null)
  );

-- ---------------------------------------------------------------------
-- 3. Integridade referencial: o subtipo selecionado precisa pertencer
-- ao tipo de uso do lançamento (mesmo princípio de
-- fn_validar_pasto_pertence_fazenda)
-- ---------------------------------------------------------------------

create or replace function fn_validar_subtipo_pertence_tipo_uso()
returns trigger as $$
declare
  v_tipo_uso_destino uuid;
  v_tipo_uso_origem  uuid;
begin
  select tipo_uso_id into v_tipo_uso_destino from subtipos_uso_area where id = new.subtipo_uso_destino_id;
  if v_tipo_uso_destino is distinct from new.tipo_uso_destino_id then
    raise exception 'O subtipo de destino selecionado não pertence ao tipo de uso de destino.';
  end if;

  if new.subtipo_uso_origem_id is not null then
    select tipo_uso_id into v_tipo_uso_origem from subtipos_uso_area where id = new.subtipo_uso_origem_id;
    if v_tipo_uso_origem is distinct from new.tipo_uso_origem_id then
      raise exception 'O subtipo de origem selecionado não pertence ao tipo de uso de origem.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_subtipo_pertence_tipo_uso
before insert or update on movimentacoes_area
for each row execute function fn_validar_subtipo_pertence_tipo_uso();

-- ---------------------------------------------------------------------
-- 4. fn_area_por_subtipo_uso — mesma ideia de fn_area_por_uso, refinada
-- pro nível de subtipo (opt-in via configuracoes.controla_subtipo_area).
-- Fazenda que não usa esse controle só tem o subtipo "Geral" de cada
-- tipo de uso, então o saldo por subtipo coincide com o saldo do tipo
-- de uso inteiro nesse caso. Vale sempre: fn_area_por_uso(fazenda,
-- tipo_uso, data) = soma, sobre todos os subtipos daquele tipo de uso,
-- de fn_area_por_subtipo_uso.
-- ---------------------------------------------------------------------

create or replace function fn_area_por_subtipo_uso(
  p_fazenda_id uuid, p_tipo_uso_id uuid, p_subtipo_uso_id uuid, p_data date
)
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
  where fazenda_id = p_fazenda_id and tipo_uso_destino_id = p_tipo_uso_id
    and subtipo_uso_destino_id = p_subtipo_uso_id and data <= p_data;

  select coalesce(sum(area_ha), 0) into v_saidas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_origem_id = p_tipo_uso_id
    and subtipo_uso_origem_id = p_subtipo_uso_id and data <= p_data;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Saldo insuficiente também checado no nível de subtipo, em cima do
-- que já existe no nível de tipo de uso — defesa em profundidade,
-- mesmo princípio de fn_validar_saldo_categoria (fazenda + pasto).
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_area()
returns trigger as $$
declare
  v_area_disponivel         numeric;
  v_area_disponivel_subtipo numeric;
  v_area_total              numeric;
  v_area_alocada            numeric;
begin
  if new.tipo = 'MUDANCA_USO' then
    v_area_disponivel := fn_area_por_uso(new.fazenda_id, new.tipo_uso_origem_id, new.data);
    if v_area_disponivel < new.area_ha then
      raise exception 'Área insuficiente: % ha disponível(is) nesse tipo de uso na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel, new.data, new.area_ha;
    end if;

    v_area_disponivel_subtipo := fn_area_por_subtipo_uso(
      new.fazenda_id, new.tipo_uso_origem_id, new.subtipo_uso_origem_id, new.data
    );
    if v_area_disponivel_subtipo < new.area_ha then
      raise exception 'Área insuficiente nesse subtipo de uso: % ha disponível(is) na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel_subtipo, new.data, new.area_ha;
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
-- trg_validar_saldo_area já existe (before insert) — só a função muda.

-- ---------------------------------------------------------------------
-- 6. Trajetória de edição/exclusão ciente do subtipo — mesmo princípio
-- de fn_delta_area_para_tipo/fn_checar_edicao_area, só que pra
-- dimensão do subtipo. Mantida como função própria e paralela (não
-- mexe no retorno de fn_checar_edicao_area nem nos call sites já
-- existentes em Gestão de Áreas) — o bloqueio é a fonte de verdade;
-- ainda não tem o aviso amigável com data/quantidade que a versão por
-- tipo de uso tem (mesmo princípio já aceito pra trajetória de lote
-- de nascimento: vira exceção direta do banco em vez do aviso
-- amigável, até que valha a pena estender a versão detalhada).
-- ---------------------------------------------------------------------

create or replace function fn_delta_area_para_subtipo(
  p_tipo tipo_movimentacao_area,
  p_subtipo_uso_origem_id uuid,
  p_subtipo_uso_destino_id uuid,
  p_area_ha numeric,
  p_par_subtipo_id uuid
) returns numeric
language plpgsql
immutable
as $$
declare
  v_total numeric := 0;
begin
  if p_subtipo_uso_destino_id = p_par_subtipo_id then
    v_total := v_total + p_area_ha;
  end if;
  if p_tipo = 'MUDANCA_USO' and p_subtipo_uso_origem_id = p_par_subtipo_id then
    v_total := v_total - p_area_ha;
  end if;
  return v_total;
end;
$$;

create or replace function fn_subtipo_area_ficaria_negativo(
  p_id uuid,
  p_fazenda_id uuid,
  p_tipo tipo_movimentacao_area,
  p_subtipo_uso_origem_id uuid,
  p_subtipo_uso_destino_id uuid,
  p_data date,
  p_area_ha numeric
) returns boolean
language plpgsql
as $$
declare
  v_old         movimentacoes_area%rowtype;
  v_subtipo_id  uuid;
  v_data        date;
  v_saldo       numeric;
  v_tipo_uso_id uuid;
begin
  select * into v_old from movimentacoes_area where id = p_id;

  for v_subtipo_id in (
    select distinct t from (
      values (v_old.subtipo_uso_origem_id), (v_old.subtipo_uso_destino_id),
             (p_subtipo_uso_origem_id), (p_subtipo_uso_destino_id)
    ) as x(t)
    where t is not null
  )
  loop
    select tipo_uso_id into v_tipo_uso_id from subtipos_uso_area where id = v_subtipo_id;

    for v_data in (
      select distinct m.data from movimentacoes_area m
      where m.id <> p_id and m.fazenda_id = p_fazenda_id and m.data >= p_data
        and (m.subtipo_uso_origem_id = v_subtipo_id or m.subtipo_uso_destino_id = v_subtipo_id)
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_area_por_subtipo_uso(p_fazenda_id, v_tipo_uso_id, v_subtipo_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_area_para_subtipo(v_old.tipo, v_old.subtipo_uso_origem_id, v_old.subtipo_uso_destino_id,
                                             v_old.area_ha, v_subtipo_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_area_para_subtipo(p_tipo, p_subtipo_uso_origem_id, p_subtipo_uso_destino_id,
                                             p_area_ha, v_subtipo_id)
            else 0 end;

      if v_saldo < 0 then
        return true;
      end if;
    end loop;
  end loop;

  return false;
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

  if fn_subtipo_area_ficaria_negativo(
    old.id, new.fazenda_id, new.tipo, new.subtipo_uso_origem_id, new.subtipo_uso_destino_id, new.data, new.area_ha
  ) then
    raise exception 'Não é possível editar: essa alteração deixaria negativa a área de algum subtipo de uso envolvido.';
  end if;

  return new;
end;
$$ language plpgsql;
-- trg_validar_edicao_area já existe (before update) — só a função muda.

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

  if fn_subtipo_area_ficaria_negativo(
    old.id, old.fazenda_id, old.tipo, old.subtipo_uso_origem_id, old.subtipo_uso_destino_id, old.data, 0
  ) then
    raise exception 'Não é possível excluir: a exclusão deixaria negativa a área de algum subtipo de uso envolvido.';
  end if;

  return old;
end;
$$ language plpgsql;
-- trg_validar_delete_area já existe (before delete) — só a função muda.

-- ---------------------------------------------------------------------
-- 7. Exclusão de subtipo — mesmo princípio de fn_validar_delete_pasto:
-- "Geral" nunca pode ser excluído (só inativado), e um subtipo criado
-- pelo usuário só pode ser excluído se não tiver nenhuma movimentação
-- de área lançada (nem como origem, nem como destino).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_subtipo_uso_area()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'O subtipo "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (
    select 1 from movimentacoes_area
    where subtipo_uso_origem_id = old.id or subtipo_uso_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: esse subtipo já tem movimentações lançadas. Inative-o em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_subtipo_uso_area
before delete on subtipos_uso_area
for each row execute function fn_validar_delete_subtipo_uso_area();

-- ---------------------------------------------------------------------
-- 8. Opt-in por grupo — mesmo princípio de configuracoes.controla_pasto.
-- Desligado, ninguém vê o seletor de subtipo — tudo lança no subtipo
-- "Geral" de cada tipo de uso, sem exigir nenhuma migração de dado
-- quando for ligado depois.
-- ---------------------------------------------------------------------

alter table configuracoes add column controla_subtipo_area boolean not null default false;

-- =====================================================================
-- FIM DA MIGRAÇÃO 032
-- =====================================================================
