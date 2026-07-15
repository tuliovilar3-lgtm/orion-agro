-- =====================================================================
-- ORION AGRO — Schema do Módulo Pecuário
-- PostgreSQL 14+ / compatível com Supabase
-- Gerado a partir do modelo de dados discutido com base no boletim
-- mensal existente (controle de rebanho + classificação financeira)
-- =====================================================================

-- ---------------------------------------------------------------------
-- EXTENSÕES
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type papel_usuario as enum ('admin', 'gestor', 'operador');

create type tipo_movimentacao as enum (
  'NASCIMENTO',
  'DESMAME',
  'COMPRA',
  'VENDA_PE',
  'VENDA_ABATE',
  'MORTE',
  'CONSUMO_DOACAO',
  'MUDANCA_CATEGORIA',
  'TRANSFERENCIA',
  -- não aparece no formulário normal de lançamento — tem tela dedicada
  -- própria (ver seção 2c), e pode ser reaberto/reeditado mesmo depois
  -- de confirmado (respeitando a trajetória de saldo). Não existe mais
  -- um tipo "AJUSTE_ESTOQUE": corrigir no meio do período distorceria
  -- fechamentos de safra/ano, já que não seria uma movimentação real.
  'SALDO_INICIAL',
  -- move animais de um pasto pra outro sem mudar categoria (controle
  -- de rebanho por pasto — opt-in via configuracoes.controla_pasto)
  'MUDANCA_PASTO'
);

create type sexo_categoria as enum ('MACHO', 'FEMEA', 'MISTO');

create type tipo_cliente_fornecedor as enum ('CLIENTE', 'FORNECEDOR', 'AMBOS');

create type tipo_lancamento_financeiro as enum ('RECEITA', 'DESPESA');

create type criterio_rateio as enum ('POR_CABECA', 'POR_AREA', 'PERCENTUAL_FIXO');

create type subtipo_consumo_doacao as enum ('CONSUMO_INTERNO', 'DOACAO');

-- gestão de área: SALDO_INICIAL declara a área inicial de um tipo de uso
-- (sem origem); MUDANCA_USO move hectares de um tipo de uso pra outro,
-- dentro da mesma fazenda (área não "nasce" nem "morre", só realoca)
create type tipo_movimentacao_area as enum ('SALDO_INICIAL', 'MUDANCA_USO');

-- =====================================================================
-- 1. TABELAS DE REFERÊNCIA (globais / compartilhadas entre fazendas)
-- =====================================================================

create table fazendas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  localizacao     text,
  area_ha         numeric(12,2),
  ativo           boolean not null default true,
  -- uma vez confirmado, os lançamentos de tipo SALDO_INICIAL dessa
  -- fazenda ficam travados (ver fn_bloquear_saldo_inicial_confirmado)
  saldo_inicial_confirmado    boolean not null default false,
  saldo_inicial_confirmado_em timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- configuração única do grupo (não por fazenda) — hoje só
-- controla_pasto, mas é o lugar natural pra outras opções futuras que
-- valem pra todas as fazendas de uma vez. O índice único sobre uma
-- expressão constante garante que só existe (e só pode existir) uma
-- linha nessa tabela.
create table configuracoes (
  id              uuid primary key default gen_random_uuid(),
  -- opt-in: o grupo passa a poder cadastrar módulos/pastos além do
  -- "Geral" padrão em todas as fazendas. Desligado, ninguém vê essa
  -- tela — tudo é lançado no módulo/pasto "Geral", que sempre existe
  -- em toda fazenda (ver fn_criar_modulo_pasto_geral).
  controla_pasto  boolean not null default false,
  updated_at      timestamptz not null default now()
);
create unique index uq_configuracoes_singleton on configuracoes ((true));
alter table configuracoes disable row level security;

insert into configuracoes (controla_pasto) values (false);

create table usuarios (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  email           text not null unique,
  papel           papel_usuario not null default 'operador',
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);

create table usuario_fazenda (
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  fazenda_id      uuid not null references fazendas(id) on delete cascade,
  primary key (usuario_id, fazenda_id)
);

create table grupos_categoria (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,  -- ex: BEZERRO, JOVEM, ADULTO (Grupo Faixa Etária)
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);

-- "Grupo Categoria" — papel zootécnico do animal (ex: Novilhas, Touros).
-- Mais granular que grupos_categoria (Grupo Faixa Etária) e determina o
-- sexo da categoria: toda categoria criada com um papel de sexo fixo
-- herda esse sexo automaticamente (ver fn_calcular_atributos_categoria).
-- 'Outros' é o único papel com sexo livre (sexo null aqui).
create table grupos_categoria_papel (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  sexo            sexo_categoria,
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);
-- projetos Supabase mais novos ativam RLS por padrão em tabela criada
-- via SQL editor — o resto do projeto não usa RLS ainda (sem login),
-- então desativa aqui pra manter consistência com as demais tabelas.
alter table grupos_categoria_papel disable row level security;

create table categorias_animal (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null,
  -- grupo e sexo são obrigatórios: alimentam relatórios futuros e a
  -- filtragem de categorias válidas por tipo de movimentação (ex: só
  -- bezerro em NASCIMENTO), então não podem ficar em branco. grupo_id
  -- (Grupo Faixa Etária) é preenchido automaticamente a partir da era
  -- pela trigger fn_calcular_atributos_categoria — não é mais escolhido
  -- diretamente no formulário de cadastro.
  grupo_id               uuid not null references grupos_categoria(id),
  grupo_categoria_papel_id uuid references grupos_categoria_papel(id),
  sexo                   sexo_categoria not null,
  -- faixa etária específica da categoria (00-08, 08-12, 12-24, 24-36,
  -- 36+) — trava em 00-08 para os papéis "Bezerros/Bezerras Mamando".
  -- Determina grupo_id automaticamente (00-08→BEZERRO, 08-12/12-24→
  -- JOVEM, 24-36/36+→ADULTO).
  era                    text check (era in ('00-08', '08-12', '12-24', '24-36', '36+')),
  idade_min_meses        int,
  idade_max_meses        int,
  peso_referencia_kg     numeric(10,2),
  ordem_ciclo            int not null default 0,
  -- null = categoria global (padrão, disponível para todas as fazendas)
  -- preenchido = categoria exclusiva de uma fazenda específica
  fazenda_id             uuid references fazendas(id),
  ativa                  boolean not null default true,
  -- categorias do sistema (pré-cadastradas) não podem ser renomeadas,
  -- reclassificadas nem excluídas — só o peso de referência e o status
  -- ativa/inativa continuam livres (ver fn_validar_edicao_categoria e
  -- fn_validar_delete_categoria)
  sistema                boolean not null default false,
  created_by             uuid references usuarios(id),
  created_at             timestamptz not null default now(),
  constraint uq_categoria_nome_fazenda unique (nome, fazenda_id),
  constraint ck_idade_range check (
    idade_min_meses is null or idade_max_meses is null
    or idade_min_meses <= idade_max_meses
  ),
  -- regra de negócio: toda categoria é MACHO ou FEMEA, nunca MISTO.
  -- 'MISTO' continua existindo no enum sexo_categoria (não vale a pena
  -- a cirurgia de remover um valor de enum em produção), mas fica
  -- bloqueado aqui.
  constraint ck_sexo_categoria_obrigatorio check (sexo in ('MACHO', 'FEMEA'))
);

