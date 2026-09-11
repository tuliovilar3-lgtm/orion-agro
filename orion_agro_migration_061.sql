-- Migração 061: funde os Centros de Custo 2.1 (Arrendamento) e 2.6
-- (Receitas Imobiliárias, criado na migração 059) num só — mantém o
-- centro 2.1, renomeado pra "Receitas Imobiliárias", reunindo os 4
-- subcentros da receita imobiliária inteira (venda + aluguel +
-- arrendamento); o centro 2.6 é removido depois de esvaziado.
--
-- Ordem importa: renumerar/renomear primeiro o subcentro antigo de
-- 2.1 pra numero 4 (evita qualquer confusão de numero repetido
-- durante a transição, mesmo sem constraint de unicidade sobre
-- numero), só depois mover os 3 subcentros de 2.6 pra dentro de 2.1,
-- e só então apagar o centro 2.6 (já vazio) e renomear o 2.1 —
-- apagar o 2.6 antes do rename evita colidir com
-- uq_centro_custo_nome (2.1 e 2.6 não podem ter o mesmo nome ao
-- mesmo tempo). Junção sempre por número de classe/centro/subcentro,
-- não por nome, mesmo padrão das migrações 059/060 — imune a
-- qualquer rename futuro e aplicada de uma vez pra todas as contas.

-- 1) "Arrendamento" (2.1.1) vira "Arrendamento de Imóveis Rurais" (2.1.4)
update subcentros_custo sc
set numero = 4, nome = 'Arrendamento de Imóveis Rurais'
from centros_custo cc
join classes_financeiras cf on cf.id = cc.classe_financeira_id
where sc.centro_custo_id = cc.id
  and cf.numero = 2
  and cc.numero = 1
  and sc.numero = 1
  and sc.sistema = true;

-- 2) move os 3 subcentros de 2.6 pra dentro de 2.1 (numero 1/2/3
--    preservado) e renomeia o de aluguel pra "Aluguel de Imóveis Urbanos"
update subcentros_custo sc
set centro_custo_id = destino.centro_id,
    nome = case sc.numero when 3 then 'Aluguel de Imóveis Urbanos' else sc.nome end
from (
  select cc6.id as origem_id, cc1.id as centro_id
  from centros_custo cc6
  join classes_financeiras cf6 on cf6.id = cc6.classe_financeira_id and cf6.numero = 2
  join centros_custo cc1 on cc1.classe_financeira_id = cf6.id and cc1.numero = 1
  where cc6.numero = 6 and cc6.sistema = true
) as destino
where sc.centro_custo_id = destino.origem_id;

-- 3) apaga o centro 2.6, já esvaziado
delete from centros_custo cc
using classes_financeiras cf
where cc.classe_financeira_id = cf.id
  and cf.numero = 2
  and cc.numero = 6
  and cc.sistema = true;

-- 4) 2.1 vira "Receitas Imobiliárias"
update centros_custo cc
set nome = 'Receitas Imobiliárias'
from classes_financeiras cf
where cc.classe_financeira_id = cf.id
  and cf.numero = 2
  and cc.numero = 1
  and cc.sistema = true;
