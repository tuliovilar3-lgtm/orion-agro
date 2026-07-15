-- =====================================================================
-- ORION AGRO — Migração 021
--
-- Relatório "Rebanho por pasto": fotografia do rebanho numa fazenda,
-- numa data, cruzando fn_saldo_categoria_pasto (quantidade) com a
-- pesagem mais recente da categoria até aquela data (peso_medio_kg),
-- caindo pro peso de referência da categoria se ela nunca foi pesada.
-- =====================================================================

-- pesagens é de antes do hábito de desabilitar RLS em toda tabela nova
-- (migração 002) — reforça aqui por segurança, é um no-op se já tiver
-- sido desabilitado.
alter table pesagens disable row level security;

create or replace function fn_relatorio_rebanho_por_pasto(p_fazenda_id uuid, p_data date)
returns table(
  pasto_id uuid,
  pasto_nome text,
  pasto_ordem int,
  categoria_id uuid,
  categoria_nome text,
  quantidade int,
  peso_medio_kg numeric
)
language plpgsql
as $$
declare
  v_pasto      record;
  v_categoria  record;
  v_qtd        int;
  v_peso       numeric;
begin
  for v_pasto in (
    select p.id, p.nome, p.ordem
    from pastos p
    join modulos m on m.id = p.modulo_id
    where m.fazenda_id = p_fazenda_id
    order by m.ordem, p.ordem
  )
  loop
    for v_categoria in (
      select c.id, c.nome, c.peso_referencia_kg
      from categorias_animal c
      order by c.ordem_ciclo, c.nome
    )
    loop
      v_qtd := fn_saldo_categoria_pasto(p_fazenda_id, v_categoria.id, v_pasto.id, p_data);

      if v_qtd > 0 then
        select pz.peso_medio_kg into v_peso
        from pesagens pz
        where pz.fazenda_id = p_fazenda_id and pz.categoria_id = v_categoria.id and pz.data <= p_data
        order by pz.data desc
        limit 1;

        pasto_id := v_pasto.id;
        pasto_nome := v_pasto.nome;
        pasto_ordem := v_pasto.ordem;
        categoria_id := v_categoria.id;
        categoria_nome := v_categoria.nome;
        quantidade := v_qtd;
        peso_medio_kg := coalesce(v_peso, v_categoria.peso_referencia_kg);

        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- =====================================================================
-- FIM DA MIGRAÇÃO 021
-- =====================================================================