create index idx_categorias_fazenda on categorias_animal(fazenda_id);
create index idx_categorias_ativa on categorias_animal(ativa);

-- ---------------------------------------------------------------------
-- TRIGGER: deriva automaticamente sexo (pelo Grupo Categoria/papel) e
-- grupo_id/Grupo Faixa Etária (pela era) de toda categoria criada ou
-- editada. Trava era em '00-08' para os papéis de bezerro mamando.
-- 'Outros' é o único papel com sexo livre — obrigatório informar nesse
-- caso.
-- ---------------------------------------------------------------------

create or replace function fn_calcular_atributos_categoria()
returns trigger as $$
declare
  v_papel_nome text;
  v_papel_sexo sexo_categoria;
  v_grupo_faixa_nome text;
begin
  if new.grupo_categoria_papel_id is null then
    raise exception 'Selecione o Grupo Categoria.';
  end if;

  select nome, sexo into v_papel_nome, v_papel_sexo
  from grupos_categoria_papel where id = new.grupo_categoria_papel_id;

  if v_papel_sexo is not null then
    new.sexo := v_papel_sexo;
  elsif new.sexo is null then
    raise exception 'Selecione o sexo da categoria (obrigatório para o Grupo Categoria "Outros").';
  end if;

  if v_papel_nome in ('Bezerros Mamando', 'Bezerras Mamando') then
    new.era := '00-08';
  end if;

  if new.era is null then
    raise exception 'Selecione a era da categoria.';
  end if;

  v_grupo_faixa_nome := case new.era
    when '00-08' then 'BEZERRO'
    when '08-12' then 'JOVEM'
    when '12-24' then 'JOVEM'
    when '24-36' then 'ADULTO'
    when '36+' then 'ADULTO'
  end;

  select id into new.grupo_id from grupos_categoria where nome = v_grupo_faixa_nome;

  return new;
end;
$$ language plpgsql;

create trigger trg_calcular_atributos_categoria
before insert or update on categorias_animal
for each row execute function fn_calcular_atributos_categoria();

-- ---------------------------------------------------------------------
-- TRIGGER: categoria do sistema (sistema = true) não pode ter nome,
-- Grupo Categoria, sexo, era ou Grupo Faixa Etária alterados — só peso
-- de referência e o status ativa/inativa continuam livres.
-- ---------------------------------------------------------------------

create or replace function fn_validar_edicao_categoria()
returns trigger as $$
begin
  if old.sistema and (
    new.nome is distinct from old.nome or
    new.grupo_categoria_papel_id is distinct from old.grupo_categoria_papel_id or
    new.sexo is distinct from old.sexo or
    new.era is distinct from old.era or
    new.grupo_id is distinct from old.grupo_id or
    new.sistema is distinct from old.sistema
  ) then
    raise exception 'Categorias do sistema não podem ser editadas — só peso de referência e status ativa/inativa.';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_edicao_categoria
before update on categorias_animal
for each row execute function fn_validar_edicao_categoria();

