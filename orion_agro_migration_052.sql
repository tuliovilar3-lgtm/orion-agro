-- =====================================================================
-- ORION AGRO — Migração 052
--
-- Conversão pasto ↔ talhão (ILP — Integração Lavoura-Pecuária). Até
-- aqui `modulos.tipo_utilizacao` só aceitava 'PECUARIA' por constraint,
-- mesmo o enum já tendo 'AGRICULTURA' reservado desde a criação da
-- tabela ("AGRICULTURA fica reservado no enum pra não precisar de
-- migração de schema quando talhão for implementado"). Esta migração
-- libera esse segundo tipo e adiciona o mecanismo de conversão em si.
--
-- Nomes default do módulo/pasto "Geral" auto-criado por fazenda nova
-- também mudam (pedido do usuário, "pra ficar mais intuitivo no
-- momento de cadastrar"): o par PECUARIA passa a se chamar "Módulo 1"/
-- "Pasto 1" (era "Geral"/"Geral"); o par novo AGRICULTURA se chama
-- "Geral (Agricultura)"/"Talhão 1". Os dois continuam sistema=true
-- (protegidos contra exclusão, mas sempre renomeáveis — a proteção não
-- depende do nome). Só vale pra fazenda nova; fazendas já existentes
-- mantêm "Geral"/"Geral" como está, sem rename retroativo.
--
-- Escopo confirmado com o usuário durante o desenho: só o mecanismo de
-- conversão pasto↔talhão é construído agora — nenhuma tela própria de
-- agricultura (safra/cultura, cadastro de talhão dedicado) nem
-- histórico por polígono além do que movimentacoes_area já registra
-- como ledger.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Libera AGRICULTURA em modulos.tipo_utilizacao — o enum já só
-- aceita PECUARIA/AGRICULTURA de qualquer forma, então a constraint
-- fica redundante depois de solta (sem substituir por outra).
-- ---------------------------------------------------------------------

alter table modulos drop constraint if exists ck_modulo_tipo_utilizacao;

-- ---------------------------------------------------------------------
-- 2) fn_criar_modulo_pasto_geral: novos nomes default + segundo par
-- (AGRICULTURA), pra toda fazenda nova criada a partir de agora.
-- ---------------------------------------------------------------------

create or replace function fn_criar_modulo_pasto_geral()
returns trigger as $$
declare
  v_modulo_pecuaria_id    uuid;
  v_modulo_agricultura_id uuid;
begin
  insert into modulos (fazenda_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.id, 'Módulo 1', 'PECUARIA', 0, true)
  returning id into v_modulo_pecuaria_id;

  insert into pastos (modulo_id, nome, ordem, sistema)
  values (v_modulo_pecuaria_id, 'Pasto 1', 0, true);

  insert into modulos (fazenda_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.id, 'Geral (Agricultura)', 'AGRICULTURA', 1, true)
  returning id into v_modulo_agricultura_id;

  insert into pastos (modulo_id, nome, ordem, sistema)
  values (v_modulo_agricultura_id, 'Talhão 1', 0, true);

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 3) Backfill: fazendas já existentes ganham o par AGRICULTURA que
-- nunca tiveram (idempotente — só cria se ainda não existir um módulo
-- AGRICULTURA pra essa fazenda). Não mexe no par PECUARIA "Geral"/
-- "Geral" já existente dessas fazendas. conta_id setado explicitamente
-- (a partir de fazendas.conta_id) porque este bloco roda direto no SQL
-- Editor, fora de uma sessão de app — sem auth.uid(), o default
-- `fn_conta_atual()` de modulos/pastos.conta_id resolveria null.
-- ---------------------------------------------------------------------

do $$
declare
  v_fazenda   record;
  v_modulo_id uuid;
begin
  for v_fazenda in
    select f.id, f.conta_id from fazendas f
    where not exists (
      select 1 from modulos m where m.fazenda_id = f.id and m.tipo_utilizacao = 'AGRICULTURA'
    )
  loop
    insert into modulos (conta_id, fazenda_id, nome, tipo_utilizacao, ordem, sistema)
    values (v_fazenda.conta_id, v_fazenda.id, 'Geral (Agricultura)', 'AGRICULTURA', 1, true)
    returning id into v_modulo_id;

    insert into pastos (conta_id, modulo_id, nome, ordem, sistema)
    values (v_fazenda.conta_id, v_modulo_id, 'Talhão 1', 0, true);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4) fn_validar_area_pasto fica tipo_utilizacao-aware. Antes somava
-- TODOS os pastos da fazenda contra só a área de Pecuária — bug latente
-- assim que Agricultura fosse liberada (um talhão consumiria orçamento
-- de Pecuária indevidamente). Agora soma só os pastos/talhões de
-- módulos do MESMO tipo_utilizacao do módulo do pasto sendo validado,
-- contra a área alocada nesse mesmo tipo de uso. Pra dados de hoje
-- (todo módulo é PECUARIA) o comportamento é idêntico ao anterior.
-- ---------------------------------------------------------------------

create or replace function fn_validar_area_pasto()
returns trigger as $$
declare
  v_fazenda_id    uuid;
  v_tipo_modulo   tipo_utilizacao_modulo;
  v_tipo_uso_nome text;
  v_tipo_uso_id   uuid;
  v_area_tipo_uso numeric;
  v_soma_pastos   numeric;
