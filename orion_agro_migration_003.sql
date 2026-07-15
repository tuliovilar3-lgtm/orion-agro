-- =====================================================================
-- ORION AGRO — Migração 003
-- Incremental sobre o banco já criado. Rode no SQL editor do Supabase.
-- =====================================================================

-- 1) grupo e sexo passam a ser obrigatórios no cadastro de categorias
--    (já checamos: não há categoria existente sem grupo_id, então isso
--    não quebra nada hoje)
alter table categorias_animal
  alter column grupo_id set not null;

alter table categorias_animal
  alter column sexo drop default;

-- 2) categorias de plantel adulto (VACA, VACA DESCARTE, VACA LEITEIRA,
--    TOURO) — SINUELO e COCHÉ ficam de fora por enquanto, a critério
--    de cada fazenda cadastrar depois pela tela de categorias
insert into categorias_animal (nome, grupo_id, sexo)
select 'VACA', id, 'FEMEA'::sexo_categoria from grupos_categoria where nome = 'ADULTO'
union all
select 'VACA DESCARTE', id, 'FEMEA'::sexo_categoria from grupos_categoria where nome = 'ADULTO'
union all
select 'VACA LEITEIRA', id, 'FEMEA'::sexo_categoria from grupos_categoria where nome = 'ADULTO'
union all
select 'TOURO', id, 'MACHO'::sexo_categoria from grupos_categoria where nome = 'ADULTO';

-- =====================================================================
-- FIM DA MIGRAÇÃO 003
-- =====================================================================
