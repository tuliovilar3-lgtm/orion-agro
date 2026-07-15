-- =====================================================================
-- ORION AGRO — Migração 024
--
-- Ajustes financeiros: desconto/acréscimo lançados em cima do valor
-- bruto de uma movimentação comercial (COMPRA, VENDA_PE, VENDA_ABATE,
-- CONSUMO_DOACAO). Catálogo reutilizável de itens (ex.: "Frete") +
-- lançamento por movimentação (permite vários itens por venda). Valor
-- líquido nunca é guardado — sempre calculado na hora.
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
-- FIM DA MIGRAÇÃO 024
-- =====================================================================