begin
  select m.fazenda_id, m.tipo_utilizacao into v_fazenda_id, v_tipo_modulo
  from modulos m where m.id = new.modulo_id;

  v_tipo_uso_nome := case v_tipo_modulo when 'PECUARIA' then 'Pecuária' else 'Agricultura' end;
  select id into v_tipo_uso_id from tipos_uso_area where nome = v_tipo_uso_nome;
  v_area_tipo_uso := fn_area_por_uso(v_fazenda_id, v_tipo_uso_id, current_date);

  select coalesce(sum(p.area_ha), 0) into v_soma_pastos
  from pastos p
  join modulos m on m.id = p.modulo_id
  where m.fazenda_id = v_fazenda_id and m.tipo_utilizacao = v_tipo_modulo and p.id <> new.id;

  v_soma_pastos := v_soma_pastos + coalesce(new.area_ha, 0);

  if v_soma_pastos > v_area_tipo_uso then
    raise exception 'A soma das áreas dos pastos/talhões de % (% ha) ultrapassaria a área alocada nesse tipo de uso (% ha).',
      v_tipo_uso_nome, v_soma_pastos, v_area_tipo_uso;
  end if;

  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 5) fn_converter_pasto_talhao: converte um pasto/talhão pra outro
-- módulo de tipo_utilizacao oposto, atomicamente — insere a
-- MUDANCA_USO correspondente (dispara fn_validar_saldo_area sozinha,
-- bloqueando se não houver área suficiente no tipo de uso de origem) e
-- só então move pastos.modulo_id. Tudo dentro da mesma função =
-- atômico: se a MUDANCA_USO for rejeitada, o pasto nunca muda de
-- módulo. security invoker (padrão do resto do schema — RLS resolve
-- conta_id sozinho via fn_conta_atual()).
-- ---------------------------------------------------------------------

create or replace function fn_converter_pasto_talhao(p_pasto_id uuid, p_modulo_destino_id uuid)
returns void
language plpgsql
as $$
declare
  v_fazenda_id                   uuid;
  v_fazenda_destino_id            uuid;
  v_modulo_origem_id              uuid;
  v_tipo_origem                   tipo_utilizacao_modulo;
  v_tipo_destino                  tipo_utilizacao_modulo;
  v_area_ha                       numeric;
  v_nome_pasto                    text;
  v_tipo_uso_pecuaria_id          uuid;
  v_tipo_uso_agricultura_id       uuid;
  v_tipo_uso_origem_id            uuid;
  v_tipo_uso_destino_id           uuid;
  v_subtipo_origem_id             uuid;
  v_subtipo_destino_id            uuid;
begin
  select p.modulo_id, p.area_ha, p.nome, m.fazenda_id, m.tipo_utilizacao
    into v_modulo_origem_id, v_area_ha, v_nome_pasto, v_fazenda_id, v_tipo_origem
  from pastos p
  join modulos m on m.id = p.modulo_id
  where p.id = p_pasto_id;

  if v_modulo_origem_id is null then
    raise exception 'Pasto não encontrado.';
  end if;

  if v_area_ha is null then
    raise exception 'Declare a área desse pasto antes de convertê-lo.';
  end if;

  select m.tipo_utilizacao, m.fazenda_id into v_tipo_destino, v_fazenda_destino_id
  from modulos m where m.id = p_modulo_destino_id;

  if v_tipo_destino is null then
    raise exception 'Módulo de destino não encontrado.';
  end if;

  if v_fazenda_destino_id <> v_fazenda_id then
    raise exception 'O módulo de destino precisa ser da mesma fazenda.';
  end if;

  if v_tipo_origem = v_tipo_destino then
    raise exception 'O módulo de destino precisa ser de um tipo de uso diferente (Pecuária ↔ Agricultura).';
  end if;

  select id into v_tipo_uso_pecuaria_id from tipos_uso_area where nome = 'Pecuária';
  select id into v_tipo_uso_agricultura_id from tipos_uso_area where nome = 'Agricultura';

  if v_tipo_origem = 'PECUARIA' then
    v_tipo_uso_origem_id := v_tipo_uso_pecuaria_id;
    v_tipo_uso_destino_id := v_tipo_uso_agricultura_id;
  else
    v_tipo_uso_origem_id := v_tipo_uso_agricultura_id;
    v_tipo_uso_destino_id := v_tipo_uso_pecuaria_id;
  end if;

  select id into v_subtipo_origem_id
    from subtipos_uso_area where tipo_uso_id = v_tipo_uso_origem_id and nome = 'Geral';
  select id into v_subtipo_destino_id
    from subtipos_uso_area where tipo_uso_id = v_tipo_uso_destino_id and nome = 'Geral';

  insert into movimentacoes_area (
    fazenda_id, tipo, data, tipo_uso_origem_id, tipo_uso_destino_id,
    subtipo_uso_origem_id, subtipo_uso_destino_id, area_ha, observacao
  ) values (
    v_fazenda_id, 'MUDANCA_USO', current_date, v_tipo_uso_origem_id, v_tipo_uso_destino_id,
    v_subtipo_origem_id, v_subtipo_destino_id, v_area_ha,
    format('Gerado automaticamente pela conversão de "%s" em %s.',
      v_nome_pasto, case when v_tipo_destino = 'AGRICULTURA' then 'talhão' else 'pasto' end)
  );

  update pastos set modulo_id = p_modulo_destino_id where id = p_pasto_id;
end;
$$;
