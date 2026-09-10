-- =====================================================================
-- ORION AGRO — Migração 056
--
-- Módulo Financeiro — Fase 2: Contas a Pagar/Receber. Separa "título"
-- (lancamentos_financeiros — o quanto se deve, já existia) de "baixa"
-- (lancamento_baixas, nova — quando vence/foi pago, parcela, conta
-- bancária), pra não colidir com a unicidade de movimentacao_id nem
-- com a trava de estorno (migração 055). Um título sem nenhuma baixa
-- continua se comportando exatamente como hoje (comportamento de
-- /financeiro inalterado). Cadastro de conta bancária ganha catálogo
-- próprio (contas_bancarias), com "Dinheiro (em espécie)" seedado
-- automaticamente pra toda conta. Recurso pago via conta_recursos,
-- mesmo mecanismo já usado por "Controle por pasto".
-- =====================================================================

-- 1) Contas bancárias (+ "Dinheiro em espécie") ------------------------

create table contas_bancarias (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  nome       text not null,
  especie    boolean not null default false,
  sistema    boolean not null default false,
  ativo      boolean not null default true,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_conta_bancaria_nome unique (conta_id, nome)
);
alter table contas_bancarias enable row level security;
create policy contas_bancarias_por_conta on contas_bancarias for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create or replace function fn_criar_conta_bancaria_especie()
returns trigger as $$
begin
  insert into contas_bancarias (conta_id, nome, especie, sistema, ordem)
  values (new.id, 'Dinheiro (em espécie)', true, true, 0);
  return new;
end;
$$ language plpgsql;

create trigger trg_criar_conta_bancaria_especie
after insert on contas
for each row execute function fn_criar_conta_bancaria_especie();

-- backfill pras contas já existentes (idempotente — não recria se já
-- houver alguma linha "Dinheiro (em espécie)" pra aquela conta)
insert into contas_bancarias (conta_id, nome, especie, sistema, ordem)
select c.id, 'Dinheiro (em espécie)', true, true, 0
from contas c
where not exists (
  select 1 from contas_bancarias cb where cb.conta_id = c.id and cb.especie = true
);

-- 2) Baixas (vencimento/pagamento/parcela), filhas de um título --------

create table lancamento_baixas (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references contas(id) default fn_conta_atual(),
  lancamento_id     uuid not null references lancamentos_financeiros(id) on delete cascade,
  numero_parcela    int not null default 1,
  total_parcelas    int not null default 1,
  data_vencimento   date,
  data_pagamento    date,
  valor             numeric(14,2) not null,
  conta_bancaria_id uuid references contas_bancarias(id),
  observacao        text,
  created_at        timestamptz not null default now(),
  constraint uq_lancamento_baixa_parcela unique (lancamento_id, numero_parcela)
);
create index idx_lancamento_baixas_lancamento on lancamento_baixas(lancamento_id);
create index idx_lancamento_baixas_aberto on lancamento_baixas(data_vencimento) where data_pagamento is null;
alter table lancamento_baixas enable row level security;
create policy lancamento_baixas_por_conta on lancamento_baixas for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- 3) Título ganha fornecedor/cliente, proprietário e número de documento

alter table lancamentos_financeiros add column pessoa_id uuid references pessoas(id);
alter table lancamentos_financeiros add column proprietario_id uuid references pessoas(id);
alter table lancamentos_financeiros add column numero_documento text;

-- 4) fn_compilar_lancamento_financeiro_movimentacao passa a herdar
-- fornecedor/cliente e proprietário direto da movimentação de origem
-- (mesmas 2 FKs que movimentacoes_rebanho já tem pra pessoas) — nunca
-- mexe em baixa nenhuma, só no título, igual já fazia antes.
create or replace function fn_compilar_lancamento_financeiro_movimentacao()
returns trigger as $$
declare
  v_produto_nome text;
  v_produto_id   uuid;
  v_subcentro_id uuid;
  v_valor        numeric;
begin
  if new.tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE') then
    return new;
  end if;

  v_produto_nome := case new.tipo
    when 'COMPRA' then 'Gado — Compra'
    when 'VENDA_PE' then 'Gado — Venda em Pé'
    when 'VENDA_ABATE' then 'Gado — Venda Abate'
  end;

  select id, subcentro_custo_id into v_produto_id, v_subcentro_id
  from produtos_financeiros
  where conta_id = new.conta_id and nome = v_produto_nome and sistema = true;

  if v_produto_id is null then
    return new;
  end if;

  v_valor := fn_valor_liquido_movimentacao(new.id);

  insert into lancamentos_financeiros
    (conta_id, fazenda_id, descricao, data, valor, subcentro_id, produto_id, movimentacao_id, status, pessoa_id, proprietario_id)
  values
    (new.conta_id, new.fazenda_id, v_produto_nome, new.data, v_valor, v_subcentro_id, v_produto_id, new.id, 'PENDENTE', new.cliente_fornecedor_id, new.proprietario_id)
  on conflict (movimentacao_id) do update set
    fazenda_id      = excluded.fazenda_id,
    data            = excluded.data,
    valor           = excluded.valor,
    subcentro_id    = excluded.subcentro_id,
    produto_id      = excluded.produto_id,
    status          = 'PENDENTE',
    confirmado_por  = null,
    confirmado_em   = null,
    pessoa_id       = excluded.pessoa_id,
    proprietario_id = excluded.proprietario_id;

  return new;
end;
$$ language plpgsql;

-- 5) Recurso pago (mesmo mecanismo de "Controle por pasto") -----------

alter table configuracoes add column controla_contas_pagar_receber boolean not null default false;

insert into conta_recursos (conta_id, dominio, recurso, ativo)
select id, 'financeiro', 'contas_a_pagar_receber', true from contas where nome = 'Conta Principal'
on conflict (conta_id, dominio, recurso) do nothing;

update configuracoes set controla_contas_pagar_receber = true
where conta_id = (select id from contas where nome = 'Conta Principal');