-- ---------------------------------------------------------------------
-- TRIGGER: categoria do sistema nunca pode ser excluída. Categoria
-- criada pelo usuário só pode ser excluída se não tiver nenhuma
-- movimentação lançada (como categoria de origem ou destino).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_categoria()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'Categorias do sistema não podem ser excluídas.';
  end if;

  if exists (
    select 1 from movimentacoes_rebanho
    where categoria_id = old.id or categoria_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: essa categoria já tem movimentações lançadas. Inative-a em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_categoria
before delete on categorias_animal
for each row execute function fn_validar_delete_categoria();

create table clientes_fornecedores (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  tipo            tipo_cliente_fornecedor not null default 'AMBOS',
  documento       text,   -- CPF/CNPJ
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);

-- nome NÃO é unique aqui de propósito: duas pessoas/empresas diferentes
-- podem legitimamente ter o mesmo nome. O identificador real é o
-- documento (CPF/CNPJ), então a proteção contra duplicidade vai nele.
-- Índice parcial (ignora nulos) porque nem todo cadastro terá documento
-- preenchido no momento do lançamento.
create unique index uq_cliente_fornecedor_documento
  on clientes_fornecedores (documento)
  where documento is not null;

create table centros_custo (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  created_at      timestamptz not null default now()
);

create table subcentros_custo (
  id              uuid primary key default gen_random_uuid(),
  centro_custo_id uuid not null references centros_custo(id) on delete cascade,
  nome            text not null,
  constraint uq_subcentro_por_centro unique (centro_custo_id, nome)
);

-- =====================================================================
-- 1b. GESTÃO DE ÁREAS — uso do solo por fazenda, com histórico editável
--
-- Mesma arquitetura da movimentação de rebanho: um ledger de eventos
-- (movimentacoes_area) e o saldo de área por tipo de uso numa data
-- qualquer é calculado somando os eventos até aquela data
-- (fn_area_por_uso, equivalente a fn_saldo_categoria). Área nunca
-- "nasce" nem "morre" depois do saldo inicial — só realoca de um tipo
-- de uso pra outro dentro da mesma fazenda.
-- =====================================================================

create table tipos_uso_area (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);
-- ver comentário em grupos_categoria_papel sobre RLS padrão em tabela nova
alter table tipos_uso_area disable row level security;

create table movimentacoes_area (
  id                    uuid primary key default gen_random_uuid(),
  fazenda_id            uuid not null references fazendas(id),
  tipo                  tipo_movimentacao_area not null,
  data                  date not null,
  -- null apenas em SALDO_INICIAL — todo MUDANCA_USO tem uma origem
  tipo_uso_origem_id    uuid references tipos_uso_area(id),
  tipo_uso_destino_id   uuid not null references tipos_uso_area(id),
  area_ha               numeric(12,2) not null check (area_ha > 0),
  -- só relevante quando tipo_uso_destino é "Agricultura" — não impõe
  -- lista fechada de propriedade (cultura muda com frequência)
  cultura               text,
  observacao            text,
  created_at            timestamptz not null default now(),
  constraint ck_area_movimentacao_origem check (
    (tipo = 'SALDO_INICIAL' and tipo_uso_origem_id is null)
    or (tipo = 'MUDANCA_USO' and tipo_uso_origem_id is not null and tipo_uso_origem_id <> tipo_uso_destino_id)
  )
);

alter table movimentacoes_area disable row level security;

-- só pode haver um saldo inicial por (fazenda, tipo de uso) — mesmo
-- princípio de uq_saldo_inicial_por_categoria
create unique index uq_saldo_inicial_area_por_tipo
  on movimentacoes_area (fazenda_id, tipo_uso_destino_id)
  where tipo = 'SALDO_INICIAL';

-- ---------------------------------------------------------------------
-- fn_area_por_uso: hectares alocados a um tipo de uso, numa fazenda,
-- até uma data (equivalente a fn_saldo_categoria)
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- TRIGGER: MUDANCA_USO não pode tirar mais área de um tipo de uso do
-- que ele tem disponível na data; SALDO_INICIAL não pode fazer a soma
-- de todos os tipos de uso da fazenda ultrapassar a área total dela
-- (fazendas.area_ha — se estiver em branco, não há teto pra checar).
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- EDIÇÃO/EXCLUSÃO DE MOVIMENTAÇÕES DE ÁREA — mesma proteção de
-- trajetória já usada pro rebanho, adaptada pro modelo de 2 baldes
-- (tipo de uso origem/destino) em vez de 6.
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- RELATÓRIO DE DISTRIBUIÇÃO DE ÁREA — uma linha por (mês, tipo de uso)
-- dentro do período filtrado, com a área média PONDERADA PELOS DIAS
-- (não a média simples): se a área mudou de uso no meio do mês, os
-- dias antes e depois entram com pesos diferentes. dias_no_mes vem
-- junto pra o período completo poder ser derivado no frontend como
-- soma(area_media * dias_no_mes) / soma(dias_no_mes) — matematicamente
-- idêntico a calcular a média ponderada direto sobre todos os dias do
-- período, sem precisar reconsultar dia a dia de novo.
-- ---------------------------------------------------------------------

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

-- =====================================================================
-- 1c. MÓDULOS E PASTOS — controle de rebanho por pasto (opt-in único
-- pra todo o grupo, via configuracoes.controla_pasto). Dois níveis: módulo (onde roda o pastejo
-- rotacionado) contém pastos/talhões. Só PECUARIA liberado por
-- enquanto — AGRICULTURA fica reservado no enum pra não precisar de
-- migração de schema quando talhão for implementado.
-- =====================================================================

create type tipo_utilizacao_modulo as enum ('PECUARIA', 'AGRICULTURA');

create table modulos (
  id              uuid primary key default gen_random_uuid(),
  fazenda_id      uuid not null references fazendas(id),
  nome            text not null,
  tipo_utilizacao tipo_utilizacao_modulo not null default 'PECUARIA',
  ativo           boolean not null default true,
  ordem           int not null default 0,
  -- módulo "Geral" auto-criado (ver fn_criar_modulo_pasto_geral) — não
  -- pode ser excluído pela UI (só inativado), mesmo que renomeado
  -- depois (ver fn_validar_delete_modulo)
  sistema         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint uq_modulo_nome_fazenda unique (fazenda_id, nome),
  -- só PECUARIA por enquanto (ver comentário da seção)
  constraint ck_modulo_tipo_utilizacao check (tipo_utilizacao = 'PECUARIA')
);
alter table modulos disable row level security;

create table pastos (
  id              uuid primary key default gen_random_uuid(),
  modulo_id       uuid not null references modulos(id),
  nome            text not null,
  -- livre (sem histórico por data, diferente de movimentacoes_area) —
  -- validado contra a área de Pecuária no momento do cadastro/edição,
  -- não reconciliado retroativamente se a área de Pecuária encolher
  -- depois (ver fn_validar_area_pasto)
  area_ha         numeric(12,2),
  ativo           boolean not null default true,
  ordem           int not null default 0,
  -- pasto "Geral" auto-criado — mesma proteção de sistema do módulo
  -- acima (ver fn_validar_delete_pasto)
  sistema         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint uq_pasto_nome_modulo unique (modulo_id, nome)
);
alter table pastos disable row level security;

-- toda fazenda nova já ganha módulo + pasto "Geral" automaticamente —
-- se o grupo não liga controla_pasto ninguém vê essa tela, mas todo
-- lançamento de rebanho sempre tem pra onde apontar
create or replace function fn_criar_modulo_pasto_geral()
returns trigger as $$
declare
  v_modulo_id uuid;
begin
  insert into modulos (fazenda_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.id, 'Geral', 'PECUARIA', 0, true)
  returning id into v_modulo_id;

  insert into pastos (modulo_id, nome, ordem, sistema)
  values (v_modulo_id, 'Geral', 0, true);

  return new;
end;
$$ language plpgsql;

create trigger trg_criar_modulo_pasto_geral
after insert on fazendas
for each row execute function fn_criar_modulo_pasto_geral();

-- ---------------------------------------------------------------------
-- TRIGGER: pasto "Geral" nunca pode ser excluído. Pasto criado pelo
-- usuário só pode ser excluído se não tiver nenhuma movimentação ou
-- pesagem lançada (mesmo princípio de fn_validar_delete_categoria).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_pasto()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'O pasto "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (
    select 1 from movimentacoes_rebanho
    where pasto_id = old.id or pasto_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: esse pasto já tem movimentações lançadas. Inative-o em vez disso.';
  end if;

  if exists (select 1 from pesagens where pasto_id = old.id) then
    raise exception 'Não é possível excluir: esse pasto já tem pesagens registradas. Inative-o em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_pasto
before delete on pastos
for each row execute function fn_validar_delete_pasto();

-- ---------------------------------------------------------------------
-- TRIGGER: módulo "Geral" nunca pode ser excluído. Módulo criado pelo
-- usuário só pode ser excluído se já estiver sem nenhum pasto/talhão
-- (exclui-los primeiro — evita cascade e reaproveita a mesma validação
-- de histórico já feita em fn_validar_delete_pasto).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_modulo()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'O módulo "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (select 1 from pastos where modulo_id = old.id) then
    raise exception 'Não é possível excluir: exclua os pastos/talhões desse módulo primeiro.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_modulo
before delete on modulos
for each row execute function fn_validar_delete_modulo();

-- soma das áreas de todos os pastos da fazenda não pode ultrapassar a
-- área alocada em "Pecuária" (fn_area_por_uso na data de hoje — opção
-- simples combinada com o usuário, sem histórico por data no pasto)
create or replace function fn_validar_area_pasto()
returns trigger as $$
declare
  v_fazenda_id      uuid;
  v_tipo_pecuaria_id uuid;
  v_area_pecuaria   numeric;
  v_soma_pastos     numeric;
begin
  select fazenda_id into v_fazenda_id from modulos where id = new.modulo_id;
  select id into v_tipo_pecuaria_id from tipos_uso_area where nome = 'Pecuária';
  v_area_pecuaria := fn_area_por_uso(v_fazenda_id, v_tipo_pecuaria_id, current_date);

  select coalesce(sum(p.area_ha), 0) into v_soma_pastos
  from pastos p
  join modulos m on m.id = p.modulo_id
  where m.fazenda_id = v_fazenda_id and p.id <> new.id;

  v_soma_pastos := v_soma_pastos + coalesce(new.area_ha, 0);

  if v_soma_pastos > v_area_pecuaria then
    raise exception 'A soma das áreas dos pastos (% ha) ultrapassaria a área alocada em Pecuária (% ha).',
      v_soma_pastos, v_area_pecuaria;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_area_pasto
before insert or update on pastos
for each row execute function fn_validar_area_pasto();

-- =====================================================================
-- 2. TABELA FATO — MOVIMENTAÇÃO DE REBANHO
-- =====================================================================

create table movimentacoes_rebanho (
  id                    uuid primary key default gen_random_uuid(),

  -- fazenda "principal" do evento (para TRANSFERENCIA, ver origem/destino abaixo)
  fazenda_id            uuid not null references fazendas(id),

  data                  date not null,
  tipo                  tipo_movimentacao not null,

  categoria_id          uuid not null references categorias_animal(id),
  -- usado APENAS em MUDANCA_CATEGORIA (categoria de destino da transição)
  categoria_destino_id  uuid references categorias_animal(id),

  -- usados APENAS em TRANSFERENCIA
  fazenda_origem_id     uuid references fazendas(id),
  fazenda_destino_id    uuid references fazendas(id),

  -- pasto onde o animal está (ou de onde sai, em saídas/mudanças).
  -- Sempre obrigatório — fazenda que não usa controle por pasto
  -- (controla_pasto = false) só tem o pasto "Geral" pra escolher, e o
  -- formulário preenche isso sozinho. pasto_destino_id só é usado em
  -- MUDANCA_PASTO (pasto de destino) e TRANSFERENCIA (pasto na fazenda
  -- de destino) — MUDANCA_CATEGORIA/DESMAME nunca mudam de pasto no
  -- mesmo lançamento (precisa de um MUDANCA_PASTO à parte pra isso).
  pasto_id              uuid not null references pastos(id),
  pasto_destino_id      uuid references pastos(id),

  quantidade            int not null check (quantidade > 0),
  peso_medio_kg         numeric(10,2),
  peso_total_kg         numeric(12,2),

  -- comercial (compra / venda em pé / venda abate / consumo-doação)
  -- as 4 formas de valor abaixo são intercambiáveis: preencha UMA
  -- (ou valor_total, ou uma das 3 unitárias) e o trigger
  -- fn_calcular_valores_movimentacao (mais abaixo) calcula as demais.
  valor_arroba          numeric(10,2),   -- R$/@
  valor_cabeca          numeric(10,2),   -- R$/CABEÇA
  valor_kg              numeric(10,2),   -- R$/KG
  valor_total           numeric(14,2),   -- R$ TOTAL
  cliente_fornecedor_id uuid references clientes_fornecedores(id),

  -- específicos de venda abate / consumo-doação
  -- mesmo princípio: preencha peso_morto_kg OU rendimento_carcaca_pct,
  -- o trigger calcula o que faltar.
  rendimento_carcaca_pct numeric(5,2),
  peso_morto_kg          numeric(10,2),

  -- usado APENAS em CONSUMO_DOACAO: distingue consumo próprio de doação
  -- (necessário para os relatórios futuros de rebanho)
  subtipo_consumo_doacao subtipo_consumo_doacao,

  -- específico de morte
  causa_morte           text,

  observacao            text,

  -- correlaciona linhas de um mesmo lançamento em lote (mais de uma
  -- categoria lançada juntas, ex.: venda de garrotes + novilhas pro
  -- mesmo comprador no mesmo dia) — null quando a movimentação foi
  -- lançada sozinha. Puramente um id de correlação (sem tabela própria
  -- — nenhum outro dado depende dele além de agrupar visualmente na
  -- listagem e permitir reabrir o lote inteiro pra edição em
  -- app/movimentacoes/page.tsx). Cada linha continua uma movimentação
  -- independente pro resto do sistema (saldo, relatórios, trajetória).
  grupo_lancamento_id   uuid,

  usuario_id            uuid references usuarios(id),
  created_at            timestamptz not null default now(),

  -- -------------------------------------------------------------
  -- REGRAS DE INTEGRIDADE POR TIPO DE EVENTO
  -- -------------------------------------------------------------

  -- MUDANCA_CATEGORIA e DESMAME exigem categoria_destino_id preenchido
  -- e diferente da categoria de origem; nenhum outro tipo pode usá-lo.
  -- Em DESMAME, categoria_destino_id é a categoria (jovem) para a qual
  -- o bezerro evolui após o desmame — validado na aplicação para ser
  -- do grupo JOVEM e do mesmo sexo da categoria de origem.
  constraint ck_categoria_destino check (
    (tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and categoria_destino_id is not null
       and categoria_destino_id <> categoria_id)
    or
    (tipo not in ('MUDANCA_CATEGORIA', 'DESMAME') and categoria_destino_id is null)
  ),

  -- TRANSFERENCIA exige fazenda_origem_id e fazenda_destino_id
  -- preenchidos e diferentes entre si; nenhum outro tipo pode usá-los.
  -- A transferência NUNCA muda categoria no mesmo evento (ver acima).
  constraint ck_transferencia check (
    (tipo = 'TRANSFERENCIA'
       and fazenda_origem_id is not null
       and fazenda_destino_id is not null
       and fazenda_origem_id <> fazenda_destino_id)
    or
    (tipo <> 'TRANSFERENCIA'
       and fazenda_origem_id is null
       and fazenda_destino_id is null)
  ),

  -- CONSUMO_DOACAO exige a distinção consumo interno / doação;
  -- nenhum outro tipo pode usá-la.
  constraint ck_subtipo_consumo_doacao check (
    (tipo = 'CONSUMO_DOACAO' and subtipo_consumo_doacao is not null)
    or
    (tipo <> 'CONSUMO_DOACAO' and subtipo_consumo_doacao is null)
  ),

  -- cliente/fornecedor é obrigatório em compra e nas duas formas de venda
  constraint ck_cliente_fornecedor_obrigatorio check (
    tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE')
    or cliente_fornecedor_id is not null
  ),

  -- causa da morte é obrigatória em lançamentos de morte
  constraint ck_causa_morte_obrigatoria check (
    tipo <> 'MORTE' or causa_morte is not null
  ),

  -- pasto_destino_id só existe em MUDANCA_PASTO (pasto novo, diferente
  -- do de origem) e TRANSFERENCIA (pasto na fazenda de destino)
  constraint ck_pasto_destino check (
    (tipo = 'MUDANCA_PASTO' and pasto_destino_id is not null and pasto_destino_id <> pasto_id)
    or
    (tipo = 'TRANSFERENCIA' and pasto_destino_id is not null)
    or
    (tipo not in ('MUDANCA_PASTO', 'TRANSFERENCIA') and pasto_destino_id is null)
  ),

  -- saldo inicial exige peso médio informado junto com a quantidade
  constraint ck_peso_medio_obrigatorio_saldo_inicial check (
    tipo <> 'SALDO_INICIAL' or peso_medio_kg is not null
  ),

  -- ---------------------------------------------------------------
  -- RESTRIÇÕES DE PLAUSIBILIDADE BIOLÓGICA E FINANCEIRA
  -- ---------------------------------------------------------------

  constraint ck_peso_medio_positivo check (peso_medio_kg is null or peso_medio_kg > 0),
  constraint ck_peso_total_positivo check (peso_total_kg is null or peso_total_kg > 0),
  constraint ck_peso_morto_positivo check (peso_morto_kg is null or peso_morto_kg > 0),
  -- carcaça não pode pesar mais que o animal vivo
  constraint ck_peso_morto_nao_excede_vivo check (
    peso_morto_kg is null or peso_total_kg is null or peso_morto_kg <= peso_total_kg
  ),
  constraint ck_rendimento_carcaca_positivo check (
    rendimento_carcaca_pct is null or rendimento_carcaca_pct > 0
  ),
  -- venda abate exige peso morto ou rendimento de carcaça — sem isso o
  -- cálculo de arroba (fn_calcular_valores_movimentacao) cairia no
  -- fallback de peso vivo/30, que embute uma suposição de 50% de
  -- rendimento sem o usuário saber. Outros tipos comerciais (compra,
  -- venda em pé, consumo/doação) continuam livres pra usar esse
  -- fallback quando o rendimento real não é conhecido.
  constraint ck_venda_abate_peso_morto_ou_rendimento check (
    tipo <> 'VENDA_ABATE' or peso_morto_kg is not null or rendimento_carcaca_pct is not null
  ),
  constraint ck_valor_arroba_positivo check (valor_arroba is null or valor_arroba > 0),
  constraint ck_valor_cabeca_positivo check (valor_cabeca is null or valor_cabeca > 0),
  constraint ck_valor_kg_positivo check (valor_kg is null or valor_kg > 0),
  constraint ck_valor_total_positivo check (valor_total is null or valor_total > 0),
  -- lançamento registra um evento que já aconteceu — não pode ser no futuro
  constraint ck_data_nao_futura check (data <= current_date)
);

create index idx_mov_fazenda_data on movimentacoes_rebanho(fazenda_id, data);
create index idx_mov_tipo on movimentacoes_rebanho(tipo);
create index idx_mov_categoria on movimentacoes_rebanho(categoria_id);
create index idx_mov_transf_origem on movimentacoes_rebanho(fazenda_origem_id);
create index idx_mov_transf_destino on movimentacoes_rebanho(fazenda_destino_id);
create index idx_mov_grupo_lancamento on movimentacoes_rebanho(grupo_lancamento_id) where grupo_lancamento_id is not null;

-- no máximo um SALDO_INICIAL por fazenda+categoria — evita duplicidade
-- antes da confirmação (a trava de edição/exclusão cuida do "depois")
create unique index uq_saldo_inicial_por_categoria
  on movimentacoes_rebanho (fazenda_id, categoria_id)
  where tipo = 'SALDO_INICIAL';

-- ---------------------------------------------------------------------
-- TRIGGER: cálculo automático de valores comerciais e rendimento
-- de carcaça, a partir do primeiro campo que o usuário preencher.
--
-- Convenção de fator de arroba confirmada nas fórmulas originais da
-- planilha (não é uma suposição):
--   - peso vivo (compra / venda em pé):  @ = peso_vivo_kg / 30
--   - peso morto/carcaça (venda abate / consumo-doação): @ = peso_morto_kg / 15
--
-- TRANSFERENCIA entra no mesmo cálculo: a planilha valoriza transferências
-- entre fazendas (para fins de rateio/contabilidade interna), então
-- aplicamos a mesma regra de peso vivo (fator 30) usada em compra/venda em pé.
--
-- Prioridade de resolução do valor_total quando mais de um campo de
-- preço vem preenchido: valor_total > valor_arroba > valor_cabeca > valor_kg.
-- Se quem lançar preencher direto o valor_total, ele é respeitado como
-- fonte da verdade e as 3 formas unitárias são recalculadas a partir dele.
-- ---------------------------------------------------------------------

create or replace function fn_calcular_valores_movimentacao()
returns trigger as $$
declare
  v_fator_arroba  numeric;
  v_peso_base     numeric;
  v_total_arrobas numeric;
begin
  if new.tipo not in ('COMPRA','VENDA_PE','VENDA_ABATE','CONSUMO_DOACAO','TRANSFERENCIA') then
    return new;
  end if;

  -- 1) par rendimento de carcaça <-> peso morto (exige peso_total_kg = peso vivo)
  if new.peso_total_kg is not null and new.peso_total_kg > 0 then
    if new.peso_morto_kg is not null and new.rendimento_carcaca_pct is null then
      new.rendimento_carcaca_pct := round(new.peso_morto_kg / new.peso_total_kg * 100, 2);
    elsif new.rendimento_carcaca_pct is not null and new.peso_morto_kg is null then
      new.peso_morto_kg := round(new.peso_total_kg * new.rendimento_carcaca_pct / 100, 2);
    end if;
  end if;

  -- 2) base de cálculo da arroba
  if new.peso_morto_kg is not null and new.peso_morto_kg > 0 then
    v_peso_base := new.peso_morto_kg;
    v_fator_arroba := 15;
  elsif new.peso_total_kg is not null and new.peso_total_kg > 0 then
    v_peso_base := new.peso_total_kg;
    v_fator_arroba := 30;
  end if;

  if v_peso_base is not null then
    v_total_arrobas := v_peso_base / v_fator_arroba;
  end if;

  -- 3) resolver valor_total a partir do primeiro preço unitário informado
  if new.valor_total is null then
    if new.valor_arroba is not null and v_total_arrobas is not null then
      new.valor_total := round(new.valor_arroba * v_total_arrobas, 2);
    elsif new.valor_cabeca is not null and new.quantidade is not null then
      new.valor_total := round(new.valor_cabeca * new.quantidade, 2);
    elsif new.valor_kg is not null and new.peso_total_kg is not null and new.peso_total_kg > 0 then
      new.valor_total := round(new.valor_kg * new.peso_total_kg, 2);
    end if;
  end if;

  -- 4) com valor_total resolvido, preencher as 3 formas unitárias
  if new.valor_total is not null then
    if v_total_arrobas is not null and v_total_arrobas > 0 then
      new.valor_arroba := round(new.valor_total / v_total_arrobas, 2);
    end if;
    if new.quantidade is not null and new.quantidade > 0 then
      new.valor_cabeca := round(new.valor_total / new.quantidade, 2);
    end if;
    if new.peso_total_kg is not null and new.peso_total_kg > 0 then
      new.valor_kg := round(new.valor_total / new.peso_total_kg, 2);
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_calcular_valores_movimentacao
before insert or update on movimentacoes_rebanho
for each row execute function fn_calcular_valores_movimentacao();

