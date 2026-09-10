-- =====================================================================
-- ORION AGRO — Migração 057
--
-- Módulo Financeiro — o Produto/Serviço de um lançamento gerado
-- automaticamente por Compra/Venda em Pé/Venda Abate passa a ser a
-- própria categoria do animal envolvido (ex.: "Novilha 08 a 12 Meses"),
-- não mais um produto genérico "Gado — Compra"/"Gado — Venda em Pé"/
-- "Gado — Venda Abate". A distinção entre Compra/Venda em Pé/Venda
-- Abate de uma mesma categoria não precisa estar no nome do produto —
-- já existe no subcentro (1.2.1 Abate / 1.2.2 Em pé / 3.3.1 Rebanho),
-- que continua sendo resolvido pelo tipo da movimentação, igual sempre
-- foi. Um relatório que agrupe por Subcentro → Produto já separa
-- "Abate" de "Em pé" naturalmente, sem precisar de nada a mais no
-- produto.
--
-- Os 3 produtos-sistema antigos ("Gado — Compra" etc.) continuam
-- existindo, mas só como referência interna pra
-- fn_compilar_lancamento_financeiro_movimentacao resolver o subcentro
-- de destino por tipo — nunca mais atribuídos como produto_id de
-- lançamento nenhum, por isso ficam inativos.
--
-- Nota aceita conscientemente: como a mesma categoria pode aparecer em
-- Compra e em Venda, o produto (agora só a categoria) é compartilhado
-- entre os dois — o "subcentro padrão" desse produto (usado só como
-- pré-preenchimento de conveniência num lançamento MANUAL) vai refletir
-- qual tipo criou o produto primeiro, não os dois. Não afeta lançamento
-- automático nenhum (o subcentro desses sempre é resolvido pelo tipo,
-- nunca lido do produto).
-- =====================================================================

update produtos_financeiros set ativo = false
where sistema = true and nome in ('Gado — Compra', 'Gado — Venda em Pé', 'Gado — Venda Abate');

create or replace function fn_compilar_lancamento_financeiro_movimentacao()
returns trigger as $$
declare
  v_produto_sistema_nome text;
  v_descricao    text;
  v_subcentro_id uuid;
  v_categoria_nome text;
  v_produto_id   uuid;
  v_valor        numeric;
begin
  if new.tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE') then
    return new;
  end if;

  v_produto_sistema_nome := case new.tipo
    when 'COMPRA' then 'Gado — Compra'
    when 'VENDA_PE' then 'Gado — Venda em Pé'
    when 'VENDA_ABATE' then 'Gado — Venda Abate'
  end;

  v_descricao := case new.tipo
    when 'COMPRA' then 'Compra de gado'
    when 'VENDA_PE' then 'Venda em pé'
    when 'VENDA_ABATE' then 'Venda abate'
  end;

  -- subcentro de destino continua resolvido pelo tipo da movimentação,
  -- via o subcentro já guardado no produto-sistema histórico (nunca
  -- mais usado como produto_id, só como referência interna aqui) — é
  -- esse subcentro (Abate/Em pé/Rebanho), não o produto, quem carrega
  -- a distinção entre os 3 tipos de operação
  select subcentro_custo_id into v_subcentro_id
  from produtos_financeiros
  where conta_id = new.conta_id and nome = v_produto_sistema_nome and sistema = true;

  if v_subcentro_id is null then
    return new;
  end if;

  select nome into v_categoria_nome from categorias_animal where id = new.categoria_id;
  if v_categoria_nome is null then
    return new;
  end if;

  -- produto = a própria categoria do animal, sem sufixo de tipo —
  -- compartilhado entre Compra/Venda em Pé/Venda Abate da mesma
  -- categoria (ver nota acima sobre o subcentro padrão desse produto)
  select id into v_produto_id
  from produtos_financeiros
  where conta_id = new.conta_id and nome = v_categoria_nome;

  if v_produto_id is null then
    insert into produtos_financeiros (conta_id, nome, subcentro_custo_id, sistema)
    values (new.conta_id, v_categoria_nome, v_subcentro_id, true)
    returning id into v_produto_id;
  end if;

  v_valor := fn_valor_liquido_movimentacao(new.id);

  insert into lancamentos_financeiros
    (conta_id, fazenda_id, descricao, data, valor, subcentro_id, produto_id, movimentacao_id, status, pessoa_id, proprietario_id)
  values
    (new.conta_id, new.fazenda_id, v_descricao, new.data, v_valor, v_subcentro_id, v_produto_id, new.id, 'PENDENTE', new.cliente_fornecedor_id, new.proprietario_id)
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
