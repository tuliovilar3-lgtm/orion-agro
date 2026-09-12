-- Migração 067: Saldo Inicial por Pasto — permite mais de uma linha de
-- Saldo Inicial pra mesma categoria, desde que em pastos diferentes
--
-- Pedido do usuário: clientes com Controle por Pasto contratado ganham a
-- opção de declarar o rebanho inicial pasto a pasto (categoria+quantidade+
-- peso dentro de cada bloco de pasto), além do modo tradicional (uma linha
-- por categoria, um único pasto pra fazenda inteira). Diferente do caso do
-- bezerro/safra (migração 066, que exigiu uma tabela filha porque a
-- categoria tinha que continuar sendo uma linha só): aqui pasto já é uma
-- coluna normal e sempre obrigatória em `movimentacoes_rebanho` — não
-- precisa de tabela nova, só a constraint que hoje só permite 1 linha de
-- SALDO_INICIAL por (fazenda, categoria) passa a considerar também o
-- pasto, permitindo N linhas legítimas (uma por pasto) pra mesma
-- categoria.
--
-- fn_saldo_categoria/fn_saldo_categoria_pasto (e todo o resto do sistema
-- que soma saldo por fazenda/pasto) já tratam "total da fazenda = soma dos
-- pastos" nativamente — nenhuma outra função precisa mudar.

drop index if exists uq_saldo_inicial_por_categoria;

create unique index uq_saldo_inicial_por_categoria
  on movimentacoes_rebanho (fazenda_id, categoria_id, pasto_id)
  where tipo = 'SALDO_INICIAL';