-- ---------------------------------------------------------------------
-- SALDO DE CATEGORIA — saldo (entradas - saídas) de uma categoria numa
-- fazenda até uma data (inclusive). Usada tanto pela tela de lançamento
-- (exibir saldo disponível em tempo real) quanto pela trigger de
-- validação abaixo. Espelha a mesma lógica de vw_estoque_rebanho, mas
-- parametrizada por data em vez de "saldo atual total".
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_pasto: mesma ideia de fn_saldo_categoria, mas
-- refinada pro nível de pasto (controle de rebanho por pasto — opt-in
-- único via configuracoes.controla_pasto, vale pro grupo inteiro).
-- Fazenda que não usa esse controle só
-- tem o pasto "Geral", então o saldo por pasto coincide com o saldo da
-- fazenda inteira nesse caso. Toda fazenda+categoria tem
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
-- TRIGGER: impede lançar mais animais do que o saldo disponível na
-- categoria de origem, na data do lançamento. Não se aplica a
-- NASCIMENTO/COMPRA (só entram animais). TRANSFERENCIA checa o saldo
-- na fazenda de origem. Checa tanto o saldo da fazenda inteira quanto
-- o saldo do pasto específico (este último cobre também MUDANCA_PASTO,
-- que não mexe no saldo da fazenda — só desloca dentro dela).
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

