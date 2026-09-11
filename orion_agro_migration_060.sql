-- Migração 060: renomeia os subcentros 2.6.1 e 2.6.2 (dentro do Centro
-- de Custo "Receitas Imobiliárias", renomeado na migração 059) pra
-- deixar claro que são especificamente sobre venda — o centro agora
-- também tem 2.6.3 "Aluguel de Imóveis", então "Imóveis Rurais"/
-- "Imóveis Urbanos" sozinhos ficariam ambíguos entre venda e aluguel.
--
-- Junção por número (classe 2, centro 6, subcentro 1/2), não por nome
-- — mesmo padrão já usado na migração 059, imune a qualquer rename
-- futuro e aplicada de uma vez pra todas as contas existentes.

update subcentros_custo sc
set nome = 'Venda de Imóveis Rurais'
from centros_custo cc
join classes_financeiras cf on cf.id = cc.classe_financeira_id
where sc.centro_custo_id = cc.id
  and cf.numero = 2
  and cc.numero = 6
  and sc.numero = 1
  and sc.sistema = true;

update subcentros_custo sc
set nome = 'Venda de Imóveis Urbanos'
from centros_custo cc
join classes_financeiras cf on cf.id = cc.classe_financeira_id
where sc.centro_custo_id = cc.id
  and cf.numero = 2
  and cc.numero = 6
  and sc.numero = 2
  and sc.sistema = true;
