-- =====================================================================
-- ORION AGRO — Migração 053
--
-- Incorporar/desincorporar área: até aqui `fazendas.area_ha` só mudava
-- por edição manual no cadastro da fazenda ("Dados Cadastrais"), e
-- MUDANCA_USO só realoca área que já existe entre tipos de uso — nunca
-- muda o total. Pedido do usuário: às vezes a fazenda compra uma área
-- nova e quer incorporar ao total, ou vende um pedaço e quer retirar.
--
-- Dois tipos novos no ledger (`movimentacoes_area`), reaproveitando a
-- mesma mecânica de fn_area_por_uso/fn_validar_saldo_area já usada por
-- SALDO_INICIAL/MUDANCA_USO, sem precisar de nenhum "tipo de uso"
-- fictício (ex.: um "Fora da Fazenda" artificial) — considerado e
-- descartado: exigiria filtrar essa entrada fantasma em todo lugar que
-- lista tipos de uso (seletores, relatórios, paleta de cores), risco
-- real de vazar em algum lugar novo no futuro.
--
-- INCORPORACAO_AREA: só tipo_uso_destino_id (mesmo formato de
-- SALDO_INICIAL) — área nova entra direto num tipo de uso, sem
-- checagem de saldo (não existe "de onde" descontar).
-- DESINCORPORACAO_AREA: só tipo_uso_origem_id (espelho) — área sai de
-- um tipo de uso existente, com a mesma checagem de saldo suficiente
-- que MUDANCA_USO já tem.
--
-- As duas atualizam fazendas.area_ha automaticamente (trigger nova),
-- pra não exigir um segundo passo manual em "Dados Cadastrais" — mas o
-- campo manual continua existindo/editável pra casos que não passem
-- por esse fluxo (decisão já discutida com o usuário: caminho aditivo,
-- não substitui a edição direta).
--
-- Escopo desta rodada (decisão explícita, mesmo espírito de outras
-- fases recentes que só cobrem "criar novo"): sem "Editar"/"Excluir"
-- pra incorporação/desincorporação já lançada — só criar. A trajetória
-- de edição (fn_checar_edicao_area/fn_delta_area_para_tipo) é corrigida
-- de qualquer forma, como defesa em profundidade, pro dia em que um
-- MUDANCA_USO futuro dependa dessa área.
--
-- IMPORTANTE — rodar em duas etapas separadas: Postgres não deixa usar
-- um valor de enum novo (ALTER TYPE ... ADD VALUE) na mesma transação
-- em que ele foi criado. Selecione e rode a ETAPA 1 sozinha primeiro,
-- espere terminar, depois selecione e rode o resto (ETAPA 2 em diante).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ETAPA 1 — rodar sozinha, esperar terminar antes de continuar
-- ---------------------------------------------------------------------

alter type tipo_movimentacao_area add value if not exists 'INCORPORACAO_AREA';
alter type tipo_movimentacao_area add value if not exists 'DESINCORPORACAO_AREA';

-- ---------------------------------------------------------------------
-- ETAPA 2 — rodar depois que a ETAPA 1 já tiver sido confirmada
-- ---------------------------------------------------------------------

-- 1) tipo_uso_destino_id/subtipo_uso_destino_id passam a ser opcionais
-- — só DESINCORPORACAO_AREA vem sem destino (área saindo da fazenda,
-- sem outro tipo de uso pra receber).
alter table movimentacoes_area alter column tipo_uso_destino_id drop not null;
alter table movimentacoes_area alter column subtipo_uso_destino_id drop not null;

-- 2) constraints reescritas com os 2 branches novos — e explicitando
-- "destino not null" nos branches que antes dependiam só da coluna ser
-- NOT NULL (agora que não é mais, a constraint precisa garantir isso
-- ela mesma pros tipos que continuam exigindo destino).
alter table movimentacoes_area drop constraint ck_area_movimentacao_origem;
alter table movimentacoes_area add constraint ck_area_movimentacao_origem check (
  (tipo = 'SALDO_INICIAL' and tipo_uso_origem_id is null and tipo_uso_destino_id is not null)
  or (tipo = 'MUDANCA_USO' and tipo_uso_origem_id is not null and tipo_uso_destino_id is not null
      and tipo_uso_origem_id <> tipo_uso_destino_id)
  or (tipo = 'INCORPORACAO_AREA' and tipo_uso_origem_id is null and tipo_uso_destino_id is not null)
  or (tipo = 'DESINCORPORACAO_AREA' and tipo_uso_origem_id is not null and tipo_uso_destino_id is null)
);

alter table movimentacoes_area drop constraint ck_subtipo_area_origem;
alter table movimentacoes_area add constraint ck_subtipo_area_origem check (
  (tipo = 'SALDO_INICIAL' and subtipo_uso_origem_id is null and subtipo_uso_destino_id is not null)
  or (tipo = 'MUDANCA_USO' and subtipo_uso_origem_id is not null and subtipo_uso_destino_id is not null)
  or (tipo = 'INCORPORACAO_AREA' and subtipo_uso_origem_id is null and subtipo_uso_destino_id is not null)
  or (tipo = 'DESINCORPORACAO_AREA' and subtipo_uso_origem_id is not null and subtipo_uso_destino_id is null)
);