create trigger trg_validar_saldo_categoria
before insert on movimentacoes_rebanho
for each row execute function fn_validar_saldo_categoria();

-- ---------------------------------------------------------------------
-- TRIGGER: garante que pasto_id (e pasto_destino_id, quando usado)
-- realmente pertencem à fazenda do lançamento — em TRANSFERENCIA,
-- pasto_id precisa ser da fazenda de origem e pasto_destino_id da
-- fazenda de destino.
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

create trigger trg_validar_pasto_pertence_fazenda
before insert or update on movimentacoes_rebanho
for each row execute function fn_validar_pasto_pertence_fazenda();

-- ---------------------------------------------------------------------
-- TRIGGER: exige que o saldo inicial da fazenda já tenha sido
-- confirmado antes de aceitar qualquer outra movimentação. Isso evita
-- que o usuário comece a lançar movimentações reais sem antes definir
-- o ponto de partida do rebanho, o que geraria contas erradas depois.
-- TRANSFERENCIA exige o saldo inicial confirmado tanto na fazenda de
-- origem quanto na de destino.
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_inicial_obrigatorio()
returns trigger as $$
declare
  v_fazenda_ids uuid[];
  v_fazenda_id  uuid;
  v_confirmado  boolean;
begin
  if new.tipo = 'SALDO_INICIAL' then
    return new;
  end if;

  if new.tipo = 'TRANSFERENCIA' then
    v_fazenda_ids := array[new.fazenda_origem_id, new.fazenda_destino_id];
  else
    v_fazenda_ids := array[new.fazenda_id];
  end if;

  foreach v_fazenda_id in array v_fazenda_ids
  loop
    select saldo_inicial_confirmado into v_confirmado from fazendas where id = v_fazenda_id;
    if not coalesce(v_confirmado, false) then
      raise exception 'É necessário preencher e confirmar o saldo inicial da fazenda antes de lançar outras movimentações.';
    end if;
  end loop;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_saldo_inicial_obrigatorio
