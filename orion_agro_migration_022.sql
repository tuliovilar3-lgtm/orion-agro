-- =====================================================================
-- ORION AGRO — Migração 022
--
-- Pesagem por pasto: quando a fazenda usa controla_pasto, a pesagem
-- deve ser feita por pasto também, não só por categoria. Mesmo padrão
-- já usado em pasto_id em movimentacoes_rebanho — sempre obrigatório,
-- com backfill pro pasto "Geral" das pesagens já existentes.
-- =====================================================================

alter table pesagens
  add column pasto_id uuid references pastos(id);

update pesagens pz
set pasto_id = p.id
from modulos m
join pastos p on p.modulo_id = m.id and p.nome = 'Geral'
where m.fazenda_id = pz.fazenda_id
  and m.nome = 'Geral'
  and pz.pasto_id is null;

alter table pesagens
  alter column pasto_id set not null;

drop index if exists idx_pesagens_fazenda_categoria_data;
create index idx_pesagens_fazenda_categoria_pasto_data on pesagens(fazenda_id, categoria_id, pasto_id, data);

-- fn_relatorio_rebanho_por_pasto — mesma assinatura e colunas de
-- retorno, só muda a busca da pesagem pra casar o pasto específico em
-- vez de qualquer pesagem da fazenda+categoria.
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
        where pz.fazenda_id = p_fazenda_id and pz.categoria_id = v_categoria.id
          and pz.pasto_id = v_pasto.id and pz.data <= p_data
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
-- FIM DA MIGRAÇÃO 022
-- =====================================================================
