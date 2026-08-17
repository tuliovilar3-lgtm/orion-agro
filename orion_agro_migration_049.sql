-- =====================================================================
-- Migração 049 — onboarding de conta nova: seed automático de
-- categorias-sistema e subtipos de uso de área
-- =====================================================================
--
-- Contexto: hoje só `configuracoes` é auto-criada por conta nova
-- (fn_criar_configuracoes_conta, trigger after insert on contas,
-- migração 046). As 11 categorias-sistema e os subtipos de uso de área
-- ("Geral" + sugestões de Pecuária/Agricultura) só existem pra "Conta
-- Principal", inseridos manualmente no bloco de seed no fim de
-- orion_agro_schema.sql — sem isso, uma conta de cliente nova (criada
-- pela tela de onboarding de Suporte, ver app/api/contas/route.ts)
-- nasceria sem nenhuma categoria de animal nem subtipo de uso pra
-- lançar nada.
--
-- Mesmo padrão de fn_criar_configuracoes_conta: replica a lógica de
-- seed já usada pra "Conta Principal" (schema.sql), usando new.id como
-- conta_id em vez de "(select id from contas limit 1)". grupos_categoria
-- _papel e tipos_uso_area são catálogos globais (sem conta_id) — o seed
-- só grava linhas conta-scoped em categorias_animal/subtipos_uso_area.
--
-- Não precisa de mudança de RLS: contas só é inserida pelo cliente
-- admin/service-role (bypassa RLS), e os inserts feitos por esta
-- trigger dentro da mesma transação usam conta_id = new.id explícito,
-- sem depender de fn_conta_atual() resolver nada.
-- =====================================================================

create or replace function fn_seed_categorias_subtipos_conta()
returns trigger as $$
begin
  insert into categorias_animal (conta_id, nome, grupo_categoria_papel_id, sexo, era, ordem_ciclo, sistema)
  select new.id, 'Bezerra 00 a 08 Meses', p.id, 'FEMEA'::sexo_categoria, '00-08', 1, true from grupos_categoria_papel p where p.nome = 'Bezerras Mamando'
  union all
  select new.id, 'Bezerro 00 a 08 Meses', p.id, 'MACHO'::sexo_categoria, '00-08', 2, true from grupos_categoria_papel p where p.nome = 'Bezerros Mamando'
  union all
  select new.id, 'Novilha 08 a 12 Meses', p.id, 'FEMEA'::sexo_categoria, '08-12', 3, true from grupos_categoria_papel p where p.nome = 'Novilhas'
  union all
  select new.id, 'Novilha 12 a 24 Meses', p.id, 'FEMEA'::sexo_categoria, '12-24', 4, true from grupos_categoria_papel p where p.nome = 'Novilhas'
  union all
  select new.id, 'Novilha 24 a 36 Meses', p.id, 'FEMEA'::sexo_categoria, '24-36', 5, true from grupos_categoria_papel p where p.nome = 'Novilhas'
  union all
  select new.id, 'Garrote 08 a 12 Meses', p.id, 'MACHO'::sexo_categoria, '08-12', 6, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
  union all
  select new.id, 'Garrote 12 a 24 Meses', p.id, 'MACHO'::sexo_categoria, '12-24', 7, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
  union all
  select new.id, 'Boi 24 a 36 Meses', p.id, 'MACHO'::sexo_categoria, '24-36', 8, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
  union all
  select new.id, 'Boi +36 Meses', p.id, 'MACHO'::sexo_categoria, '36+', 9, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
  union all
  select new.id, 'Vaca +36 Meses', p.id, 'FEMEA'::sexo_categoria, '36+', 10, true from grupos_categoria_papel p where p.nome = 'Matrizes em Reprodução'
  union all
  select new.id, 'Touro', p.id, 'MACHO'::sexo_categoria, '36+', 11, true from grupos_categoria_papel p where p.nome = 'Touros';

  insert into subtipos_uso_area (conta_id, tipo_uso_id, nome, sistema, ordem)
  select new.id, id, 'Geral', true, 0 from tipos_uso_area;

  insert into subtipos_uso_area (conta_id, tipo_uso_id, nome, ordem)
  select new.id, t.id, s.nome, s.ordem
  from tipos_uso_area t
  cross join (values
    ('Corte', 1), ('Leite', 2), ('Ovinocultura', 3), ('Haras', 4)
  ) as s(nome, ordem)
  where t.nome = 'Pecuária';

  insert into subtipos_uso_area (conta_id, tipo_uso_id, nome, ordem)
  select new.id, t.id, s.nome, s.ordem
  from tipos_uso_area t
  cross join (values
    ('Soja', 1), ('Milho', 2), ('Cana-de-açúcar', 3), ('Café', 4)
  ) as s(nome, ordem)
  where t.nome = 'Agricultura';

  return new;
end;
$$ language plpgsql;

create trigger trg_seed_categorias_subtipos_conta
after insert on contas
for each row execute function fn_seed_categorias_subtipos_conta();