before insert on movimentacoes_rebanho
for each row execute function fn_validar_saldo_inicial_obrigatorio();

-- ---------------------------------------------------------------------
-- EDIÇÃO DE MOVIMENTAÇÕES — permitida em qualquer campo, mas seguindo
-- a mesma regra independente do que for editado:
--   1. sem movimentação futura da mesma categoria/fazenda -> edita direto
--   2. com movimentação futura, mas saldo continua ok -> aviso pedindo
--      confirmação (a confirmação em si é responsabilidade da tela;
--      aqui só fornecemos a informação pra decidir)
--   3. com movimentação futura e o saldo ficaria negativo em algum
--      ponto da trajetória -> bloqueado (com raise exception)
--
-- fn_delta_para_par: quanto uma movimentação (dados soltos, não uma
-- linha da tabela) contribui pra um par (fazenda, categoria) específico.
-- Mesma lógica de entrada/saída já usada em fn_saldo_categoria, só que
-- reorganizada pra responder "quanto ESSA linha contribui pra ESSE par"
-- em vez de "somando todas as linhas, qual o saldo desse par".
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

-- fn_checar_edicao_movimentacao: dado o id de uma movimentação existente
-- e os valores NOVOS propostos (podem ser iguais ou diferentes dos
-- atuais, em qualquer campo), diz se existem movimentações futuras da(s)
-- mesma(s) categoria/fazenda envolvida(s) e se a edição deixaria o saldo
-- negativo em algum ponto da trajetória — reaproveitando fn_saldo_categoria
-- (já testada) como base, apenas ajustada para "trocar" a contribuição
-- antiga pela nova em cada data candidata.
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

  -- cada trio (fazenda, categoria, pasto) abaixo é uma combinação que a
  -- linha, nos valores antigos OU propostos, pode afetar como
  -- entrada/saída (ver fn_saldo_categoria_pasto / fn_delta_para_par).
  -- Checar a trajetória em todo trio afetado no nível de pasto cobre
  -- também o nível de fazenda inteira, já que
  -- fn_saldo_categoria(fazenda, categoria, data) é a soma, sobre todos
  -- os pastos da fazenda, de fn_saldo_categoria_pasto(fazenda,
  -- categoria, pasto, data).
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

