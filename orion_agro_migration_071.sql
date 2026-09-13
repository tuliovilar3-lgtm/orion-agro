-- Migração 071: renomeia o Grupo Categoria "Touros" pra "Reprodutores" +
-- trava era 00-08 só pros papéis Bezerro/Bezerra Mamando
--
-- Pedido do usuário: (1) o cadastro de categoria deixava escolher era
-- "00-08" pra qualquer Grupo Categoria (ex.: Garrotes e Bois), quando essa
-- era deveria ser exclusiva de Bezerros/Bezerras Mamando — a trigger já
-- FORÇAVA 00-08 nesses dois papéis, mas nunca REJEITAVA 00-08 nos demais.
-- (2) renomear o Grupo Categoria "Touros" pra "Reprodutores" (rótulo mais
-- genérico — cobre reprodutor jovem também, não só o adulto).

-- 1) rename do papel — catálogo global (grupos_categoria_papel não tem
-- conta_id, compartilhado por todas as contas), então isso vale pra
-- qualquer conta de uma vez só, sem precisar de backfill por conta.
update grupos_categoria_papel set nome = 'Reprodutores' where nome = 'Touros';

-- 2) fn_seed_categorias_subtipos_conta (toda conta NOVA daqui pra frente)
-- precisa apontar pro nome novo do papel, senão a categoria-sistema
-- "Touro" simplesmente não seria criada pra nenhuma conta futura (o
-- `where p.nome = 'Touros'` não bateria com nada e a linha inteira do
-- union all seria descartada silenciosamente).
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
  select new.id, 'Touro', p.id, 'MACHO'::sexo_categoria, '36+', 11, true from grupos_categoria_papel p where p.nome = 'Reprodutores';

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

-- 3) era '00-08' passa a ser rejeitada pra qualquer papel que não seja
-- Bezerro/Bezerra Mamando — antes a trigger só forçava 00-08 nesses dois
-- papéis, mas nunca impedia os outros de usá-la também.
create or replace function fn_calcular_atributos_categoria()
returns trigger as $$
declare
  v_papel_nome text;
  v_papel_sexo sexo_categoria;
  v_grupo_faixa_nome text;
begin
  if new.grupo_categoria_papel_id is null then
    raise exception 'Selecione o Grupo Categoria.';
  end if;

  select nome, sexo into v_papel_nome, v_papel_sexo
  from grupos_categoria_papel where id = new.grupo_categoria_papel_id;

  if v_papel_sexo is not null then
    new.sexo := v_papel_sexo;
  elsif new.sexo is null then
    raise exception 'Selecione o sexo da categoria (obrigatório para o Grupo Categoria "Outros").';
  end if;

  if v_papel_nome in ('Bezerros Mamando', 'Bezerras Mamando') then
    new.era := '00-08';
  end if;

  if new.era is null then
    raise exception 'Selecione a era da categoria.';
  end if;

  if new.era = '00-08' and v_papel_nome not in ('Bezerros Mamando', 'Bezerras Mamando') then
    raise exception 'A era 00-08 é exclusiva dos Grupos Categoria "Bezerros Mamando"/"Bezerras Mamando".';
  end if;

  v_grupo_faixa_nome := case new.era
    when '00-08' then 'BEZERRO'
    when '08-12' then 'JOVEM'
    when '12-24' then 'JOVEM'
    when '24-36' then 'ADULTO'
    when '36+' then 'ADULTO'
  end;

  select id into new.grupo_id from grupos_categoria where nome = v_grupo_faixa_nome;

  return new;
end;
$$ language plpgsql;
