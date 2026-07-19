-- =====================================================================
-- ORION AGRO — Migração 033
-- fn_resumo_rebanho_atual: alimenta o painel inicial (distribuição
-- atual do rebanho por categoria/grupo faixa etária + peso médio
-- resolvido). Puramente aditiva — nenhuma tabela existente muda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- fn_resumo_rebanho_atual: uma linha por (fazenda, categoria) com saldo
-- atual > 0 (vw_estoque_rebanho já cobre isso), com o peso médio
-- resolvido pela pesagem mais recente da categoria naquela fazenda
-- (qualquer pasto — o painel é uma visão agregada, não precisa da
-- granularidade por pasto que os relatórios de pastagem usam), caindo
-- pro peso de referência da categoria quando nunca foi pesada.
-- ---------------------------------------------------------------------

create or replace function fn_resumo_rebanho_atual(p_fazenda_ids uuid[])
returns table(
  fazenda_id uuid,
  categoria_id uuid,
  categoria_nome text,
  grupo_nome text,
  quantidade integer,
  peso_medio_kg numeric
)
language plpgsql
stable
as $$
begin
  return query
  select
    e.fazenda_id,
    e.categoria_id,
    e.categoria_nome,
    g.nome as grupo_nome,
    e.saldo_atual::int as quantidade,
    coalesce(
      (select p.peso_medio_kg from pesagens p
       where p.fazenda_id = e.fazenda_id and p.categoria_id = e.categoria_id and p.data <= current_date
       order by p.data desc limit 1),
      c.peso_referencia_kg
    ) as peso_medio_kg
  from vw_estoque_rebanho e
  join categorias_animal c on c.id = e.categoria_id
  join grupos_categoria g on g.id = c.grupo_id
  where e.saldo_atual > 0
    and (p_fazenda_ids is null or e.fazenda_id = any(p_fazenda_ids));
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 033
-- =====================================================================