-- trigger de bloqueio (defesa em profundidade — a tela já deve chamar
-- fn_checar_edicao_movimentacao antes de mandar o UPDATE, pra mostrar o
-- aviso de confirmação; esta trigger garante que mesmo sem passar pela
-- tela, nunca é possível gravar uma edição que deixe saldo negativo)
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

create trigger trg_validar_edicao_movimentacao
before update on movimentacoes_rebanho
for each row execute function fn_validar_edicao_movimentacao();

-- ---------------------------------------------------------------------
-- EXCLUSÃO DE MOVIMENTAÇÕES — mesma proteção de trajetória da edição,
-- só que pra DELETE: simula "essa linha deixa de existir" chamando
-- fn_checar_edicao_movimentacao com quantidade 0 (contribuição vira
-- zero em fn_delta_para_par não importa o tipo), e bloqueia se em
-- algum ponto da trajetória o saldo ficaria negativo sem ela.
-- ---------------------------------------------------------------------

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

create trigger trg_validar_delete_movimentacao
before delete on movimentacoes_rebanho
for each row execute function fn_validar_delete_movimentacao();

-- =====================================================================
-- 2b. PESAGENS — atribuição periódica de peso, desacoplada do fluxo
-- de estoque (não afeta vw_estoque_rebanho nem passa pela trigger acima).
-- Alimenta indicadores como GMD (ganho médio diário) ao longo do tempo.
-- =====================================================================

create table pesagens (
  id              uuid primary key default gen_random_uuid(),
  fazenda_id      uuid not null references fazendas(id),
  categoria_id    uuid not null references categorias_animal(id),
  -- sempre obrigatório — mesmo princípio do pasto em movimentacoes_rebanho:
  -- fazenda sem controla_pasto só tem o pasto "Geral" pra escolher, e o
  -- formulário preenche isso sozinho.
  pasto_id        uuid not null references pastos(id),
  data            date not null,
  peso_medio_kg   numeric(10,2) not null check (peso_medio_kg > 0),
  observacao      text,
  usuario_id      uuid references usuarios(id),
  created_at      timestamptz not null default now()
);

create index idx_pesagens_fazenda_categoria_pasto_data on pesagens(fazenda_id, categoria_id, pasto_id, data);
-- ver comentário em grupos_categoria_papel sobre RLS padrão em tabela nova
alter table pesagens disable row level security;

-- ---------------------------------------------------------------------
-- fn_relatorio_rebanho_por_pasto: fotografia do rebanho numa fazenda,
-- numa data (não um período — pasto é "onde os animais estão agora"),
-- cruzando fn_saldo_categoria_pasto (quantidade) com a pesagem mais
-- recente daquele pasto+categoria até aquela data (peso_medio_kg),
-- caindo pro peso de referência da categoria se aquele pasto
-- especificamente nunca foi pesado (não busca pesagem de outro pasto
-- da mesma fazenda — cada pasto é pesado à parte quando controla_pasto
-- está ligado). Pastos e categorias sem nenhum animal na data não
-- aparecem (mesmo princípio de "linha 100% zerada" já usado no
-- relatório de movimentação).
-- ---------------------------------------------------------------------

create or replace function fn_relatorio_rebanho_por_pasto(p_fazenda_id uuid, p_data date)
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
  v_pasto      record;
  v_categoria  record;
  v_qtd        int;
  v_peso       numeric;
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
      v_qtd := fn_saldo_categoria_pasto(p_fazenda_id, v_categoria.id, v_pasto.id, p_data);

      if v_qtd > 0 then
        select pz.peso_medio_kg into v_peso
        from pesagens pz
        where pz.fazenda_id = p_fazenda_id and pz.categoria_id = v_categoria.id
          and pz.pasto_id = v_pasto.id and pz.data <= p_data
        order by pz.data desc
        limit 1;

        pasto_id := v_pasto.id;
        pasto_nome := v_pasto.nome;
        pasto_ordem := v_pasto.ordem;
        categoria_id := v_categoria.id;
        categoria_nome := v_categoria.nome;
        quantidade := v_qtd;
        peso_medio_kg := coalesce(v_peso, v_categoria.peso_referencia_kg);

        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- =====================================================================
-- 2c. AJUSTES FINANCEIROS — desconto/acréscimo lançados em cima do
-- valor bruto de uma movimentação comercial (COMPRA, VENDA_PE,
-- VENDA_ABATE, CONSUMO_DOACAO — as únicas com valor_total). Catálogo
-- reutilizável (ex.: "Frete", "Comissão") + itens lançados por
-- movimentação, permitindo vários por venda. Valor líquido nunca é
-- guardado — sempre calculado na hora (bruto - descontos + acréscimos)
-- pra nunca ficar dessincronizado se um item for editado/removido.
-- =====================================================================

create type tipo_ajuste_financeiro as enum ('DESCONTO', 'ACRESCIMO');

create table itens_ajuste_financeiro (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  tipo       tipo_ajuste_financeiro not null,
  created_at timestamptz not null default now(),
  constraint uq_item_ajuste_nome_tipo unique (nome, tipo)
);
alter table itens_ajuste_financeiro disable row level security;

create table movimentacao_ajustes (
  id               uuid primary key default gen_random_uuid(),
  movimentacao_id  uuid not null references movimentacoes_rebanho(id) on delete cascade,
  item_id          uuid not null references itens_ajuste_financeiro(id),
  valor            numeric(12,2) not null check (valor > 0),
  created_at       timestamptz not null default now()
);
create index idx_movimentacao_ajustes_movimentacao on movimentacao_ajustes(movimentacao_id);
alter table movimentacao_ajustes disable row level security;

create or replace function fn_validar_ajuste_movimentacao_comercial()
returns trigger as $$
declare
  v_tipo tipo_movimentacao;
begin
  select tipo into v_tipo from movimentacoes_rebanho where id = new.movimentacao_id;
  if v_tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO') then
    raise exception 'Desconto/acréscimo só pode ser lançado em movimentações comerciais (compra, venda ou consumo/doação).';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_validar_ajuste_movimentacao_comercial
before insert on movimentacao_ajustes
for each row execute function fn_validar_ajuste_movimentacao_comercial();

-- =====================================================================
-- 3. FINANCEIRO
-- =====================================================================