-- 3) fn_delta_area_para_tipo: DESINCORPORACAO_AREA também subtrai do
-- lado origem (antes só MUDANCA_USO fazia isso) — sem isso, a
-- trajetória de edição (fn_checar_edicao_area) subestimaria o quanto
-- uma desincorporação já lançada consumiu de um tipo de uso.
create or replace function fn_delta_area_para_tipo(
  p_tipo tipo_movimentacao_area,
  p_tipo_uso_origem_id uuid,
  p_tipo_uso_destino_id uuid,
  p_area_ha numeric,
  p_par_tipo_uso_id uuid
) returns numeric
language plpgsql
immutable
as $$
declare
  v_total numeric := 0;
begin
  if p_tipo_uso_destino_id = p_par_tipo_uso_id then
    v_total := v_total + p_area_ha;
  end if;
  if p_tipo in ('MUDANCA_USO', 'DESINCORPORACAO_AREA') and p_tipo_uso_origem_id = p_par_tipo_uso_id then
    v_total := v_total - p_area_ha;
  end if;
  return v_total;
end;
$$;

-- 4) fn_validar_saldo_area: DESINCORPORACAO_AREA checa saldo suficiente
-- no tipo de uso de origem, mesmo princípio de MUDANCA_USO (sem checar
-- subtipo aqui — diferente de MUDANCA_USO, não faz sentido exigir
-- "Geral" tenha saldo específico quando a área pode ter sido declarada
-- direto no tipo de uso via SALDO_INICIAL sem subtipo detalhado).
-- INCORPORACAO_AREA não tem checagem nenhuma — é sempre permitida, a
-- área nova É o novo total.
create or replace function fn_validar_saldo_area()
returns trigger as $$
declare
  v_area_disponivel         numeric;
  v_area_disponivel_subtipo numeric;
  v_area_total              numeric;
  v_area_alocada            numeric;
begin
  if new.tipo = 'MUDANCA_USO' then
    v_area_disponivel := fn_area_por_uso(new.fazenda_id, new.tipo_uso_origem_id, new.data);
    if v_area_disponivel < new.area_ha then
      raise exception 'Área insuficiente: % ha disponível(is) nesse tipo de uso na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel, new.data, new.area_ha;
    end if;

    v_area_disponivel_subtipo := fn_area_por_subtipo_uso(
      new.fazenda_id, new.tipo_uso_origem_id, new.subtipo_uso_origem_id, new.data
    );
    if v_area_disponivel_subtipo < new.area_ha then
      raise exception 'Área insuficiente nesse subtipo de uso: % ha disponível(is) na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel_subtipo, new.data, new.area_ha;
    end if;
  elsif new.tipo = 'SALDO_INICIAL' then
    select area_ha into v_area_total from fazendas where id = new.fazenda_id;
    if v_area_total is not null then
      select coalesce(sum(area_ha), 0) into v_area_alocada
        from movimentacoes_area where fazenda_id = new.fazenda_id and tipo = 'SALDO_INICIAL';
      if (v_area_alocada + new.area_ha) > v_area_total then
        raise exception 'A área total da fazenda é % ha — a soma dos tipos de uso não pode ultrapassar isso.', v_area_total;
      end if;
    end if;
  elsif new.tipo = 'DESINCORPORACAO_AREA' then
    v_area_disponivel := fn_area_por_uso(new.fazenda_id, new.tipo_uso_origem_id, new.data);
    if v_area_disponivel < new.area_ha then
      raise exception 'Área insuficiente pra desincorporar: % ha disponível(is) nesse tipo de uso na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel, new.data, new.area_ha;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

-- 5) fazendas.area_ha acompanha automaticamente — soma na incorporação,
-- subtrai na desincorporação (inclui UPDATE/DELETE por completude,
-- mesmo sem UI de editar/excluir nesta rodada — mantém o total
-- consistente mesmo se alguém corrigir um lançamento direto no banco).
create or replace function fn_atualizar_area_total_fazenda()
returns trigger as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.tipo = 'INCORPORACAO_AREA' then
      update fazendas set area_ha = coalesce(area_ha, 0) - old.area_ha where id = old.fazenda_id;
    elsif old.tipo = 'DESINCORPORACAO_AREA' then
      update fazendas set area_ha = coalesce(area_ha, 0) + old.area_ha where id = old.fazenda_id;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.tipo = 'INCORPORACAO_AREA' then
      update fazendas set area_ha = coalesce(area_ha, 0) + new.area_ha where id = new.fazenda_id;
    elsif new.tipo = 'DESINCORPORACAO_AREA' then
      update fazendas set area_ha = coalesce(area_ha, 0) - new.area_ha where id = new.fazenda_id;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_atualizar_area_total_fazenda
after insert or update or delete on movimentacoes_area
for each row execute function fn_atualizar_area_total_fazenda();
