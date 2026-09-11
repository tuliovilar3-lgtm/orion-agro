-- =====================================================================
-- ORION AGRO — Migração 058
--
-- Módulo Financeiro — Atividades Econômicas: nova dimensão de
-- classificação, ortogonal ao plano de contas (Classe/Centro/
-- Subcentro, que classifica o TIPO da despesa/receita) e à Fazenda —
-- classifica A QUAL NEGÓCIO o lançamento pertence, pra famílias/
-- fazendas que operam mais de uma atividade ao mesmo tempo (ex.:
-- pecuária + fábrica de ração). Catálogo pequeno (mesmo molde de
-- contas_bancarias, migração 056), seedado com 14 sugestões comuns do
-- meio rural, todas INATIVAS por padrão — diferente de outros seeds
-- (categorias_animal, subtipos_uso_area), que nascem ativos, porque
-- aqui a lista inteira é só um cardápio de possibilidades (a maioria
-- das fazendas usa só 1-3 das 14), não um ponto de partida universal.
-- Campo opcional em lancamentos_financeiros — nunca obrigatório, e
-- lançamentos automáticos (Compra/Venda) ficam de fora desta fase
-- (sempre null, sem alteração no formulário de Movimentações).
-- =====================================================================

create table atividades_economicas (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  nome       text not null,
  sistema    boolean not null default false,
  ativo      boolean not null default true,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_atividade_economica_nome unique (conta_id, nome)
);
alter table atividades_economicas enable row level security;
create policy atividades_economicas_por_conta on atividades_economicas for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create or replace function fn_seed_atividades_economicas_conta(p_conta_id uuid)
returns void
language plpgsql
as $$
begin
  insert into atividades_economicas (conta_id, nome, sistema, ativo, ordem)
  values
    (p_conta_id, 'Pecuária Campo', true, false, 1),
    (p_conta_id, 'Pecuária Genética', true, false, 2),
    (p_conta_id, 'Pecuária Confinamento', true, false, 3),
    (p_conta_id, 'Agricultura Anual', true, false, 4),
    (p_conta_id, 'Agricultura Permanente', true, false, 5),
    (p_conta_id, 'Silvicultura', true, false, 6),
    (p_conta_id, 'Imobiliária / Arrendamento', true, false, 7),
    (p_conta_id, 'Financiamento', true, false, 8),
    (p_conta_id, 'Haras', true, false, 9),
    (p_conta_id, 'Armazém', true, false, 10),
    (p_conta_id, 'Almoxarifado', true, false, 11),
    (p_conta_id, 'Fábrica de Ração', true, false, 12),
    (p_conta_id, 'Piscicultura', true, false, 13),
    (p_conta_id, 'Transportadora', true, false, 14);
end;
$$;

create or replace function fn_seed_atividades_economicas_conta_trigger()
returns trigger as $$
begin
  perform fn_seed_atividades_economicas_conta(new.id);
  return new;
end;
$$ language plpgsql;

create trigger trg_seed_atividades_economicas_conta
after insert on contas
for each row execute function fn_seed_atividades_economicas_conta_trigger();

-- backfill pras contas já existentes (idempotente)
select fn_seed_atividades_economicas_conta(id)
from contas c
where not exists (select 1 from atividades_economicas a where a.conta_id = c.id);

alter table lancamentos_financeiros add column atividade_economica_id uuid references atividades_economicas(id);
