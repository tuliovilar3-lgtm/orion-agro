-- =====================================================================
-- ORION AGRO — Migração 002
-- Incremental sobre o banco já criado a partir de orion_agro_schema.sql.
-- Rode isto no SQL editor do Supabase (não recria tabelas existentes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ATENÇÃO ANTES DE RODAR:
-- A nova constraint ck_cliente_fornecedor_obrigatorio exige
-- cliente_fornecedor_id em COMPRA/VENDA_PE/VENDA_ABATE. Se você tiver
-- lançamentos de teste desses tipos sem cliente/fornecedor preenchido
-- (ex: a COMPRA de teste feita durante o desenvolvimento), a migração
-- vai falhar ao validar a constraint. Rode a consulta abaixo primeiro
-- para checar, e apague ou corrija o que aparecer antes de continuar:
--
--   select id, tipo, data, quantidade from movimentacoes_rebanho
--   where tipo in ('COMPRA','VENDA_PE','VENDA_ABATE')
--     and cliente_fornecedor_id is null;
-- ---------------------------------------------------------------------

-- 1) novo enum + coluna de subtipo (consumo interno / doação)
create type subtipo_consumo_doacao as enum ('CONSUMO_INTERNO', 'DOACAO');

alter table movimentacoes_rebanho
  add column subtipo_consumo_doacao subtipo_consumo_doacao;

alter table movimentacoes_rebanho
  add constraint ck_subtipo_consumo_doacao check (
    (tipo = 'CONSUMO_DOACAO' and subtipo_consumo_doacao is not null)
    or
    (tipo <> 'CONSUMO_DOACAO' and subtipo_consumo_doacao is null)
  );

-- 2) cliente/fornecedor obrigatório em compra e nas duas formas de venda
alter table movimentacoes_rebanho
  add constraint ck_cliente_fornecedor_obrigatorio check (
    tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE')
    or cliente_fornecedor_id is not null
  );

-- 3) causa da morte obrigatória em lançamentos de morte
alter table movimentacoes_rebanho
  add constraint ck_causa_morte_obrigatoria check (
    tipo <> 'MORTE' or causa_morte is not null
  );

-- 4) trigger de cálculo de valores passa a incluir TRANSFERENCIA
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

  if new.peso_total_kg is not null and new.peso_total_kg > 0 then
    if new.peso_morto_kg is not null and new.rendimento_carcaca_pct is null then
      new.rendimento_carcaca_pct := round(new.peso_morto_kg / new.peso_total_kg * 100, 2);
    elsif new.rendimento_carcaca_pct is not null and new.peso_morto_kg is null then
      new.peso_morto_kg := round(new.peso_total_kg * new.rendimento_carcaca_pct / 100, 2);
    end if;
  end if;

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

  if new.valor_total is null then
    if new.valor_arroba is not null and v_total_arrobas is not null then
      new.valor_total := round(new.valor_arroba * v_total_arrobas, 2);
    elsif new.valor_cabeca is not null and new.quantidade is not null then
      new.valor_total := round(new.valor_cabeca * new.quantidade, 2);
    elsif new.valor_kg is not null and new.peso_total_kg is not null and new.peso_total_kg > 0 then
      new.valor_total := round(new.valor_kg * new.peso_total_kg, 2);
    end if;
  end if;

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

-- (trigger trg_calcular_valores_movimentacao já existe e aponta pra essa
-- função — não precisa recriar o trigger, só a função acima.)

-- 5) tabela nova de pesagens (desacoplada de movimentacoes_rebanho)
create table pesagens (
  id              uuid primary key default gen_random_uuid(),
  fazenda_id      uuid not null references fazendas(id),
  categoria_id    uuid not null references categorias_animal(id),
  data            date not null,
  peso_medio_kg   numeric(10,2) not null check (peso_medio_kg > 0),
  observacao      text,
  usuario_id      uuid references usuarios(id),
  created_at      timestamptz not null default now()
);

create index idx_pesagens_fazenda_categoria_data on pesagens(fazenda_id, categoria_id, data);

-- =====================================================================
-- FIM DA MIGRAÇÃO 002
-- =====================================================================
