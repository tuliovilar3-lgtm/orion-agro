-- Migração 059: renomeia o Centro de Custo "2.6 — Venda de Imóveis" para
-- "Receitas Imobiliárias" (pedido do usuário: ele também quer incluir
-- recebimento de aluguel como subcentro, então o nome "Venda de
-- Imóveis" ficaria estreito demais) e adiciona o novo subcentro
-- "Aluguel de Imóveis" (2.6.3) — mesmo padrão de nome já usado em
-- "Aluguel de Máquinas" (2.2.2).
--
-- Junção por número (classe 2, centro 6), não por nome — imune a
-- qualquer rename futuro e aplica de uma vez pra todas as contas
-- existentes (Conta Principal incluída, sem precisar de backfill
-- separado como os seeds de tabela nova).

update centros_custo cc
set nome = 'Receitas Imobiliárias'
from classes_financeiras cf
where cc.classe_financeira_id = cf.id
  and cf.numero = 2
  and cc.numero = 6
  and cc.sistema = true;

insert into subcentros_custo (conta_id, centro_custo_id, numero, nome, sistema)
select cc.conta_id, cc.id, 3, 'Aluguel de Imóveis', true
from centros_custo cc
join classes_financeiras cf on cf.id = cc.classe_financeira_id
where cf.numero = 2
  and cc.numero = 6
  and cc.sistema = true
on conflict (centro_custo_id, nome) do nothing;
