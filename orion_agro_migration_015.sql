-- =====================================================================
-- ORION AGRO — Migração 015
--
-- Reformula o cadastro de categorias:
-- 1) nova tabela grupos_categoria_papel ("Grupo Categoria" — papel
--    zootécnico: Novilhas, Touros etc. — determina o sexo da categoria)
-- 2) categorias_animal ganha grupo_categoria_papel_id, era e sistema
-- 3) trigger deriva sexo (pelo papel) e grupo_id/Grupo Faixa Etária
--    (pela era) automaticamente
-- 4) categoria "sistema" não pode ser editada/excluída pelo usuário;
--    categoria criada pelo usuário só pode ser excluída se não tiver
--    movimentação lançada
-- 5) renomeia as 9 categorias já existentes para o novo padrão
--    (mesmo ID — preserva o histórico de movimentações) e cadastra as
--    2 que faltam (Vaca +36 Meses, Touro)
-- 6) relatório de movimentação para de esconder categoria inativa —
--    o histórico dela precisa continuar aparecendo
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Grupo Categoria (papel zootécnico)
-- ---------------------------------------------------------------------

create table if not exists grupos_categoria_papel (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  sexo            sexo_categoria,
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);

insert into grupos_categoria_papel (nome, sexo, ordem) values
  ('Bezerras Mamando', 'FEMEA', 1),
  ('Bezerros Mamando', 'MACHO', 2),
  ('Novilhas', 'FEMEA', 3),
  ('Garrotes e Bois', 'MACHO', 4),
  ('Matrizes em Reprodução', 'FEMEA', 5),
  ('Matrizes Descarte', 'FEMEA', 6),
  ('Touros', 'MACHO', 7),
  ('Outros', null, 8)
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------
-- 2) colunas novas em categorias_animal
-- ---------------------------------------------------------------------

alter table categorias_animal
  add column if not exists grupo_categoria_papel_id uuid references grupos_categoria_papel(id),
  add column if not exists era text check (era in ('00-08', '08-12', '12-24', '24-36', '36+')),
  add column if not exists sistema boolean not null default false;

-- ---------------------------------------------------------------------
-- 3) deriva sexo (pelo papel) e grupo_id/Grupo Faixa Etária (pela era)
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

drop trigger if exists trg_calcular_atributos_categoria on categorias_animal;
create trigger trg_calcular_atributos_categoria
before insert or update on categorias_animal
for each row execute function fn_calcular_atributos_categoria();

-- ---------------------------------------------------------------------
-- 4) categoria sistema não pode ser editada nem excluída
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

drop trigger if exists trg_validar_edicao_categoria on categorias_animal;
create trigger trg_validar_edicao_categoria
before update on categorias_animal
for each row execute function fn_validar_edicao_categoria();

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

drop trigger if exists trg_validar_delete_categoria on categorias_animal;
create trigger trg_validar_delete_categoria
before delete on categorias_animal
for each row execute function fn_validar_delete_categoria();

-- ---------------------------------------------------------------------
-- 5) renomeia as categorias existentes para o novo padrão (mesmo ID)
--    e cadastra as 2 que faltam
-- ---------------------------------------------------------------------

update categorias_animal set
  nome = 'Bezerra 00 a 08 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Bezerras Mamando'),
  era = '00-08',
  ordem_ciclo = 1,
  sistema = true
where nome = 'BEZ. FÊMEA';

update categorias_animal set
  nome = 'Bezerro 00 a 08 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Bezerros Mamando'),
  era = '00-08',
  ordem_ciclo = 2,
  sistema = true
where nome = 'BEZ. MACHO';

update categorias_animal set
  nome = 'Novilha 08 a 12 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Novilhas'),
  era = '08-12',
  ordem_ciclo = 3,
  sistema = true
where nome = 'FÊMEA 8-12 M';

update categorias_animal set
  nome = 'Novilha 12 a 24 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Novilhas'),
  era = '12-24',
  ordem_ciclo = 4,
  sistema = true
where nome = 'FÊMEA 12-24 M';

update categorias_animal set
  nome = 'Novilha 24 a 36 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Novilhas'),
  era = '24-36',
  ordem_ciclo = 5,
  sistema = true
where nome = 'FÊMEA 24-36 M';

update categorias_animal set
  nome = 'Garrote 08 a 12 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Garrotes e Bois'),
  era = '08-12',
  ordem_ciclo = 6,
  sistema = true
where nome = 'MACHO 8-12 M';

update categorias_animal set
  nome = 'Garrote 12 a 24 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Garrotes e Bois'),
  era = '12-24',
  ordem_ciclo = 7,
  sistema = true
where nome = 'MACHO 12-24 M';

update categorias_animal set
  nome = 'Boi 24 a 36 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Garrotes e Bois'),
  era = '24-36',
  ordem_ciclo = 8,
  sistema = true
where nome = 'MACHO 24-36 M';

update categorias_animal set
  nome = 'Boi +36 Meses',
  grupo_categoria_papel_id = (select id from grupos_categoria_papel where nome = 'Garrotes e Bois'),
  era = '36+',
  ordem_ciclo = 9,
  sistema = true
where nome = 'MACHO +36 M';

insert into categorias_animal (nome, grupo_categoria_papel_id, sexo, era, ordem_ciclo, sistema)
select 'Vaca +36 Meses', p.id, 'FEMEA'::sexo_categoria, '36+', 10, true
from grupos_categoria_papel p where p.nome = 'Matrizes em Reprodução'
on conflict (nome, fazenda_id) do nothing;

insert into categorias_animal (nome, grupo_categoria_papel_id, sexo, era, ordem_ciclo, sistema)
select 'Touro', p.id, 'MACHO'::sexo_categoria, '36+', 11, true
from grupos_categoria_papel p where p.nome = 'Touros'
on conflict (nome, fazenda_id) do nothing;

-- ---------------------------------------------------------------------
-- 6) relatório para de esconder categoria inativa — histórico de
--    período com movimentação real precisa continuar aparecendo
-- ---------------------------------------------------------------------

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
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 015
-- =====================================================================