create table lancamentos_financeiros (
  id                uuid primary key default gen_random_uuid(),
  fazenda_id        uuid not null references fazendas(id),
  conta             text,
  setor             text,
  descricao         text not null,
  data              date not null,
  valor             numeric(14,2) not null,
  tipo              tipo_lancamento_financeiro not null,
  classe            text,
  centro_custo_id   uuid references centros_custo(id),
  subcentro_id      uuid references subcentros_custo(id),
  usuario_id        uuid references usuarios(id),
  created_at        timestamptz not null default now()
);

create index idx_fin_fazenda_data on lancamentos_financeiros(fazenda_id, data);
create index idx_fin_centro_custo on lancamentos_financeiros(centro_custo_id);

create table regras_rateio (
  id                uuid primary key default gen_random_uuid(),
  centro_custo_id   uuid not null references centros_custo(id),
  criterio          criterio_rateio not null,
  -- fazendas contempladas pelo rateio; se null, aplica a todas as ativas
  fazendas_incluidas uuid[],
  percentual_fixo_json jsonb, -- usado quando criterio = PERCENTUAL_FIXO: {"fazenda_id": percentual}
  ativo             boolean not null default true,
  created_at        timestamptz not null default now()
);

-- =====================================================================
-- 4. VIEW — ESTOQUE CALCULADO POR FAZENDA / CATEGORIA
-- (substitui a digitação manual da aba "ESTOQUE PECUÁRIO")
-- =====================================================================

create view vw_estoque_rebanho as
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

-- =====================================================================
-- 4b. RELATÓRIO DE MOVIMENTAÇÃO DE REBANHO — por fazenda e período,
-- uma linha por categoria com estoque inicial/final e a movimentação
-- detalhada por tipo. Mesma lógica de entrada/saída de vw_estoque_rebanho
-- e fn_saldo_categoria, só que sem acumular (soma só dentro do período)
-- e com o detalhamento por tipo que o relatório precisa mostrar.
-- =====================================================================

create or replace function fn_relatorio_movimentacao_rebanho(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date
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
    -- saldo real das fazendas selecionadas na véspera da data inicial,
    -- somado a qualquer saldo inicial lançado dentro do próprio período
    -- filtrado (assim o relatório nunca mostra saldo inicial como se
    -- fosse uma "entrada" — ele sempre compõe o estoque inicial)
    coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_inicio - 1))
      from unnest(p_fazenda_ids) as f(id)), 0)::int
    + coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'SALDO_INICIAL'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'NASCIMENTO'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'COMPRA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    -- transferência só conta como entrada/saída do grupo quando cruza a
    -- fronteira do grupo selecionado; transferência 100% interna (origem
    -- e destino ambas no grupo) não muda o total e não aparece aqui
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_destino_id = any(p_fazenda_ids) and not (m.fazenda_origem_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MORTE'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo in ('VENDA_PE', 'VENDA_ABATE')
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_origem_id = any(p_fazenda_ids) and not (m.fazenda_destino_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'CONSUMO_DOACAO'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim), 0)::int,
    coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_fim))
      from unnest(p_fazenda_ids) as f(id)), 0)::int
  from categorias_animal c
  -- sem filtro de ativa aqui de propósito: uma categoria inativada
  -- some dos formulários de lançamento, mas o histórico dela precisa
  -- continuar aparecendo em relatórios de períodos em que teve
  -- movimentação real. Linhas totalmente zeradas (categoria nunca usada
  -- no período, ativa ou não) são filtradas no frontend, não aqui.
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- =====================================================================
-- 6. SEED — grupos, papéis e categorias padrão do sistema
-- =====================================================================

insert into grupos_categoria (nome, ordem) values
  ('BEZERRO', 1),
  ('JOVEM', 2),
  ('ADULTO', 3);

insert into grupos_categoria_papel (nome, sexo, ordem) values
  ('Bezerras Mamando', 'FEMEA', 1),
  ('Bezerros Mamando', 'MACHO', 2),
  ('Novilhas', 'FEMEA', 3),
  ('Garrotes e Bois', 'MACHO', 4),
  ('Matrizes em Reprodução', 'FEMEA', 5),
  ('Matrizes Descarte', 'FEMEA', 6),
  ('Touros', 'MACHO', 7),
  ('Outros', null, 8);

-- categorias do sistema (sistema = true): pré-cadastradas, não podem ser
-- renomeadas/reclassificadas/excluídas pelo usuário. grupo_id (Grupo
-- Faixa Etária) é preenchido automaticamente pela trigger
-- fn_calcular_atributos_categoria a partir da era informada aqui.
insert into categorias_animal (nome, grupo_categoria_papel_id, sexo, era, ordem_ciclo, sistema)
select 'Bezerra 00 a 08 Meses', p.id, 'FEMEA'::sexo_categoria, '00-08', 1, true from grupos_categoria_papel p where p.nome = 'Bezerras Mamando'
union all
select 'Bezerro 00 a 08 Meses', p.id, 'MACHO'::sexo_categoria, '00-08', 2, true from grupos_categoria_papel p where p.nome = 'Bezerros Mamando'
union all
select 'Novilha 08 a 12 Meses', p.id, 'FEMEA'::sexo_categoria, '08-12', 3, true from grupos_categoria_papel p where p.nome = 'Novilhas'
union all
select 'Novilha 12 a 24 Meses', p.id, 'FEMEA'::sexo_categoria, '12-24', 4, true from grupos_categoria_papel p where p.nome = 'Novilhas'
union all
select 'Novilha 24 a 36 Meses', p.id, 'FEMEA'::sexo_categoria, '24-36', 5, true from grupos_categoria_papel p where p.nome = 'Novilhas'
union all
select 'Garrote 08 a 12 Meses', p.id, 'MACHO'::sexo_categoria, '08-12', 6, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select 'Garrote 12 a 24 Meses', p.id, 'MACHO'::sexo_categoria, '12-24', 7, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select 'Boi 24 a 36 Meses', p.id, 'MACHO'::sexo_categoria, '24-36', 8, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select 'Boi +36 Meses', p.id, 'MACHO'::sexo_categoria, '36+', 9, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select 'Vaca +36 Meses', p.id, 'FEMEA'::sexo_categoria, '36+', 10, true from grupos_categoria_papel p where p.nome = 'Matrizes em Reprodução'
union all
select 'Touro', p.id, 'MACHO'::sexo_categoria, '36+', 11, true from grupos_categoria_papel p where p.nome = 'Touros';

insert into tipos_uso_area (nome, ordem) values
  ('Reserva Legal/APP', 1),
  ('Pecuária', 2),
  ('Agricultura', 3),
  ('Área em Reforma', 4),
  ('Área Alagada', 5),
  ('Infraestrutura', 6),
  ('Outros', 7);

-- =====================================================================
-- FIM DO SCRIPT
-- =====================================================================
