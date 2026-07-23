-- =====================================================================
-- ORION AGRO — Migração 035
-- fn_resumo_rebanho_atual passa a retornar também o sexo da categoria —
-- alimenta o novo gráfico "Distribuição sexo × categoria" no Painel.
-- Puramente aditiva (só acrescenta uma coluna ao retorno da função).
-- =====================================================================

-- postgres não permite mudar o tipo de retorno (colunas de returns table)
-- de uma função existente via create or replace — precisa dropar antes
drop function if exists fn_resumo_rebanho_atual(uuid[]);

create function fn_resumo_rebanho_atual(p_fazenda_ids uuid[])
returns table(
  fazenda_id uuid,
  categoria_id uuid,
  categoria_nome text,
  grupo_nome text,
  sexo sexo_categoria,
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
    c.sexo,
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
-- FIM DA MIGRAÇÃO 035
-- =====================================================================
