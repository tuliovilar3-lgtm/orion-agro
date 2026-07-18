-- =====================================================================
-- ORION AGRO — Migração 028
--
-- Peso médio passa a ser obrigatório em (quase) toda movimentação, não
-- só em desmame/venda abate/saldo inicial — e passa a "compilar"
-- automaticamente em Pesagens, virando a fonte única de peso mais
-- recente por fazenda+categoria+pasto, usada em relatórios.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Peso médio obrigatório em toda movimentação, exceto Mudança de
-- Pasto (que tem peso opcional — se não informado, o lote continua com
-- o último peso conhecido). Constraint adicionada NOT VALID: não
-- quebra os lançamentos antigos sem peso já existentes (a maioria é
-- Mudança de Pasto, mas há 1 Nascimento e 1 Compra legados sem peso) —
-- só passa a valer pra inserts/updates novos a partir de agora. Se um
-- desses lançamentos antigos for editado, o peso passa a ser exigido
-- nesse momento.
-- ---------------------------------------------------------------------

alter table movimentacoes_rebanho
  drop constraint ck_peso_medio_obrigatorio_saldo_inicial;

alter table movimentacoes_rebanho
  add constraint ck_peso_medio_obrigatorio check (
    tipo = 'MUDANCA_PASTO' or peso_medio_kg is not null
  ) not valid;

-- ---------------------------------------------------------------------
-- 2) peso_total_kg passa a ser sempre derivado de peso_medio_kg ×
-- quantidade, pra todo tipo de movimentação — antes só os tipos
-- comerciais/transferência calculavam isso (fn_calcular_valores_movimentacao),
-- e Mudança de Categoria tinha um campo "Peso total" digitado à mão,
-- sem relação garantida com o peso médio. Esse trigger roda ANTES de
-- fn_calcular_valores_movimentacao (ordem alfabética do nome do
-- trigger: "calcular_peso_total" vem antes de "calcular_valores"), já
-- que esse último usa peso_total_kg como entrada pro cálculo de
-- arroba/valor.
-- ---------------------------------------------------------------------

create or replace function fn_calcular_peso_total_movimentacao()
returns trigger as $$
begin
  if new.peso_medio_kg is not null and new.quantidade is not null then
    new.peso_total_kg := round(new.peso_medio_kg * new.quantidade, 2);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_calcular_peso_total
before insert or update on movimentacoes_rebanho
for each row execute function fn_calcular_peso_total_movimentacao();

-- ---------------------------------------------------------------------
-- 3) Compilação automática em Pesagens: toda movimentação salva com
-- peso_medio_kg cria/atualiza um registro em pesagens, ligado por
-- movimentacao_id (nulo pras pesagens lançadas manualmente na tela de
-- Pesagens). Fazenda/categoria/pasto usados são sempre os de "destino"
-- quando existem (coalesce), senão os campos únicos — cobre todos os
-- tipos corretamente sem precisar de lógica por tipo:
--   NASCIMENTO/MORTE/COMPRA/VENDA_PE/VENDA_ABATE/CONSUMO_DOACAO/
--   SALDO_INICIAL: só fazenda_id/categoria_id/pasto_id (sem destino)
--   MUDANCA_CATEGORIA/DESMAME: categoria_destino_id (nova categoria),
--   mesma fazenda/pasto
--   TRANSFERENCIA: fazenda_destino_id + pasto_destino_id (onde os
--   animais ficam), mesma categoria
--   MUDANCA_PASTO: pasto_destino_id (novo pasto), mesma fazenda/categoria
-- on delete cascade na FK cuida da limpeza quando a movimentação é
-- apagada; o UPDATE do trigger cobre edição (inclusive apagar o peso
-- de uma Mudança de Pasto, que remove o registro compilado).
-- ---------------------------------------------------------------------

alter table pesagens
  add column movimentacao_id uuid references movimentacoes_rebanho(id) on delete cascade,
  add constraint uq_pesagens_movimentacao unique (movimentacao_id);

create or replace function fn_compilar_pesagem_movimentacao()
returns trigger as $$
declare
  v_fazenda_id   uuid;
  v_categoria_id uuid;
  v_pasto_id     uuid;
begin
  v_fazenda_id := coalesce(new.fazenda_destino_id, new.fazenda_id);
  v_categoria_id := coalesce(new.categoria_destino_id, new.categoria_id);
  v_pasto_id := coalesce(new.pasto_destino_id, new.pasto_id);

  if new.peso_medio_kg is not null and new.peso_medio_kg > 0 then
    insert into pesagens (fazenda_id, categoria_id, pasto_id, data, peso_medio_kg, movimentacao_id, observacao)
    values (v_fazenda_id, v_categoria_id, v_pasto_id, new.data, new.peso_medio_kg, new.id,
            'Peso compilado automaticamente da movimentação')
    on conflict (movimentacao_id) do update set
      fazenda_id = excluded.fazenda_id,
      categoria_id = excluded.categoria_id,
      pasto_id = excluded.pasto_id,
      data = excluded.data,
      peso_medio_kg = excluded.peso_medio_kg;
  else
    delete from pesagens where movimentacao_id = new.id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_compilar_pesagem_movimentacao
after insert or update on movimentacoes_rebanho
for each row execute function fn_compilar_pesagem_movimentacao();

-- pesagem compilada automaticamente só pode ser removida editando ou
-- apagando a movimentação de origem — excluir direto na tela de
-- Pesagens deixaria a movimentação e o peso dessincronizados até a
-- próxima edição dela.
create or replace function fn_validar_delete_pesagem()
returns trigger as $$
begin
  if old.movimentacao_id is not null then
    raise exception 'Esse peso foi registrado automaticamente por uma movimentação — edite ou exclua a movimentação para alterá-lo.';
  end if;
  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_pesagem
before delete on pesagens
for each row execute function fn_validar_delete_pesagem();

-- =====================================================================
-- FIM DA MIGRAÇÃO 028
-- =====================================================================
