-- Migração 072: catálogo de Causas de Morte
--
-- Pedido do usuário: "as causas morte devem ser padronizadas, com a opção de criar uma nova
-- causa na mesma tela do lançamento quando não tiver pré-cadastrado. Devemos ter um campo onde
-- as causas morte ficam registradas para podermos gerenciar."
--
-- Decisão de desenho: `movimentacoes_rebanho.causa_morte` continua sendo a mesma coluna de texto
-- livre de sempre — nada muda em quem já lê/grava esse campo (relatório de Mortalidade, listagem
-- de Movimentações, etc.). O que muda é só a ORIGEM do texto: em vez de digitar livremente, o
-- usuário escolhe de um catálogo gerenciável (`causas_morte`), com "+ Nova causa..." inline
-- inserindo tanto no catálogo quanto no lançamento — mesmo princípio já usado em
-- `itens_ajuste_financeiro` (desconto/acréscimo). Catálogo pequeno, sem coluna `sistema` (não há
-- linha protegida nenhuma aqui, só ativar/inativar).
create table causas_morte (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references contas(id) default fn_conta_atual(),
  nome text not null,
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_causa_morte_nome unique (conta_id, nome)
);

alter table causas_morte enable row level security;
create policy causas_morte_por_conta on causas_morte for all
  using (conta_id = fn_conta_atual())
  with check (conta_id = fn_conta_atual());

-- backfill: toda causa_morte já usada em algum lançamento vira uma entrada no catálogo da mesma
-- conta, pra não perder o histórico já digitado e pra já popular o dropdown com o que a fazenda
-- já usa de verdade (mesmo princípio já usado quando `cultura` virou subtipo de uso, migração 032)
insert into causas_morte (conta_id, nome)
select distinct conta_id, trim(causa_morte)
from movimentacoes_rebanho
where causa_morte is not null and trim(causa_morte) <> ''
on conflict (conta_id, nome) do nothing;
