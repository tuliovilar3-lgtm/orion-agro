-- =====================================================================
-- ORION AGRO — Schema do Módulo Pecuário
-- PostgreSQL 14+ / compatível com Supabase
-- Gerado a partir do modelo de dados discutido com base no boletim
-- mensal existente (controle de rebanho + classificação financeira)
-- =====================================================================

-- ---------------------------------------------------------------------
-- EXTENSÕES
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type papel_usuario as enum ('admin', 'gestor', 'operador');

create type tipo_movimentacao as enum (
  'NASCIMENTO',
  'DESMAME',
  'COMPRA',
  'VENDA_PE',
  'VENDA_ABATE',
  'MORTE',
  'CONSUMO_DOACAO',
  'MUDANCA_CATEGORIA',
  'TRANSFERENCIA',
  -- não aparece no formulário normal de lançamento — tem tela dedicada
  -- própria (ver seção 2c), e pode ser reaberto/reeditado mesmo depois
  -- de confirmado (respeitando a trajetória de saldo). Não existe mais
  -- um tipo "AJUSTE_ESTOQUE": corrigir no meio do período distorceria
  -- fechamentos de safra/ano, já que não seria uma movimentação real.
  'SALDO_INICIAL',
  -- move animais de um pasto pra outro sem mudar categoria (controle
  -- de rebanho por pasto — opt-in via configuracoes.controla_pasto)
  'MUDANCA_PASTO'
);

create type sexo_categoria as enum ('MACHO', 'FEMEA', 'MISTO');

-- papéis que uma pessoa/empresa pode ter (múltiplos ao mesmo tempo —
-- ver tabela pessoa_papeis; ex.: alguém pode ser Proprietário de uma
-- fazenda e também Cliente numa venda)
create type papel_pessoa as enum ('CLIENTE', 'FORNECEDOR', 'PROPRIETARIO', 'FUNCIONARIO');

create type tipo_natureza_pessoa as enum ('FISICA', 'JURIDICA');

create type sistema_produtivo_fazenda as enum
  ('CRIA', 'RECRIA', 'RECRIA_ENGORDA', 'CICLO_COMPLETO', 'AGRICULTURA');

create type tipo_lancamento_financeiro as enum ('CREDITO', 'DEBITO');

create type status_lancamento_financeiro as enum ('PENDENTE', 'CONFIRMADO');

create type criterio_rateio as enum ('POR_CABECA', 'POR_AREA', 'PERCENTUAL_FIXO');

create type subtipo_consumo_doacao as enum ('CONSUMO_INTERNO', 'DOACAO');

-- gestão de área: SALDO_INICIAL declara a área inicial de um tipo de uso
-- (sem origem); MUDANCA_USO move hectares de um tipo de uso pra outro,
-- dentro da mesma fazenda (área não "nasce" nem "morre", só realoca)
-- INCORPORACAO_AREA/DESINCORPORACAO_AREA (migração 053): área
-- comprada/vendida, muda o total da fazenda — ver comentário completo
-- junto de movimentacoes_area e fn_atualizar_area_total_fazenda abaixo.
create type tipo_movimentacao_area as enum ('SALDO_INICIAL', 'MUDANCA_USO', 'INCORPORACAO_AREA', 'DESINCORPORACAO_AREA');

-- =====================================================================
-- 1. TABELAS DE REFERÊNCIA (globais / compartilhadas entre fazendas)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Multi-tenant (migração 046) — `contas` é o tenant. Toda tabela
-- operacional abaixo ganha uma coluna `conta_id` (ver cada CREATE TABLE)
-- isolando os dados de cada cliente via RLS (policy `conta_id =
-- fn_conta_atual()`, ver fn_conta_atual logo depois de usuarios_app,
-- mais abaixo — só pode ser criada depois que usuarios_app existe).
-- Catálogos verdadeiramente globais do domínio (grupos_categoria,
-- grupos_categoria_papel, tipos_uso_area) continuam sem conta_id —
-- compartilhados entre todas as contas, nunca customizados por cliente.
-- Seed abaixo já insere uma "Conta Principal" pra poder popular o
-- restante do seed do arquivo (categorias/subtipos do sistema, cada um
-- por conta) já daqui pra frente.
-- ---------------------------------------------------------------------
create table contas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

insert into contas (nome) values ('Conta Principal');

create table fazendas (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id),
  nome            text not null,
  localizacao     text,
  area_ha         numeric(12,2),
  ativo           boolean not null default true,
  -- uma vez confirmado, os lançamentos de tipo SALDO_INICIAL dessa
  -- fazenda ficam travados (ver fn_bloquear_saldo_inicial_confirmado)
  saldo_inicial_confirmado    boolean not null default false,
  saldo_inicial_confirmado_em timestamptz,
  -- contorno da propriedade (GeoJSON, WGS84) — importado de KML, só
  -- referência visual de fundo pra desenhar os pastos por cima; nunca
  -- obrigatório
  geometria       jsonb,
  -- proprietario_id (references pessoas) é adicionado via alter table
  -- mais abaixo, depois que a tabela pessoas existe (migração 038)
  -- "Área Útil" do formulário de cadastro — número único, informativo;
  -- o detalhamento por tipo de uso continua vivendo em movimentacoes_area
  area_util_ha    numeric(12,2),
  ie              text,
  incra           text,
  numero_itr      text,
  caepf           text,
  sistema_produtivo sistema_produtivo_fazenda,
  pais            text,
  cep             text,
  endereco        text,
  numero          text,
  bairro          text,
  cidade          text,
  estado          text,
  telefone        text,
  latitude        numeric(10,7),
  longitude       numeric(10,7),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- nome único só dentro da mesma conta (duas contas diferentes podem
  -- ambas ter uma "Fazenda Teste") — antes da migração 046 era único
  -- globalmente
  constraint uq_fazendas_conta_nome unique (conta_id, nome)
);

-- configuração única por conta (não por fazenda) — hoje só
-- controla_pasto, mas é o lugar natural pra outras opções futuras que
-- valem pra todas as fazendas de uma conta de uma vez. Até a migração
-- 046 era uma linha só NO SISTEMA INTEIRO (índice único sobre uma
-- expressão constante); agora é uma linha por conta (índice único sobre
-- conta_id), auto-criada pra toda conta nova por
-- fn_criar_configuracoes_conta (ver logo depois de fn_conta_atual).
create table configuracoes (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id),
  -- opt-in: o grupo passa a poder cadastrar módulos/pastos além do
  -- "Geral" padrão em todas as fazendas. Desligado, ninguém vê essa
  -- tela — tudo é lançado no módulo/pasto "Geral", que sempre existe
  -- em toda fazenda (ver fn_criar_modulo_pasto_geral).
  controla_pasto  boolean not null default false,
  -- opt-in (migração 032): equivalente pra área — desligado, todo
  -- lançamento de área usa o subtipo "Geral" do tipo de uso, sem tela
  -- de seleção nenhuma.
  controla_subtipo_area boolean not null default false,
  -- recurso pago (Fase 2 do Financeiro, migração 056): liga quando o
  -- Suporte concede conta_recursos 'contas_a_pagar_receber' — mesmo
  -- padrão de "coluna de efeito" que controla_pasto já usa
  controla_contas_pagar_receber boolean not null default false,
  updated_at      timestamptz not null default now()
);
create unique index uq_configuracoes_conta on configuracoes (conta_id);

insert into configuracoes (conta_id, controla_pasto)
select id, false from contas limit 1;

-- ---------------------------------------------------------------------
-- Acesso e login (migração 042) — Supabase Auth
-- ---------------------------------------------------------------------
-- Nome "usuarios_app" (não "usuarios") de propósito: `usuarios` /
-- `usuario_fazenda` / `papel_usuario` logo abaixo são um rascunho do
-- schema original, anterior à decisão de usar Supabase Auth — nunca
-- tiveram nenhuma linha nem foram referenciados por código nenhum do
-- app (só colunas `created_by`/`usuario_id` nullable e nunca escritas em
-- categorias_animal/movimentacoes_rebanho/pesagens/lancamentos_financeiros).
-- Deixados como estão (dead schema inofensivo) pra não mexer em tabelas
-- de produção fora do escopo desta migração — não usar `usuarios` pra
-- nada novo.
create table usuarios_app (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  dono boolean not null default false,
  ativo boolean not null default true,
  -- CAMPO: navegação simplificada (barra de abas, sem sidebar).
  -- GESTAO: sidebar completa de sempre. CONSULTA: sidebar completa, mas
  -- só pode ter os 4 módulos de relatório liberados (migração 043) —
  -- reaproveita o mesmo mecanismo de permissão por módulo, sem
  -- bloqueio novo de "somente leitura" dentro das telas.
  modo text not null default 'GESTAO' check (modo in ('CAMPO', 'GESTAO', 'CONSULTA')),
  -- nullable de propósito (migração 046): usuário de Suporte (equipe
  -- interna do fornecedor, ver `suporte` abaixo) não pertence a nenhuma
  -- conta de cliente. Sem valor padrão automático (default
  -- fn_conta_atual()) — os dois Route Handlers que criam usuário usam o
  -- cliente admin/service-role, que bypassa RLS e precisa passar
  -- conta_id explicitamente.
  conta_id uuid references contas(id),
  -- equipe interna do fornecedor (Suporte técnico) — acessa qualquer
  -- conta de cliente pra dar suporte. Só a coluna por enquanto: o
  -- seletor de conta e o bypass de RLS pra quem tem suporte = true são
  -- Fase 4 (ainda não implementada) do roadmap multi-tenant.
  suporte boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table usuarios_app is
  'Dados de app por usuário autenticado (auth.users é só identidade/senha). Um dono por grupo — os demais são funcionários com módulos liberados individualmente.';

-- ---------------------------------------------------------------------
-- Papel de Suporte (migração 048, Fase 4 do multi-tenant) — em qual
-- conta um usuário de suporte está navegando agora. Uma linha por
-- usuário de suporte (chave primária = usuario_id): "entrar" numa
-- conta faz upsert, "sair" apaga a linha. Preferida a uma variável de
-- sessão do Postgres porque o Supabase usa pool de conexões — uma
-- session var não sobreviveria de forma confiável entre requisições.
-- Precisa existir antes de fn_conta_atual() (definida logo abaixo),
-- que passa a consultar esta tabela.
-- ---------------------------------------------------------------------
create table suporte_conta_ativa (
  usuario_id uuid primary key references usuarios_app(id) on delete cascade,
  conta_id   uuid not null references contas(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- só o próprio usuário de suporte lê/altera sua própria linha
alter table suporte_conta_ativa enable row level security;
create policy suporte_conta_ativa_propria on suporte_conta_ativa for all
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- defesa em profundidade: garante que só usuário com suporte = true
-- pode ganhar uma linha aqui, mesmo que a policy de RLS acima seja
-- respeitada (ela só garante "é o próprio usuário", não "é suporte")
create or replace function fn_validar_suporte_conta_ativa()
returns trigger as $$
begin
  if not exists (select 1 from usuarios_app where id = new.usuario_id and suporte = true) then
    raise exception 'Só um usuário de suporte pode navegar em outra conta.';
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_validar_suporte_conta_ativa
before insert or update on suporte_conta_ativa
for each row execute function fn_validar_suporte_conta_ativa();

-- suporte_auditoria — log append-only de quem entrou/saiu de qual
-- conta e quando. Populado só pela trigger abaixo (nunca por código do
-- app diretamente) — sem policy permissiva pra ninguém autenticado, só
-- a função security definer consegue inserir.
create table suporte_auditoria (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios_app(id),
  conta_id   uuid not null references contas(id),
  acao       text not null check (acao in ('ENTROU', 'SAIU')),
  created_at timestamptz not null default now()
);

alter table suporte_auditoria enable row level security;
-- nenhuma policy permissiva: ninguém lê/escreve direto por aqui, só a
-- trigger abaixo (security definer) consegue inserir

create or replace function fn_registrar_auditoria_suporte()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    insert into suporte_auditoria (usuario_id, conta_id, acao) values (new.usuario_id, new.conta_id, 'ENTROU');
  elsif tg_op = 'UPDATE' then
    if new.conta_id <> old.conta_id then
      insert into suporte_auditoria (usuario_id, conta_id, acao) values (old.usuario_id, old.conta_id, 'SAIU');
      insert into suporte_auditoria (usuario_id, conta_id, acao) values (new.usuario_id, new.conta_id, 'ENTROU');
    end if;
  elsif tg_op = 'DELETE' then
    insert into suporte_auditoria (usuario_id, conta_id, acao) values (old.usuario_id, old.conta_id, 'SAIU');
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_registrar_auditoria_suporte
after insert or update or delete on suporte_conta_ativa
for each row execute function fn_registrar_auditoria_suporte();

-- ---------------------------------------------------------------------
-- fn_conta_atual() (migração 046, atualizada na migração 048) —
-- resolve a conta do usuário autenticado. Usada tanto como DEFAULT
-- automático de conta_id em toda tabela abaixo (uma linha nova criada
-- sem informar conta_id herda a do usuário logado sozinha, sem o app
-- precisar mencionar essa coluna) quanto nas policies de RLS logo a
-- seguir. Só pode ser criada aqui, depois que usuarios_app e
-- suporte_conta_ativa já existem (a função consulta as duas).
--
-- Checa suporte_conta_ativa primeiro (só vale quando o usuário é
-- suporte); sem linha ativa lá, cai pro conta_id próprio de sempre.
-- Cobre os 3 casos: usuário comum (sempre usa o próprio conta_id),
-- usuário de suporte "em casa" (mesma coisa, sem nenhuma mudança de
-- comportamento), usuário de suporte navegando numa conta de cliente
-- (usa a conta selecionada).
--
-- security definer + search_path fixo: evita recursão de RLS — a
-- própria policy de usuarios_app (mais abaixo) também chama essa
-- função, e sem security definer a consulta interna a usuarios_app
-- disparia a própria RLS de novo, num ciclo. Bypassa RLS só nessa
-- consulta interna específica, nunca expõe dado além da conta do
-- próprio usuário que está chamando.
-- ---------------------------------------------------------------------
create or replace function fn_conta_atual()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select sca.conta_id
      from suporte_conta_ativa sca
      join usuarios_app u on u.id = sca.usuario_id
      where u.id = auth.uid() and u.suporte = true
    ),
    (select conta_id from usuarios_app where id = auth.uid())
  );
$$;

-- fazendas e configuracoes são definidas mais acima no arquivo (antes
-- de usuarios_app/fn_conta_atual existirem), então não puderam ganhar
-- "default fn_conta_atual()" direto na própria CREATE TABLE — setado só
-- agora.
alter table fazendas alter column conta_id set default fn_conta_atual();
alter table configuracoes alter column conta_id set default fn_conta_atual();

-- toda conta nova ganha uma linha em configuracoes sozinha — mesmo
-- princípio já usado pro módulo/pasto "Geral" de toda fazenda nova
-- (fn_criar_modulo_pasto_geral). Não dispara pra "Conta Principal"
-- (inserida lá em cima, antes desta trigger existir) — ela já ganhou
-- sua linha de configuracoes por um insert explícito, evitando duas
-- linhas pra mesma conta batendo na uq_configuracoes_conta.
create or replace function fn_criar_configuracoes_conta()
returns trigger as $$
begin
  insert into configuracoes (conta_id, controla_pasto) values (new.id, false);
  return new;
end;
$$ language plpgsql;

create trigger trg_criar_configuracoes_conta
after insert on contas
for each row execute function fn_criar_configuracoes_conta();

-- toda conta nova também ganha as 11 categorias-sistema e os subtipos
-- de uso de área (migração 049) — mesmo princípio da trigger acima,
-- espelhando o bloco de seed manual usado mais abaixo neste arquivo só
-- pra "Conta Principal" (que, pelo mesmo motivo de ordem, também não
-- dispara esta trigger — foi inserida antes dela existir).
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

-- ---------------------------------------------------------------------
-- RLS (migração 046) — reativado (estava desligado de propósito desde a
-- migração 042, documentado como "passo futuro"; a decisão de
-- produtizar multi-tenant torna isso pré-requisito, não mais opcional).
-- Uma policy por tabela: só enxerga/altera linhas da própria conta.
-- `contas` compara contra o próprio id da linha (id = fn_conta_atual()),
-- não uma coluna conta_id — todas as outras tabelas usam
-- `conta_id = fn_conta_atual()`. Nenhuma das ~30 funções/triggers do
-- resto do arquivo usa `security definer`, então todas já respeitam RLS
-- automaticamente (rodam como SECURITY INVOKER, com o privilégio de
-- quem chamou) — não precisaram de nenhum ajuste por causa disso.
-- ---------------------------------------------------------------------
alter table contas enable row level security;
create policy contas_por_conta on contas for all
  using (id = fn_conta_atual()) with check (id = fn_conta_atual());

-- migração 048: suporte precisa enxergar TODAS as contas (pra montar o
-- seletor), não só a própria. Policy adicional de SELECT (soma com a
-- de cima via OR) — não afeta INSERT/UPDATE/DELETE, que continuam
-- restritos pela policy original (onboarding de conta nova é fora do
-- escopo desta fase).
create policy contas_visivel_suporte on contas for select
  using (exists (select 1 from usuarios_app where id = auth.uid() and suporte = true));

alter table fazendas enable row level security;
create policy fazendas_por_conta on fazendas for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

alter table configuracoes enable row level security;
create policy configuracoes_por_conta on configuracoes for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- migração 048: um usuário de suporte precisa continuar enxergando o
-- PRÓPRIO perfil mesmo enquanto está navegando em outra conta
-- (fn_conta_atual() aponta pra conta selecionada nesse momento, não
-- mais pro conta_id próprio do usuário) — sem o "id = auth.uid()", o
-- carregamento de sessão quebraria assim que o modo suporte fosse
-- ativado. Pra um usuário comum isso não muda nada (as duas metades
-- da condição já apontavam pra mesma linha).
alter table usuarios_app enable row level security;
create policy usuarios_app_por_conta on usuarios_app for all
  using (id = auth.uid() or conta_id = fn_conta_atual())
  with check (id = auth.uid() or conta_id = fn_conta_atual());

-- catálogo de módulos é só uma convenção de string usada pelo frontend
-- (mesmos ids de rota já usados na Sidebar) — sem tabela de módulos
-- própria, igual o modelo já decidido dispensa tabela de perfis
create table usuario_modulos (
  usuario_id uuid not null references usuarios_app(id) on delete cascade,
  modulo text not null,
  conta_id uuid not null references contas(id) default fn_conta_atual(),
  primary key (usuario_id, modulo)
);
alter table usuario_modulos enable row level security;
create policy usuario_modulos_por_conta on usuario_modulos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

comment on table usuario_modulos is
  'Um módulo liberado por linha, por usuário — sem perfis/papéis nomeados (decisão em memória permission_model_design). Dono não precisa de linhas aqui: bypassa a checagem inteira.';

-- ---------------------------------------------------------------------
-- Módulos de domínio, recursos e limites por conta (migração 047, Fase
-- 2 do multi-tenant; conta_modulos reinterpretada de tela pra domínio,
-- e conta_recursos criada, na migração 050) — conta_modulos é a fonte
-- da verdade de quais DOMÍNIOS (Pecuária, Agricultura, Máquinas,
-- Clima, Financeiro — lib/modulos.ts) uma conta contratou (vendidos
-- avulsos, não por plano fixo). conta_recursos é o segundo eixo: flags
-- independentes, combináveis livremente, contratadas por dentro de um
-- domínio já ativo (ex.: "controle por pasto" dentro de Pecuária —
-- lib/conta-recursos.ts). conta_limites é genérica pra limites
-- numéricos que não são "tela que aparece/some" (Multifazendas,
-- Multiproprietário, e outros limites futuros sem precisar de
-- migração de schema nova). Permissão final de uma TELA é checada só
-- no frontend (AuthContext.podeAcessar): o domínio dela precisa estar
-- em conta_modulos, E (dono OU a tela específica em usuario_modulos)
-- — mesmo o dono da conta não vê tela de um domínio que a própria
-- conta não contratou. Ausência de linha em conta_limites pra um
-- tipo_limite = sem limite (ilimitado); ausência de linha em
-- conta_recursos = recurso não contratado.
-- ---------------------------------------------------------------------
create table conta_modulos (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  dominio    text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_conta_modulo unique (conta_id, dominio)
);
alter table conta_modulos enable row level security;
create policy conta_modulos_por_conta on conta_modulos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table conta_recursos (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  dominio    text not null,
  recurso    text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_conta_recurso unique (conta_id, dominio, recurso)
);
alter table conta_recursos enable row level security;
create policy conta_recursos_por_conta on conta_recursos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table conta_limites (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references contas(id) default fn_conta_atual(),
  tipo_limite text not null,
  valor       int not null check (valor >= 0),
  created_at  timestamptz not null default now(),
  constraint uq_conta_limite unique (conta_id, tipo_limite)
);
alter table conta_limites enable row level security;
create policy conta_limites_por_conta on conta_limites for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- seed: "Conta Principal" ganha o domínio Pecuária liberado —
-- grandfather clause só pra esta conta específica, que já usava o
-- sistema inteiro antes de módulos por plano existirem. Contas novas
-- nascem sem nenhuma linha aqui — domínio vendido avulso precisa ser
-- atribuído explicitamente (via onboarding de Suporte).
insert into conta_modulos (conta_id, dominio)
select id, 'pecuaria' from contas where nome = 'Conta Principal';

-- usada pelo /login (com a chave anônima, antes de qualquer sessão
-- existir) pra decidir entre mostrar o formulário normal de entrar ou o
-- formulário único de "criar conta de dono" — só retorna um boolean,
-- sem expor nenhum dado, então é seguro chamar sem autenticação.
-- security definer + search_path fixo (migração 048b, hotfix): sem
-- isso, um visitante anônimo (sem sessão nenhuma) não enxerga nenhuma
-- linha de usuarios_app sob RLS (auth.uid() é null pra ele), e a
-- função sempre retornaria false mesmo já existindo um administrador
-- — a própria razão de existir desta função (ser chamada ANTES de
-- qualquer sessão) só funciona bypassando RLS aqui, igual já feito em
-- fn_conta_atual().
create or replace function fn_existe_dono()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from usuarios_app where dono = true);
$$;

-- ---------------------------------------------------------------------
-- Rascunho original não utilizado — ver comentário acima
-- ---------------------------------------------------------------------
create table usuarios (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  email           text not null unique,
  papel           papel_usuario not null default 'operador',
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);

create table usuario_fazenda (
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  fazenda_id      uuid not null references fazendas(id) on delete cascade,
  primary key (usuario_id, fazenda_id)
);

create table grupos_categoria (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,  -- ex: BEZERRO, JOVEM, ADULTO (Grupo Faixa Etária)
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);

-- "Grupo Categoria" — papel zootécnico do animal (ex: Novilhas, Touros).
-- Mais granular que grupos_categoria (Grupo Faixa Etária) e determina o
-- sexo da categoria: toda categoria criada com um papel de sexo fixo
-- herda esse sexo automaticamente (ver fn_calcular_atributos_categoria).
-- 'Outros' é o único papel com sexo livre (sexo null aqui).
create table grupos_categoria_papel (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  sexo            sexo_categoria,
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);
-- projetos Supabase mais novos ativam RLS por padrão em tabela criada
-- via SQL editor — o resto do projeto não usa RLS ainda (sem login),
-- então desativa aqui pra manter consistência com as demais tabelas.
alter table grupos_categoria_papel disable row level security;

create table categorias_animal (
  id                     uuid primary key default gen_random_uuid(),
  conta_id               uuid not null references contas(id) default fn_conta_atual(),
  nome                   text not null,
  -- grupo e sexo são obrigatórios: alimentam relatórios futuros e a
  -- filtragem de categorias válidas por tipo de movimentação (ex: só
  -- bezerro em NASCIMENTO), então não podem ficar em branco. grupo_id
  -- (Grupo Faixa Etária) é preenchido automaticamente a partir da era
  -- pela trigger fn_calcular_atributos_categoria — não é mais escolhido
  -- diretamente no formulário de cadastro.
  grupo_id               uuid not null references grupos_categoria(id),
  grupo_categoria_papel_id uuid references grupos_categoria_papel(id),
  sexo                   sexo_categoria not null,
  -- faixa etária específica da categoria (00-08, 08-12, 12-24, 24-36,
  -- 36+) — trava em 00-08 para os papéis "Bezerros/Bezerras Mamando".
  -- Determina grupo_id automaticamente (00-08→BEZERRO, 08-12/12-24→
  -- JOVEM, 24-36/36+→ADULTO).
  era                    text check (era in ('00-08', '08-12', '12-24', '24-36', '36+')),
  idade_min_meses        int,
  idade_max_meses        int,
  peso_referencia_kg     numeric(10,2),
  ordem_ciclo            int not null default 0,
  -- null = categoria global (padrão, disponível para todas as fazendas)
  -- preenchido = categoria exclusiva de uma fazenda específica
  fazenda_id             uuid references fazendas(id),
  ativa                  boolean not null default true,
  -- categorias do sistema (pré-cadastradas) não podem ser renomeadas,
  -- reclassificadas nem excluídas — só o peso de referência e o status
  -- ativa/inativa continuam livres (ver fn_validar_edicao_categoria e
  -- fn_validar_delete_categoria)
  sistema                boolean not null default false,
  created_by             uuid references usuarios(id),
  created_at             timestamptz not null default now(),
  constraint uq_categoria_nome_fazenda unique (nome, fazenda_id),
  constraint ck_idade_range check (
    idade_min_meses is null or idade_max_meses is null
    or idade_min_meses <= idade_max_meses
  ),
  -- regra de negócio: toda categoria é MACHO ou FEMEA, nunca MISTO.
  -- 'MISTO' continua existindo no enum sexo_categoria (não vale a pena
  -- a cirurgia de remover um valor de enum em produção), mas fica
  -- bloqueado aqui.
  constraint ck_sexo_categoria_obrigatorio check (sexo in ('MACHO', 'FEMEA'))
);

create index idx_categorias_fazenda on categorias_animal(fazenda_id);
create index idx_categorias_ativa on categorias_animal(ativa);
alter table categorias_animal enable row level security;
create policy categorias_animal_por_conta on categorias_animal for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- ---------------------------------------------------------------------
-- TRIGGER: deriva automaticamente sexo (pelo Grupo Categoria/papel) e
-- grupo_id/Grupo Faixa Etária (pela era) de toda categoria criada ou
-- editada. Trava era em '00-08' para os papéis de bezerro mamando.
-- 'Outros' é o único papel com sexo livre — obrigatório informar nesse
-- caso.
-- ---------------------------------------------------------------------

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

create trigger trg_calcular_atributos_categoria
before insert or update on categorias_animal
for each row execute function fn_calcular_atributos_categoria();

-- ---------------------------------------------------------------------
-- TRIGGER: categoria do sistema (sistema = true) não pode ter nome,
-- Grupo Categoria, sexo, era ou Grupo Faixa Etária alterados — só peso
-- de referência e o status ativa/inativa continuam livres.
-- ---------------------------------------------------------------------

create or replace function fn_validar_edicao_categoria()
returns trigger as $$
begin
  if old.sistema and (
    new.nome is distinct from old.nome or
    new.grupo_categoria_papel_id is distinct from old.grupo_categoria_papel_id or
    new.sexo is distinct from old.sexo or
    new.era is distinct from old.era or
    new.grupo_id is distinct from old.grupo_id or
    new.sistema is distinct from old.sistema
  ) then
    raise exception 'Categorias do sistema não podem ser editadas — só peso de referência e status ativa/inativa.';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_edicao_categoria
before update on categorias_animal
for each row execute function fn_validar_edicao_categoria();

-- ---------------------------------------------------------------------
-- TRIGGER: categoria do sistema nunca pode ser excluída. Categoria
-- criada pelo usuário só pode ser excluída se não tiver nenhuma
-- movimentação lançada (como categoria de origem ou destino).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_categoria()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'Categorias do sistema não podem ser excluídas.';
  end if;

  if exists (
    select 1 from movimentacoes_rebanho
    where categoria_id = old.id or categoria_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: essa categoria já tem movimentações lançadas. Inative-a em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_categoria
before delete on categorias_animal
for each row execute function fn_validar_delete_categoria();

-- ---------------------------------------------------------------------
-- fn_categoria_e_bezerro: true se a categoria tem o papel Bezerro/
-- Bezerra Mamando (grupos_categoria_papel.nome) — helper reaproveitado
-- pelas triggers de lote de nascimento (migração 030).
-- ---------------------------------------------------------------------

create or replace function fn_categoria_e_bezerro(p_categoria_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from categorias_animal c
    join grupos_categoria_papel g on g.id = c.grupo_categoria_papel_id
    where c.id = p_categoria_id
      and g.nome in ('Bezerros Mamando', 'Bezerras Mamando')
  );
$$;

-- generalização de clientes/fornecedores (migração 038): pessoa física
-- ou jurídica que pode ter mais de um papel ao mesmo tempo (ex.:
-- Proprietário de uma fazenda e também Cliente numa venda) — ver
-- pessoa_papeis logo abaixo, em vez de um enum de tipo único
create table pessoas (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references contas(id) default fn_conta_atual(),
  nome                  text not null,
  documento             text,   -- CPF/CNPJ
  ativo                 boolean not null default true,
  tipo_pessoa           tipo_natureza_pessoa not null default 'FISICA',
  rg                    text,
  inscricao_estadual    text,
  inscricao_municipal   text,
  nome_contato          text,
  nacionalidade         text default 'Brasil',
  cep                   text,
  endereco              text,
  numero                text,
  bairro                text,
  cidade                text,
  estado                text,
  pais                  text default 'Brasil',
  telefone              text,
  celular               text,
  email                 text,
  observacoes           text,
  created_at            timestamptz not null default now()
);

-- nome NÃO é unique aqui de propósito: duas pessoas/empresas diferentes
-- podem legitimamente ter o mesmo nome. O identificador real é o
-- documento (CPF/CNPJ), então a proteção contra duplicidade vai nele.
-- Índice parcial (ignora nulos) porque nem todo cadastro terá documento
-- preenchido no momento do lançamento.
create unique index uq_pessoa_documento
  on pessoas (documento)
  where documento is not null;
alter table pessoas enable row level security;
create policy pessoas_por_conta on pessoas for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table pessoa_papeis (
  id          uuid primary key default gen_random_uuid(),
  pessoa_id   uuid not null references pessoas(id),
  papel       papel_pessoa not null,
  conta_id    uuid not null references contas(id) default fn_conta_atual(),
  constraint uq_pessoa_papel unique (pessoa_id, papel)
);
alter table pessoa_papeis enable row level security;
create policy pessoa_papeis_por_conta on pessoa_papeis for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- Exclusão de pessoa: só permitida se não estiver referenciada em
-- nenhuma movimentação (cliente/fornecedor) nem como proprietário de
-- fazenda. Passando essa checagem, apaga os pessoa_papeis dela junto
-- (mesmo princípio de cascata via trigger já usado em fn_validar_delete_fazenda).
create or replace function fn_validar_delete_pessoa()
returns trigger as $$
begin
  if exists (select 1 from movimentacoes_rebanho where cliente_fornecedor_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa já está referenciada em movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from movimentacoes_rebanho where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de gado em uma ou mais movimentações. Inative-a em vez disso.';
  end if;

  if exists (select 1 from fazendas where proprietario_id = old.id) then
    raise exception 'Não é possível excluir: essa pessoa é proprietária de uma fazenda. Inative-a em vez disso.';
  end if;

  delete from pessoa_papeis where pessoa_id = old.id;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_pessoa
before delete on pessoas
for each row execute function fn_validar_delete_pessoa();

-- só agora dá pra referenciar pessoas (Proprietário) a partir de
-- fazendas, definida mais acima no arquivo
alter table fazendas add column proprietario_id uuid references pessoas(id);

-- Plano de contas financeiro (módulo Financeiro): transcrição literal
-- do plano de referência do usuário (Metryx) em 3 níveis numerados —
-- Classe (1 dígito) → Centro de Custo (2 dígitos, aninhado numa
-- Classe) → Subcentro de Custo (3 dígitos, aninhado num Centro). Um
-- 4º campo, Produto/Serviço, fica fora da numeração — ver
-- produtos_financeiros mais abaixo, seção FINANCEIRO.
create table classes_financeiras (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  numero     int not null,
  nome       text not null,
  tipo       tipo_lancamento_financeiro not null,
  sistema    boolean not null default false,
  ativo      boolean not null default true,
  ordem      int not null default 0,
  constraint uq_classe_financeira_numero unique (conta_id, numero)
);
alter table classes_financeiras enable row level security;
create policy classes_financeiras_por_conta on classes_financeiras for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table centros_custo (
  id                   uuid primary key default gen_random_uuid(),
  conta_id             uuid not null references contas(id) default fn_conta_atual(),
  classe_financeira_id uuid not null references classes_financeiras(id),
  numero               int,
  nome                 text not null,
  sistema              boolean not null default false,
  ativo                boolean not null default true,
  ordem                int not null default 0,
  created_at           timestamptz not null default now(),
  constraint uq_centro_custo_nome unique (conta_id, classe_financeira_id, nome)
);
alter table centros_custo enable row level security;
create policy centros_custo_por_conta on centros_custo for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table subcentros_custo (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id) default fn_conta_atual(),
  centro_custo_id uuid not null references centros_custo(id) on delete cascade,
  numero          int,
  nome            text not null,
  sistema         boolean not null default false,
  ativo           boolean not null default true,
  constraint uq_subcentro_por_centro unique (centro_custo_id, nome)
);
alter table subcentros_custo enable row level security;
create policy subcentros_custo_por_conta on subcentros_custo for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- =====================================================================
-- 1b. GESTÃO DE ÁREAS — uso do solo por fazenda, com histórico editável
--
-- Mesma arquitetura da movimentação de rebanho: um ledger de eventos
-- (movimentacoes_area) e o saldo de área por tipo de uso numa data
-- qualquer é calculado somando os eventos até aquela data
-- (fn_area_por_uso, equivalente a fn_saldo_categoria). Área nunca
-- "nasce" nem "morre" depois do saldo inicial — só realoca de um tipo
-- de uso pra outro dentro da mesma fazenda.
-- =====================================================================

create table tipos_uso_area (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,
  ordem           int not null default 0,
  created_at      timestamptz not null default now()
);
-- ver comentário em grupos_categoria_papel sobre RLS padrão em tabela nova
alter table tipos_uso_area disable row level security;

-- subtipos_uso_area (migração 032): dimensão mais fina dentro de um
-- tipo de uso — mesmo princípio de pasto dentro de fazenda+categoria.
-- Mecanismo genérico (qualquer tipo_uso pode ter subtipos), mas só
-- exposto na UI hoje pra Pecuária e Agricultura. Opt-in por grupo via
-- configuracoes.controla_subtipo_area — desligado, tudo usa o subtipo
-- "Geral" que sempre existe pra cada tipo de uso (seed abaixo).
create table subtipos_uso_area (
  id           uuid primary key default gen_random_uuid(),
  conta_id     uuid not null references contas(id) default fn_conta_atual(),
  tipo_uso_id  uuid not null references tipos_uso_area(id),
  nome         text not null,
  ativo        boolean not null default true,
  -- "Geral" nunca pode ser excluído (ver fn_validar_delete_subtipo_uso_area)
  sistema      boolean not null default false,
  ordem        int not null default 0,
  created_at   timestamptz not null default now(),
  -- migração 049b: precisa incluir conta_id (subtipos_uso_area virou
  -- conta-scoped na Fase 1/migração 046, mas essa constraint, criada
  -- antes disso na migração 032, ficou pra trás sem esse ajuste — sem
  -- conta_id aqui, a segunda conta que insere um "Geral" pra qualquer
  -- tipo de uso colide com a linha da primeira, já que tipos_uso_area
  -- é catálogo global (mesmo tipo_uso_id em todas as contas)
  constraint uq_subtipo_nome_tipo_uso unique (conta_id, tipo_uso_id, nome)
);
alter table subtipos_uso_area enable row level security;
create policy subtipos_uso_area_por_conta on subtipos_uso_area for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- INCORPORACAO_AREA/DESINCORPORACAO_AREA (migração 053): área
-- comprada/vendida — muda o total da fazenda, diferente de MUDANCA_USO
-- (só realoca área que já existe entre tipos de uso). Reaproveita a
-- mesma tabela/mecânica em vez de um "tipo de uso" fictício tipo "Fora
-- da Fazenda": INCORPORACAO só tem destino (mesmo formato de
-- SALDO_INICIAL — área nova entra direto num tipo de uso, sem
-- checagem de saldo); DESINCORPORACAO só tem origem (espelho — sai de
-- um tipo de uso existente, com checagem de saldo suficiente igual
-- MUDANCA_USO). fazendas.area_ha acompanha sozinho via
-- fn_atualizar_area_total_fazenda, abaixo.
create table movimentacoes_area (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references contas(id) default fn_conta_atual(),
  fazenda_id            uuid not null references fazendas(id),
  tipo                  tipo_movimentacao_area not null,
  data                  date not null,
  -- null em SALDO_INICIAL/INCORPORACAO_AREA (sem origem — área nova
  -- entrando na fazenda)
  tipo_uso_origem_id    uuid references tipos_uso_area(id),
  -- null só em DESINCORPORACAO_AREA (sem destino — área saindo da
  -- fazenda, não há outro tipo de uso pra receber)
  tipo_uso_destino_id   uuid references tipos_uso_area(id),
  -- subtipo (migração 032) espelha o par origem/destino acima, mesma
  -- regra de nulidade
  subtipo_uso_origem_id  uuid references subtipos_uso_area(id),
  subtipo_uso_destino_id uuid references subtipos_uso_area(id),
  area_ha               numeric(12,2) not null check (area_ha > 0),
  -- superseded pelo subtipo estruturado (migração 032) — mantido só
  -- como histórico bruto, não é mais lido/escrito pelo frontend
  cultura               text,
  observacao            text,
  created_at            timestamptz not null default now(),
  constraint ck_area_movimentacao_origem check (
    (tipo = 'SALDO_INICIAL' and tipo_uso_origem_id is null and tipo_uso_destino_id is not null)
    or (tipo = 'MUDANCA_USO' and tipo_uso_origem_id is not null and tipo_uso_destino_id is not null
        and tipo_uso_origem_id <> tipo_uso_destino_id)
    or (tipo = 'INCORPORACAO_AREA' and tipo_uso_origem_id is null and tipo_uso_destino_id is not null)
    or (tipo = 'DESINCORPORACAO_AREA' and tipo_uso_origem_id is not null and tipo_uso_destino_id is null)
  ),
  constraint ck_subtipo_area_origem check (
    (tipo = 'SALDO_INICIAL' and subtipo_uso_origem_id is null and subtipo_uso_destino_id is not null)
    or (tipo = 'MUDANCA_USO' and subtipo_uso_origem_id is not null and subtipo_uso_destino_id is not null)
    or (tipo = 'INCORPORACAO_AREA' and subtipo_uso_origem_id is null and subtipo_uso_destino_id is not null)
    or (tipo = 'DESINCORPORACAO_AREA' and subtipo_uso_origem_id is not null and subtipo_uso_destino_id is null)
  )
);

alter table movimentacoes_area enable row level security;
create policy movimentacoes_area_por_conta on movimentacoes_area for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- só pode haver um saldo inicial por (fazenda, tipo de uso) — mesmo
-- princípio de uq_saldo_inicial_por_categoria
create unique index uq_saldo_inicial_area_por_tipo
  on movimentacoes_area (fazenda_id, tipo_uso_destino_id)
  where tipo = 'SALDO_INICIAL';

-- ---------------------------------------------------------------------
-- fn_area_por_uso: hectares alocados a um tipo de uso, numa fazenda,
-- até uma data (equivalente a fn_saldo_categoria)
-- ---------------------------------------------------------------------

create or replace function fn_area_por_uso(p_fazenda_id uuid, p_tipo_uso_id uuid, p_data date)
returns numeric
language plpgsql
stable
as $$
declare
  v_entradas numeric;
  v_saidas   numeric;
begin
  select coalesce(sum(area_ha), 0) into v_entradas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_destino_id = p_tipo_uso_id and data <= p_data;

  select coalesce(sum(area_ha), 0) into v_saidas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_origem_id = p_tipo_uso_id and data <= p_data;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_area_por_subtipo_uso (migração 032): mesma ideia de fn_area_por_uso,
-- refinada pro nível de subtipo. Fazenda que não usa
-- controla_subtipo_area só tem o subtipo "Geral" de cada tipo de uso,
-- então o saldo por subtipo coincide com o saldo do tipo de uso
-- inteiro nesse caso. Vale sempre: fn_area_por_uso(fazenda, tipo_uso,
-- data) = soma, sobre todos os subtipos daquele tipo de uso, de
-- fn_area_por_subtipo_uso.
-- ---------------------------------------------------------------------

create or replace function fn_area_por_subtipo_uso(
  p_fazenda_id uuid, p_tipo_uso_id uuid, p_subtipo_uso_id uuid, p_data date
)
returns numeric
language plpgsql
stable
as $$
declare
  v_entradas numeric;
  v_saidas   numeric;
begin
  select coalesce(sum(area_ha), 0) into v_entradas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_destino_id = p_tipo_uso_id
    and subtipo_uso_destino_id = p_subtipo_uso_id and data <= p_data;

  select coalesce(sum(area_ha), 0) into v_saidas
  from movimentacoes_area
  where fazenda_id = p_fazenda_id and tipo_uso_origem_id = p_tipo_uso_id
    and subtipo_uso_origem_id = p_subtipo_uso_id and data <= p_data;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- TRIGGER: o subtipo selecionado precisa pertencer ao tipo de uso do
-- lançamento (mesmo princípio de fn_validar_pasto_pertence_fazenda)
-- ---------------------------------------------------------------------

create or replace function fn_validar_subtipo_pertence_tipo_uso()
returns trigger as $$
declare
  v_tipo_uso_destino uuid;
  v_tipo_uso_origem  uuid;
begin
  select tipo_uso_id into v_tipo_uso_destino from subtipos_uso_area where id = new.subtipo_uso_destino_id;
  if v_tipo_uso_destino is distinct from new.tipo_uso_destino_id then
    raise exception 'O subtipo de destino selecionado não pertence ao tipo de uso de destino.';
  end if;

  if new.subtipo_uso_origem_id is not null then
    select tipo_uso_id into v_tipo_uso_origem from subtipos_uso_area where id = new.subtipo_uso_origem_id;
    if v_tipo_uso_origem is distinct from new.tipo_uso_origem_id then
      raise exception 'O subtipo de origem selecionado não pertence ao tipo de uso de origem.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_subtipo_pertence_tipo_uso
before insert or update on movimentacoes_area
for each row execute function fn_validar_subtipo_pertence_tipo_uso();

-- ---------------------------------------------------------------------
-- TRIGGER: MUDANCA_USO não pode tirar mais área de um tipo de uso do
-- que ele tem disponível na data (checado também no nível de subtipo,
-- migração 032 — defesa em profundidade, mesmo princípio de
-- fn_validar_saldo_categoria com pasto); SALDO_INICIAL não pode fazer
-- a soma de todos os tipos de uso da fazenda ultrapassar a área total
-- dela (fazendas.area_ha — se estiver em branco, não há teto pra checar).
-- ---------------------------------------------------------------------

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
    -- mesma checagem de MUDANCA_USO, sem o nível de subtipo (área pode
    -- ter sido declarada direto no tipo de uso via SALDO_INICIAL sem
    -- detalhamento por subtipo)
    v_area_disponivel := fn_area_por_uso(new.fazenda_id, new.tipo_uso_origem_id, new.data);
    if v_area_disponivel < new.area_ha then
      raise exception 'Área insuficiente pra desincorporar: % ha disponível(is) nesse tipo de uso na data %, mas % foi(ram) solicitado(s).',
        v_area_disponivel, new.data, new.area_ha;
    end if;
  end if;
  -- INCORPORACAO_AREA não tem checagem — a área nova É o novo total,
  -- sem "de onde" descontar

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_saldo_area
before insert on movimentacoes_area
for each row execute function fn_validar_saldo_area();

-- fazendas.area_ha acompanha automaticamente incorporação/
-- desincorporação — soma na incorporação, subtrai na desincorporação
-- (inclui UPDATE/DELETE por completude, mesmo sem UI de editar/excluir
-- nesta rodada — mantém o total consistente mesmo se um lançamento for
-- corrigido direto no banco)
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

-- ---------------------------------------------------------------------
-- EDIÇÃO/EXCLUSÃO DE MOVIMENTAÇÕES DE ÁREA — mesma proteção de
-- trajetória já usada pro rebanho, adaptada pro modelo de 2 baldes
-- (tipo de uso origem/destino) em vez de 6.
-- ---------------------------------------------------------------------

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
  -- DESINCORPORACAO_AREA (migração 053) também subtrai do lado origem,
  -- mesmo princípio de MUDANCA_USO
  if p_tipo in ('MUDANCA_USO', 'DESINCORPORACAO_AREA') and p_tipo_uso_origem_id = p_par_tipo_uso_id then
    v_total := v_total - p_area_ha;
  end if;
  return v_total;
end;
$$;

create or replace function fn_checar_edicao_area(
  p_id uuid,
  p_fazenda_id uuid,
  p_tipo tipo_movimentacao_area,
  p_tipo_uso_origem_id uuid,
  p_tipo_uso_destino_id uuid,
  p_data date,
  p_area_ha numeric
) returns table(
  tem_movimentacoes_futuras boolean,
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  tipo_uso_saldo_negativo text,
  saldo_minimo numeric
)
language plpgsql
as $$
declare
  v_old         movimentacoes_area%rowtype;
  v_tipo_uso_id uuid;
  v_data        date;
  v_saldo       numeric;
  v_pior_saldo  numeric;
  v_pior_data   date;
  v_pior_tipo   uuid;
  v_tem_futuras boolean := false;
begin
  select * into v_old from movimentacoes_area where id = p_id;

  for v_tipo_uso_id in (
    select distinct t from (
      values (v_old.tipo_uso_origem_id), (v_old.tipo_uso_destino_id),
             (p_tipo_uso_origem_id), (p_tipo_uso_destino_id)
    ) as x(t)
    where t is not null
  )
  loop
    if exists (
      select 1 from movimentacoes_area m
      where m.id <> p_id and m.fazenda_id = p_fazenda_id and m.data > p_data
        and (m.tipo_uso_origem_id = v_tipo_uso_id or m.tipo_uso_destino_id = v_tipo_uso_id)
    ) then
      v_tem_futuras := true;
    end if;

    for v_data in (
      select distinct m.data from movimentacoes_area m
      where m.id <> p_id and m.fazenda_id = p_fazenda_id and m.data >= p_data
        and (m.tipo_uso_origem_id = v_tipo_uso_id or m.tipo_uso_destino_id = v_tipo_uso_id)
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_area_por_uso(p_fazenda_id, v_tipo_uso_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_area_para_tipo(v_old.tipo, v_old.tipo_uso_origem_id, v_old.tipo_uso_destino_id,
                                          v_old.area_ha, v_tipo_uso_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_area_para_tipo(p_tipo, p_tipo_uso_origem_id, p_tipo_uso_destino_id,
                                          p_area_ha, v_tipo_uso_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
        v_pior_tipo := v_tipo_uso_id;
      end if;
    end loop;
  end loop;

  tem_movimentacoes_futuras := v_tem_futuras;
  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  select nome into tipo_uso_saldo_negativo from tipos_uso_area where id = v_pior_tipo;

  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- Trajetória de edição/exclusão ciente do subtipo (migração 032) —
-- mesmo princípio de fn_delta_area_para_tipo/fn_checar_edicao_area, só
-- que pra dimensão do subtipo. Mantida como função própria e paralela
-- (não mexe no retorno de fn_checar_edicao_area nem nos call sites já
-- existentes em Gestão de Áreas) — o bloqueio abaixo é a fonte de
-- verdade; ainda não tem o aviso amigável com data/quantidade que a
-- versão por tipo de uso tem (mesmo princípio já aceito pra trajetória
-- de lote de nascimento: vira exceção direta do banco em vez do aviso
-- amigável, até que valha a pena estender a versão detalhada).
-- ---------------------------------------------------------------------

create or replace function fn_delta_area_para_subtipo(
  p_tipo tipo_movimentacao_area,
  p_subtipo_uso_origem_id uuid,
  p_subtipo_uso_destino_id uuid,
  p_area_ha numeric,
  p_par_subtipo_id uuid
) returns numeric
language plpgsql
immutable
as $$
declare
  v_total numeric := 0;
begin
  if p_subtipo_uso_destino_id = p_par_subtipo_id then
    v_total := v_total + p_area_ha;
  end if;
  if p_tipo = 'MUDANCA_USO' and p_subtipo_uso_origem_id = p_par_subtipo_id then
    v_total := v_total - p_area_ha;
  end if;
  return v_total;
end;
$$;

create or replace function fn_subtipo_area_ficaria_negativo(
  p_id uuid,
  p_fazenda_id uuid,
  p_tipo tipo_movimentacao_area,
  p_subtipo_uso_origem_id uuid,
  p_subtipo_uso_destino_id uuid,
  p_data date,
  p_area_ha numeric
) returns boolean
language plpgsql
as $$
declare
  v_old         movimentacoes_area%rowtype;
  v_subtipo_id  uuid;
  v_data        date;
  v_saldo       numeric;
  v_tipo_uso_id uuid;
begin
  select * into v_old from movimentacoes_area where id = p_id;

  for v_subtipo_id in (
    select distinct t from (
      values (v_old.subtipo_uso_origem_id), (v_old.subtipo_uso_destino_id),
             (p_subtipo_uso_origem_id), (p_subtipo_uso_destino_id)
    ) as x(t)
    where t is not null
  )
  loop
    select tipo_uso_id into v_tipo_uso_id from subtipos_uso_area where id = v_subtipo_id;

    for v_data in (
      select distinct m.data from movimentacoes_area m
      where m.id <> p_id and m.fazenda_id = p_fazenda_id and m.data >= p_data
        and (m.subtipo_uso_origem_id = v_subtipo_id or m.subtipo_uso_destino_id = v_subtipo_id)
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_area_por_subtipo_uso(p_fazenda_id, v_tipo_uso_id, v_subtipo_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_area_para_subtipo(v_old.tipo, v_old.subtipo_uso_origem_id, v_old.subtipo_uso_destino_id,
                                             v_old.area_ha, v_subtipo_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_area_para_subtipo(p_tipo, p_subtipo_uso_origem_id, p_subtipo_uso_destino_id,
                                             p_area_ha, v_subtipo_id)
            else 0 end;

      if v_saldo < 0 then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

create or replace function fn_validar_edicao_area()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_area(
    old.id, new.fazenda_id, new.tipo, new.tipo_uso_origem_id, new.tipo_uso_destino_id, new.data, new.area_ha
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível editar: a área de % ficaria negativa (%) em %.',
      v_check.tipo_uso_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  if fn_subtipo_area_ficaria_negativo(
    old.id, new.fazenda_id, new.tipo, new.subtipo_uso_origem_id, new.subtipo_uso_destino_id, new.data, new.area_ha
  ) then
    raise exception 'Não é possível editar: essa alteração deixaria negativa a área de algum subtipo de uso envolvido.';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_edicao_area
before update on movimentacoes_area
for each row execute function fn_validar_edicao_area();

create or replace function fn_validar_delete_area()
returns trigger as $$
declare
  v_check record;
begin
  select * into v_check from fn_checar_edicao_area(
    old.id, old.fazenda_id, old.tipo, old.tipo_uso_origem_id, old.tipo_uso_destino_id, old.data, 0
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível excluir: a área de % ficaria negativa (%) em %.',
      v_check.tipo_uso_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  if fn_subtipo_area_ficaria_negativo(
    old.id, old.fazenda_id, old.tipo, old.subtipo_uso_origem_id, old.subtipo_uso_destino_id, old.data, 0
  ) then
    raise exception 'Não é possível excluir: a exclusão deixaria negativa a área de algum subtipo de uso envolvido.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_area
before delete on movimentacoes_area
for each row execute function fn_validar_delete_area();

-- ---------------------------------------------------------------------
-- Exclusão de subtipo (migração 032) — mesmo princípio de
-- fn_validar_delete_pasto: "Geral" nunca pode ser excluído (só
-- inativado), e um subtipo criado pelo usuário só pode ser excluído se
-- não tiver nenhuma movimentação de área lançada (nem como origem, nem
-- como destino).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_subtipo_uso_area()
returns trigger as $$
begin
  if old.sistema then
    raise exception 'O subtipo "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (
    select 1 from movimentacoes_area
    where subtipo_uso_origem_id = old.id or subtipo_uso_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: esse subtipo já tem movimentações lançadas. Inative-o em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_subtipo_uso_area
before delete on subtipos_uso_area
for each row execute function fn_validar_delete_subtipo_uso_area();

-- ---------------------------------------------------------------------
-- RELATÓRIO DE DISTRIBUIÇÃO DE ÁREA — uma linha por (mês, tipo de uso)
-- dentro do período filtrado, com a área média PONDERADA PELOS DIAS
-- (não a média simples): se a área mudou de uso no meio do mês, os
-- dias antes e depois entram com pesos diferentes. dias_no_mes vem
-- junto pra o período completo poder ser derivado no frontend como
-- soma(area_media * dias_no_mes) / soma(dias_no_mes) — matematicamente
-- idêntico a calcular a média ponderada direto sobre todos os dias do
-- período, sem precisar reconsultar dia a dia de novo.
-- ---------------------------------------------------------------------

create or replace function fn_area_media_ponderada(
  p_fazenda_id uuid,
  p_tipo_uso_id uuid,
  p_data_inicio date,
  p_data_fim date
) returns numeric
language plpgsql
stable
as $$
declare
  v_soma numeric := 0;
  v_dias int := 0;
  v_dia  date;
begin
  for v_dia in select generate_series(p_data_inicio, p_data_fim, interval '1 day')::date
  loop
    v_soma := v_soma + fn_area_por_uso(p_fazenda_id, p_tipo_uso_id, v_dia);
    v_dias := v_dias + 1;
  end loop;

  if v_dias = 0 then
    return 0;
  end if;

  return round(v_soma / v_dias, 2);
end;
$$;

create or replace function fn_relatorio_distribuicao_area(
  p_fazenda_id uuid,
  p_data_inicio date,
  p_data_fim date
) returns table(
  mes int,
  ano int,
  tipo_uso_id uuid,
  tipo_uso_nome text,
  area_media_ponderada numeric,
  dias_no_mes int
)
language plpgsql
as $$
declare
  v_mes_inicio date := date_trunc('month', p_data_inicio)::date;
  v_mes_fim    date;
  v_janela_ini date;
  v_janela_fim date;
begin
  while v_mes_inicio <= p_data_fim
  loop
    v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;
    v_janela_ini := greatest(v_mes_inicio, p_data_inicio);
    v_janela_fim := least(v_mes_fim, p_data_fim);

    return query
    select
      extract(month from v_mes_inicio)::int,
      extract(year from v_mes_inicio)::int,
      t.id,
      t.nome,
      fn_area_media_ponderada(p_fazenda_id, t.id, v_janela_ini, v_janela_fim),
      (v_janela_fim - v_janela_ini + 1)::int
    from tipos_uso_area t
    order by t.ordem;

    v_mes_inicio := (v_mes_inicio + interval '1 month')::date;
  end loop;
end;
$$;

-- =====================================================================
-- 1c. MÓDULOS E PASTOS — controle de rebanho por pasto (opt-in único
-- pra todo o grupo, via configuracoes.controla_pasto). Dois níveis:
-- módulo (onde roda o pastejo rotacionado, PECUARIA, ou o agrupamento
-- de talhões, AGRICULTURA) contém pastos/talhões — ver "Conversão
-- pasto↔talhão (ILP)" (migração 052) pra como um pasto muda de um tipo
-- de módulo pro outro.
-- =====================================================================

create type tipo_utilizacao_modulo as enum ('PECUARIA', 'AGRICULTURA');

create table modulos (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id) default fn_conta_atual(),
  fazenda_id      uuid not null references fazendas(id),
  nome            text not null,
  tipo_utilizacao tipo_utilizacao_modulo not null default 'PECUARIA',
  ativo           boolean not null default true,
  ordem           int not null default 0,
  -- módulo "Geral" auto-criado (ver fn_criar_modulo_pasto_geral) — não
  -- pode ser excluído pela UI (só inativado), mesmo que renomeado
  -- depois (ver fn_validar_delete_modulo)
  sistema         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint uq_modulo_nome_fazenda unique (fazenda_id, nome)
);
alter table modulos enable row level security;
create policy modulos_por_conta on modulos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table pastos (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id) default fn_conta_atual(),
  modulo_id       uuid not null references modulos(id),
  nome            text not null,
  -- livre (sem histórico por data, diferente de movimentacoes_area) —
  -- validado contra a área de Pecuária no momento do cadastro/edição,
  -- não reconciliado retroativamente se a área de Pecuária encolher
  -- depois (ver fn_validar_area_pasto). "Área total" na interface.
  area_ha         numeric(12,2),
  -- área realmente aproveitável pra pastagem (descontando brejo/pedra/
  -- mata dentro do pasto) — usada como denominador da lotação (UA/ha)
  -- no lugar da área total (migração 038)
  area_produtiva_ha numeric(12,2),
  ativo           boolean not null default true,
  ordem           int not null default 0,
  -- pasto "Geral" auto-criado — mesma proteção de sistema do módulo
  -- acima (ver fn_validar_delete_pasto)
  sistema         boolean not null default false,
  -- contorno do pasto/talhão (GeoJSON, WGS84) — desenhado no mapa ou
  -- importado de KML casando pelo nome; quando presente, alimenta o
  -- cálculo automático de area_ha, mas nunca é obrigatório
  geometria       jsonb,
  -- cor customizada no mapa (hex) — nula usa a cor automática do
  -- módulo (migração 041)
  cor             text,
  created_at      timestamptz not null default now(),
  constraint uq_pasto_nome_modulo unique (modulo_id, nome)
);
alter table pastos enable row level security;
create policy pastos_por_conta on pastos for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- toda fazenda nova já ganha os pares módulo+pasto/talhão "Módulo 1"/
-- "Pasto 1" (PECUARIA) e "Geral (Agricultura)"/"Talhão 1" (AGRICULTURA)
-- automaticamente — se o grupo não liga controla_pasto ninguém vê essa
-- tela, mas todo lançamento de rebanho sempre tem pra onde apontar, e
-- toda conversão pasto↔talhão sempre tem um módulo do tipo oposto pra
-- receber (migração 052)
-- conta_id gravado explicitamente (new.conta_id) em vez de confiar no
-- default fn_conta_atual() — este último só resolve corretamente numa
-- sessão de app autenticada; um insert de fazenda feito fora dela (ex.:
-- script rodando com a chave service-role) não tem auth.uid() nenhum, e
-- o default viraria null (migração 063).
create or replace function fn_criar_modulo_pasto_geral()
returns trigger as $$
declare
  v_modulo_pecuaria_id    uuid;
  v_modulo_agricultura_id uuid;
begin
  insert into modulos (conta_id, fazenda_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.conta_id, new.id, 'Módulo 1', 'PECUARIA', 0, true)
  returning id into v_modulo_pecuaria_id;

  insert into pastos (conta_id, modulo_id, nome, ordem, sistema)
  values (new.conta_id, v_modulo_pecuaria_id, 'Pasto 1', 0, true);

  insert into modulos (conta_id, fazenda_id, nome, tipo_utilizacao, ordem, sistema)
  values (new.conta_id, new.id, 'Geral (Agricultura)', 'AGRICULTURA', 1, true)
  returning id into v_modulo_agricultura_id;

  insert into pastos (conta_id, modulo_id, nome, ordem, sistema)
  values (new.conta_id, v_modulo_agricultura_id, 'Talhão 1', 0, true);

  return new;
end;
$$ language plpgsql;

create trigger trg_criar_modulo_pasto_geral
after insert on fazendas
for each row execute function fn_criar_modulo_pasto_geral();

-- ---------------------------------------------------------------------
-- TRIGGER: pasto "Geral" nunca pode ser excluído. Pasto criado pelo
-- usuário só pode ser excluído se não tiver nenhuma movimentação ou
-- pesagem lançada (mesmo princípio de fn_validar_delete_categoria).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_pasto()
returns trigger as $$
begin
  if old.sistema and coalesce(current_setting('orion.excluindo_fazenda', true), 'false') <> 'true' then
    raise exception 'O pasto "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (
    select 1 from movimentacoes_rebanho
    where pasto_id = old.id or pasto_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: esse pasto já tem movimentações lançadas. Inative-o em vez disso.';
  end if;

  if exists (select 1 from pesagens where pasto_id = old.id) then
    raise exception 'Não é possível excluir: esse pasto já tem pesagens registradas. Inative-o em vez disso.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_pasto
before delete on pastos
for each row execute function fn_validar_delete_pasto();

-- ---------------------------------------------------------------------
-- TRIGGER: módulo "Geral" nunca pode ser excluído. Módulo criado pelo
-- usuário só pode ser excluído se já estiver sem nenhum pasto/talhão
-- (exclui-los primeiro — evita cascade e reaproveita a mesma validação
-- de histórico já feita em fn_validar_delete_pasto).
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_modulo()
returns trigger as $$
begin
  if old.sistema and coalesce(current_setting('orion.excluindo_fazenda', true), 'false') <> 'true' then
    raise exception 'O módulo "Geral" não pode ser excluído — inative-o em vez disso.';
  end if;

  if exists (select 1 from pastos where modulo_id = old.id) then
    raise exception 'Não é possível excluir: exclua os pastos/talhões desse módulo primeiro.';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_modulo
before delete on modulos
for each row execute function fn_validar_delete_modulo();

-- ---------------------------------------------------------------------
-- TRIGGER: exclusão de fazenda (migração 038) — só permitida se não
-- houver nenhuma movimentação (rebanho, área ou pesagem) referenciando
-- a fazenda. Passando essa checagem, apaga em cascata módulo/pasto
-- "Geral" (normalmente protegidos contra exclusão) via flag de sessão
-- checado acima em fn_validar_delete_pasto/modulo.
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_fazenda()
returns trigger as $$
begin
  if exists (
    select 1 from movimentacoes_rebanho
    where fazenda_id = old.id or fazenda_origem_id = old.id or fazenda_destino_id = old.id
  ) then
    raise exception 'Não é possível excluir: essa fazenda já tem movimentações de rebanho lançadas. Inative-a em vez disso.';
  end if;

  if exists (select 1 from movimentacoes_area where fazenda_id = old.id) then
    raise exception 'Não é possível excluir: essa fazenda já tem movimentações de área lançadas. Inative-a em vez disso.';
  end if;

  if exists (select 1 from pesagens where fazenda_id = old.id) then
    raise exception 'Não é possível excluir: essa fazenda já tem pesagens registradas. Inative-a em vez disso.';
  end if;

  perform set_config('orion.excluindo_fazenda', 'true', true);
  delete from pastos where modulo_id in (select id from modulos where fazenda_id = old.id);
  delete from modulos where fazenda_id = old.id;
  perform set_config('orion.excluindo_fazenda', 'false', true);

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_fazenda
before delete on fazendas
for each row execute function fn_validar_delete_fazenda();

-- soma das áreas dos pastos/talhões de módulos do MESMO tipo_utilizacao
-- não pode ultrapassar a área alocada nesse mesmo tipo de uso
-- (fn_area_por_uso na data de hoje — opção simples combinada com o
-- usuário, sem histórico por data no pasto). Tipo_utilizacao-aware
-- desde a migração 052 — antes somava todos os pastos da fazenda contra
-- só a área de Pecuária, o que teria misturado talhão com pasto assim
-- que Agricultura fosse liberada.
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

create trigger trg_validar_area_pasto
before insert or update on pastos
for each row execute function fn_validar_area_pasto();

-- ---------------------------------------------------------------------
-- Conversão pasto ↔ talhão (ILP — Integração Lavoura-Pecuária,
-- migração 052): converte um pasto/talhão pra um módulo de
-- tipo_utilizacao oposto, atomicamente — insere a MUDANCA_USO
-- correspondente (dispara fn_validar_saldo_area sozinha, bloqueando se
-- não houver área suficiente no tipo de uso de origem) e só então move
-- pastos.modulo_id. Tudo dentro da mesma função = atômico: se a
-- MUDANCA_USO for rejeitada, o pasto nunca muda de módulo.
-- ---------------------------------------------------------------------

create or replace function fn_converter_pasto_talhao(p_pasto_id uuid, p_modulo_destino_id uuid)
returns void
language plpgsql
as $$
declare
  v_fazenda_id             uuid;
  v_fazenda_destino_id     uuid;
  v_modulo_origem_id       uuid;
  v_tipo_origem            tipo_utilizacao_modulo;
  v_tipo_destino           tipo_utilizacao_modulo;
  v_area_ha                numeric;
  v_nome_pasto             text;
  v_tipo_uso_pecuaria_id   uuid;
  v_tipo_uso_agricultura_id uuid;
  v_tipo_uso_origem_id     uuid;
  v_tipo_uso_destino_id    uuid;
  v_subtipo_origem_id      uuid;
  v_subtipo_destino_id     uuid;
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

-- =====================================================================
-- 2. TABELA FATO — MOVIMENTAÇÃO DE REBANHO
-- =====================================================================

create table movimentacoes_rebanho (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references contas(id) default fn_conta_atual(),

  -- fazenda "principal" do evento (para TRANSFERENCIA, ver origem/destino abaixo)
  fazenda_id            uuid not null references fazendas(id),

  data                  date not null,
  tipo                  tipo_movimentacao not null,

  categoria_id          uuid not null references categorias_animal(id),
  -- usado APENAS em MUDANCA_CATEGORIA (categoria de destino da transição)
  categoria_destino_id  uuid references categorias_animal(id),

  -- usados APENAS em TRANSFERENCIA
  fazenda_origem_id     uuid references fazendas(id),
  fazenda_destino_id    uuid references fazendas(id),

  -- pasto onde o animal está (ou de onde sai, em saídas/mudanças).
  -- Sempre obrigatório — fazenda que não usa controle por pasto
  -- (controla_pasto = false) só tem o pasto "Geral" pra escolher, e o
  -- formulário preenche isso sozinho. pasto_destino_id só é usado em
  -- MUDANCA_PASTO (pasto de destino) e TRANSFERENCIA (pasto na fazenda
  -- de destino) — MUDANCA_CATEGORIA/DESMAME nunca mudam de pasto no
  -- mesmo lançamento (precisa de um MUDANCA_PASTO à parte pra isso).
  pasto_id              uuid not null references pastos(id),
  pasto_destino_id      uuid references pastos(id),

  quantidade            int not null check (quantidade > 0),
  peso_medio_kg         numeric(10,2),
  peso_total_kg         numeric(12,2),

  -- lote de nascimento (safra) — só usado quando a categoria envolvida
  -- é Bezerro/Bezerra Mamando (ver fn_categoria_e_bezerro). Sugerida
  -- automaticamente (regra julho-junho) mas sempre editável — a
  -- parição real pode cair fora da janela calendário. Migração 030
  -- também tinha mes_nascimento (mês exato); removido na migração 031
  -- por decisão do usuário — mês exigia um segundo campo em todo
  -- lançamento sem ganho proporcional (não sobrevivia além do
  -- lançamento de entrada de qualquer forma).
  safra_nascimento_ano_inicio int,

  -- proprietário do lote de gado dessa linha (migração 044, lista
  -- global de pessoas com papel PROPRIETARIO desde a migração 045) —
  -- dimensão independente, não cruza com pasto.
  proprietario_id       uuid references pessoas(id),

  -- comercial (compra / venda em pé / venda abate / consumo-doação)
  -- as 4 formas de valor abaixo são intercambiáveis: preencha UMA
  -- (ou valor_total, ou uma das 3 unitárias) e o trigger
  -- fn_calcular_valores_movimentacao (mais abaixo) calcula as demais.
  valor_arroba          numeric(10,2),   -- R$/@
  valor_cabeca          numeric(10,2),   -- R$/CABEÇA
  valor_kg              numeric(10,2),   -- R$/KG
  valor_total           numeric(14,2),   -- R$ TOTAL
  cliente_fornecedor_id uuid references pessoas(id),

  -- específicos de venda abate / consumo-doação
  -- mesmo princípio: preencha peso_morto_kg OU rendimento_carcaca_pct,
  -- o trigger calcula o que faltar.
  rendimento_carcaca_pct numeric(5,2),
  peso_morto_kg          numeric(10,2),

  -- usado APENAS em CONSUMO_DOACAO: distingue consumo próprio de doação
  -- (necessário para os relatórios futuros de rebanho)
  subtipo_consumo_doacao subtipo_consumo_doacao,

  -- específico de morte
  causa_morte           text,

  observacao            text,

  -- correlaciona linhas de um mesmo lançamento em lote (mais de uma
  -- categoria lançada juntas, ex.: venda de garrotes + novilhas pro
  -- mesmo comprador no mesmo dia) — null quando a movimentação foi
  -- lançada sozinha. Puramente um id de correlação (sem tabela própria
  -- — nenhum outro dado depende dele além de agrupar visualmente na
  -- listagem e permitir reabrir o lote inteiro pra edição em
  -- app/movimentacoes/page.tsx). Cada linha continua uma movimentação
  -- independente pro resto do sistema (saldo, relatórios, trajetória).
  grupo_lancamento_id   uuid,

  usuario_id            uuid references usuarios(id),
  created_at            timestamptz not null default now(),

  -- -------------------------------------------------------------
  -- REGRAS DE INTEGRIDADE POR TIPO DE EVENTO
  -- -------------------------------------------------------------

  -- MUDANCA_CATEGORIA e DESMAME exigem categoria_destino_id preenchido
  -- e diferente da categoria de origem; nenhum outro tipo pode usá-lo.
  -- Em DESMAME, categoria_destino_id é a categoria para a qual o
  -- bezerro evolui após o desmame — mesmo sexo da origem validado na
  -- aplicação, era 08-12 validada no banco (fn_validar_lote_nascimento_bezerro,
  -- migração 030). MUDANCA_CATEGORIA nunca pode envolver categoria de
  -- bezerro, nem como origem nem como destino (mesma trigger) — a
  -- única evolução de bezerro é o Desmame.
  constraint ck_categoria_destino check (
    (tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and categoria_destino_id is not null
       and categoria_destino_id <> categoria_id)
    or
    (tipo not in ('MUDANCA_CATEGORIA', 'DESMAME') and categoria_destino_id is null)
  ),

  -- TRANSFERENCIA exige fazenda_origem_id e fazenda_destino_id
  -- preenchidos e diferentes entre si; nenhum outro tipo pode usá-los.
  -- A transferência NUNCA muda categoria no mesmo evento (ver acima).
  constraint ck_transferencia check (
    (tipo = 'TRANSFERENCIA'
       and fazenda_origem_id is not null
       and fazenda_destino_id is not null
       and fazenda_origem_id <> fazenda_destino_id)
    or
    (tipo <> 'TRANSFERENCIA'
       and fazenda_origem_id is null
       and fazenda_destino_id is null)
  ),

  -- CONSUMO_DOACAO exige a distinção consumo interno / doação;
  -- nenhum outro tipo pode usá-la.
  constraint ck_subtipo_consumo_doacao check (
    (tipo = 'CONSUMO_DOACAO' and subtipo_consumo_doacao is not null)
    or
    (tipo <> 'CONSUMO_DOACAO' and subtipo_consumo_doacao is null)
  ),

  -- cliente/fornecedor é obrigatório em compra e nas duas formas de venda
  constraint ck_cliente_fornecedor_obrigatorio check (
    tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE')
    or cliente_fornecedor_id is not null
  ),

  -- causa da morte é obrigatória em lançamentos de morte
  constraint ck_causa_morte_obrigatoria check (
    tipo <> 'MORTE' or causa_morte is not null
  ),

  -- pasto_destino_id só existe em MUDANCA_PASTO (pasto novo, diferente
  -- do de origem) e TRANSFERENCIA (pasto na fazenda de destino)
  constraint ck_pasto_destino check (
    (tipo = 'MUDANCA_PASTO' and pasto_destino_id is not null and pasto_destino_id <> pasto_id)
    or
    (tipo = 'TRANSFERENCIA' and pasto_destino_id is not null)
    or
    (tipo not in ('MUDANCA_PASTO', 'TRANSFERENCIA') and pasto_destino_id is null)
  ),

  -- peso médio obrigatório em toda movimentação, exceto Mudança de
  -- Pasto (peso opcional lá — se não informado, o lote continua com o
  -- último peso conhecido). Adicionada NOT VALID na migração 028 pra
  -- não quebrar lançamentos antigos sem peso já existentes.
  constraint ck_peso_medio_obrigatorio check (
    tipo = 'MUDANCA_PASTO' or peso_medio_kg is not null
  ),

  -- ---------------------------------------------------------------
  -- RESTRIÇÕES DE PLAUSIBILIDADE BIOLÓGICA E FINANCEIRA
  -- ---------------------------------------------------------------

  constraint ck_peso_medio_positivo check (peso_medio_kg is null or peso_medio_kg > 0),
  constraint ck_peso_total_positivo check (peso_total_kg is null or peso_total_kg > 0),
  constraint ck_peso_morto_positivo check (peso_morto_kg is null or peso_morto_kg > 0),
  -- carcaça não pode pesar mais que o animal vivo
  constraint ck_peso_morto_nao_excede_vivo check (
    peso_morto_kg is null or peso_total_kg is null or peso_morto_kg <= peso_total_kg
  ),
  constraint ck_rendimento_carcaca_positivo check (
    rendimento_carcaca_pct is null or rendimento_carcaca_pct > 0
  ),
  -- venda abate exige peso morto ou rendimento de carcaça — sem isso o
  -- cálculo de arroba (fn_calcular_valores_movimentacao) cairia no
  -- fallback de peso vivo/30, que embute uma suposição de 50% de
  -- rendimento sem o usuário saber. Outros tipos comerciais (compra,
  -- venda em pé, consumo/doação) continuam livres pra usar esse
  -- fallback quando o rendimento real não é conhecido.
  constraint ck_venda_abate_peso_morto_ou_rendimento check (
    tipo <> 'VENDA_ABATE' or peso_morto_kg is not null or rendimento_carcaca_pct is not null
  ),
  constraint ck_valor_arroba_positivo check (valor_arroba is null or valor_arroba > 0),
  constraint ck_valor_cabeca_positivo check (valor_cabeca is null or valor_cabeca > 0),
  constraint ck_valor_kg_positivo check (valor_kg is null or valor_kg > 0),
  constraint ck_valor_total_positivo check (valor_total is null or valor_total > 0),
  -- lançamento registra um evento que já aconteceu — não pode ser no futuro
  constraint ck_data_nao_futura check (data <= current_date)
);

create index idx_mov_fazenda_data on movimentacoes_rebanho(fazenda_id, data);
create index idx_mov_tipo on movimentacoes_rebanho(tipo);
create index idx_mov_categoria on movimentacoes_rebanho(categoria_id);
create index idx_mov_transf_origem on movimentacoes_rebanho(fazenda_origem_id);
create index idx_mov_transf_destino on movimentacoes_rebanho(fazenda_destino_id);
create index idx_mov_grupo_lancamento on movimentacoes_rebanho(grupo_lancamento_id) where grupo_lancamento_id is not null;
alter table movimentacoes_rebanho enable row level security;
create policy movimentacoes_rebanho_por_conta on movimentacoes_rebanho for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- no máximo um SALDO_INICIAL por fazenda+categoria+pasto — evita
-- duplicidade antes da confirmação (a trava de edição/exclusão cuida do
-- "depois"). Pasto entra na constraint (migração 067) pra permitir o modo
-- "Saldo por Pasto" — a mesma categoria pode legitimamente ter uma linha
-- em cada pasto onde tem cabeças; fn_saldo_categoria/fn_saldo_categoria_
-- pasto já somam "total da fazenda = soma dos pastos" nativamente, sem
-- precisar de nenhuma outra mudança. Categoria bezerro que precisa
-- declarar mais de uma safra de nascimento dentro do mesmo total continua
-- com uma única linha por pasto — o detalhamento por safra é feito à
-- parte, em `saldo_inicial_safras` (migração 066), nunca duplicando a
-- linha-mãe.
create unique index uq_saldo_inicial_por_categoria
  on movimentacoes_rebanho (fazenda_id, categoria_id, pasto_id)
  where tipo = 'SALDO_INICIAL';

-- ---------------------------------------------------------------------
-- TRIGGER: cálculo automático de valores comerciais e rendimento
-- de carcaça, a partir do primeiro campo que o usuário preencher.
--
-- Convenção de fator de arroba confirmada nas fórmulas originais da
-- planilha (não é uma suposição):
--   - peso vivo (compra / venda em pé):  @ = peso_vivo_kg / 30
--   - peso morto/carcaça (venda abate / consumo-doação): @ = peso_morto_kg / 15
--
-- TRANSFERENCIA entra no mesmo cálculo: a planilha valoriza transferências
-- entre fazendas (para fins de rateio/contabilidade interna), então
-- aplicamos a mesma regra de peso vivo (fator 30) usada em compra/venda em pé.
--
-- Prioridade de resolução do valor_total quando mais de um campo de
-- preço vem preenchido: valor_total > valor_arroba > valor_cabeca > valor_kg.
-- Se quem lançar preencher direto o valor_total, ele é respeitado como
-- fonte da verdade e as 3 formas unitárias são recalculadas a partir dele.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- fn_calcular_peso_total_movimentacao — peso_total_kg é sempre
-- derivado de peso_medio_kg × quantidade, pra todo tipo de
-- movimentação (não só os comerciais). Roda antes de
-- fn_calcular_valores_movimentacao (ordem alfabética do nome do
-- trigger: "calcular_peso_total" < "calcular_valores"), já que esse
-- último usa peso_total_kg como entrada pro cálculo de arroba/valor.
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
-- fn_validar_lote_nascimento_bezerro (migração 030, ajustada na 031
-- pra exigir só safra_nascimento_ano_inicio, sem mês): Mudança de
-- Categoria nunca pode envolver categoria de bezerro (nem origem nem
-- destino — a única evolução de bezerro é o Desmame, e bezerro só
-- entra por Nascimento/Compra/Saldo Inicial). Desmame exige categoria
-- destino com era 08-12. Todo lançamento cuja categoria de origem é
-- bezerro exige safra_nascimento_ano_inicio preenchido. Roda pra
-- frente a partir de agora, sem invalidar retroativamente lançamentos
-- antigos (mesmo princípio do peso médio na migração 028).
-- ---------------------------------------------------------------------

create or replace function fn_validar_lote_nascimento_bezerro()
returns trigger as $$
declare
  v_origem_bezerro  boolean;
  v_destino_bezerro boolean;
  v_era_destino     text;
begin
  v_origem_bezerro := fn_categoria_e_bezerro(new.categoria_id);
  v_destino_bezerro := new.categoria_destino_id is not null and fn_categoria_e_bezerro(new.categoria_destino_id);

  if new.tipo = 'MUDANCA_CATEGORIA' then
    if v_origem_bezerro or v_destino_bezerro then
      raise exception 'Mudança de Categoria não pode ser usada com categoria de bezerro — bezerros só evoluem de categoria pelo Desmame, e só entram no sistema por Nascimento, Compra ou Saldo Inicial.';
    end if;
    return new;
  end if;

  if new.tipo = 'DESMAME' then
    select era into v_era_destino from categorias_animal where id = new.categoria_destino_id;
    if v_era_destino is distinct from '08-12' then
      raise exception 'A categoria destino do Desmame precisa ter era 08-12.';
    end if;
  end if;

  if v_origem_bezerro and new.tipo in (
    'NASCIMENTO', 'COMPRA', 'SALDO_INICIAL',
    'MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA'
  ) then
    if new.safra_nascimento_ano_inicio is null then
      raise exception 'Informe a safra de nascimento do lote de bezerros envolvido.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_lote_nascimento_bezerro
before insert or update on movimentacoes_rebanho
for each row execute function fn_validar_lote_nascimento_bezerro();

create or replace function fn_calcular_valores_movimentacao()
returns trigger as $$
declare
  v_fator_arroba  numeric;
  v_peso_base     numeric;
  v_total_arrobas numeric;
begin
  if new.tipo not in ('COMPRA','VENDA_PE','VENDA_ABATE','CONSUMO_DOACAO','TRANSFERENCIA') then
    return new;
  end if;

  -- 1) par rendimento de carcaça <-> peso morto (exige peso_total_kg = peso vivo)
  if new.peso_total_kg is not null and new.peso_total_kg > 0 then
    if new.peso_morto_kg is not null and new.rendimento_carcaca_pct is null then
      new.rendimento_carcaca_pct := round(new.peso_morto_kg / new.peso_total_kg * 100, 2);
    elsif new.rendimento_carcaca_pct is not null and new.peso_morto_kg is null then
      new.peso_morto_kg := round(new.peso_total_kg * new.rendimento_carcaca_pct / 100, 2);
    end if;
  end if;

  -- 2) base de cálculo da arroba
  if new.peso_morto_kg is not null and new.peso_morto_kg > 0 then
    v_peso_base := new.peso_morto_kg;
    v_fator_arroba := 15;
  elsif new.peso_total_kg is not null and new.peso_total_kg > 0 then
    v_peso_base := new.peso_total_kg;
    v_fator_arroba := 30;
  end if;

  if v_peso_base is not null then
    v_total_arrobas := v_peso_base / v_fator_arroba;
  end if;

  -- 3) resolver valor_total a partir do primeiro preço unitário informado
  if new.valor_total is null then
    if new.valor_arroba is not null and v_total_arrobas is not null then
      new.valor_total := round(new.valor_arroba * v_total_arrobas, 2);
    elsif new.valor_cabeca is not null and new.quantidade is not null then
      new.valor_total := round(new.valor_cabeca * new.quantidade, 2);
    elsif new.valor_kg is not null and new.peso_total_kg is not null and new.peso_total_kg > 0 then
      new.valor_total := round(new.valor_kg * new.peso_total_kg, 2);
    end if;
  end if;

  -- 4) com valor_total resolvido, preencher as 3 formas unitárias
  if new.valor_total is not null then
    if v_total_arrobas is not null and v_total_arrobas > 0 then
      new.valor_arroba := round(new.valor_total / v_total_arrobas, 2);
    end if;
    if new.quantidade is not null and new.quantidade > 0 then
      new.valor_cabeca := round(new.valor_total / new.quantidade, 2);
    end if;
    if new.peso_total_kg is not null and new.peso_total_kg > 0 then
      new.valor_kg := round(new.valor_total / new.peso_total_kg, 2);
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_calcular_valores_movimentacao
before insert or update on movimentacoes_rebanho
for each row execute function fn_calcular_valores_movimentacao();

-- ---------------------------------------------------------------------
-- SALDO DE CATEGORIA — saldo (entradas - saídas) de uma categoria numa
-- fazenda até uma data (inclusive). Usada tanto pela tela de lançamento
-- (exibir saldo disponível em tempo real) quanto pela trigger de
-- validação abaixo. Espelha a mesma lógica de vw_estoque_rebanho, mas
-- parametrizada por data em vez de "saldo atual total".
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria(p_fazenda_id uuid, p_categoria_id uuid, p_data date)
returns integer
language plpgsql
stable
as $$
declare
  v_entradas int;
  v_saidas   int;
begin
  select coalesce(sum(quantidade), 0) into v_entradas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_pasto: mesma ideia de fn_saldo_categoria, mas
-- refinada pro nível de pasto (controle de rebanho por pasto — opt-in
-- único via configuracoes.controla_pasto, vale pro grupo inteiro).
-- Fazenda que não usa esse controle só
-- tem o pasto "Geral", então o saldo por pasto coincide com o saldo da
-- fazenda inteira nesse caso. Toda fazenda+categoria tem
-- fn_saldo_categoria(fazenda, categoria, data) = soma, sobre todos os
-- pastos da fazenda, de fn_saldo_categoria_pasto(fazenda, categoria,
-- pasto, data) — MUDANCA_PASTO sempre entra e sai dentro da mesma
-- fazenda, então não altera esse total.
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_pasto(p_fazenda_id uuid, p_categoria_id uuid, p_pasto_id uuid, p_data date)
returns integer
language plpgsql
stable
as $$
declare
  v_entradas int;
  v_saidas   int;
begin
  select coalesce(sum(quantidade), 0) into v_entradas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_destino_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'MUDANCA_CATEGORIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- saldo_inicial_safras (migração 066): detalhamento por safra de
-- nascimento dentro de uma única linha de Saldo Inicial de categoria
-- bezerro — o rebanho inicial pode legitimamente conter animais de mais
-- de uma safra (ex.: uma leva nascida no fim da safra anterior, outra já
-- na corrente), mas a linha de Saldo Inicial continua sendo uma só por
-- categoria (nunca duplicada) — mesmo princípio já usado em
-- `lancamento_baixas`/`movimentacao_ajustes` (tabela filha detalha uma
-- linha-mãe, sem duplicá-la). Quando existe detalhamento, a soma das
-- safras precisa ser exatamente igual à quantidade total da linha-mãe —
-- checado por uma trigger de constraint adiável (só valida no fim da
-- transação, pra permitir apagar-e-reinserir todo o detalhamento de uma
-- vez, mesmo padrão "apaga e reinsere" já usado noutras listas filhas).
-- Limitação aceita conscientemente: a trajetória de edição/exclusão
-- (fn_checar_saldo_lote_futuro/fn_delta_para_par_lote) ainda lê só a
-- safra/quantidade da própria linha-mãe, não o detalhamento — editar ou
-- excluir uma linha de Saldo Inicial já dividida por safra não tem, por
-- enquanto, a mesma proteção fina de "isso deixaria uma safra específica
-- negativa no futuro" que o resto do sistema tem (Saldo Inicial
-- normalmente não é reeditado depois de confirmado; extensão futura se
-- fizer falta na prática).
-- ---------------------------------------------------------------------

create table saldo_inicial_safras (
  id                          uuid primary key default gen_random_uuid(),
  conta_id                    uuid not null references contas(id) default fn_conta_atual(),
  movimentacao_id             uuid not null references movimentacoes_rebanho(id) on delete cascade,
  safra_nascimento_ano_inicio int not null,
  quantidade                  int not null check (quantidade > 0),
  created_at                  timestamptz not null default now(),
  constraint uq_saldo_inicial_safra unique (movimentacao_id, safra_nascimento_ano_inicio)
);

create index idx_saldo_inicial_safras_movimentacao on saldo_inicial_safras(movimentacao_id);

alter table saldo_inicial_safras enable row level security;
create policy saldo_inicial_safras_por_conta on saldo_inicial_safras for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create or replace function fn_validar_saldo_inicial_safra()
returns trigger as $$
declare
  v_tipo         tipo_movimentacao;
  v_categoria_id uuid;
begin
  select tipo, categoria_id into v_tipo, v_categoria_id
  from movimentacoes_rebanho where id = new.movimentacao_id;

  if v_tipo is null then
    raise exception 'Movimentação % não encontrada.', new.movimentacao_id;
  end if;

  if v_tipo <> 'SALDO_INICIAL' then
    raise exception 'Detalhamento por safra só é permitido em lançamentos de Saldo Inicial.';
  end if;

  if not fn_categoria_e_bezerro(v_categoria_id) then
    raise exception 'Detalhamento por safra só é permitido em categorias de bezerro.';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_saldo_inicial_safra
before insert or update on saldo_inicial_safras
for each row execute function fn_validar_saldo_inicial_safra();

create or replace function fn_validar_soma_saldo_inicial_safra()
returns trigger as $$
declare
  v_movimentacao_id uuid;
  v_total_categoria  int;
  v_soma_safras      int;
begin
  v_movimentacao_id := coalesce(new.movimentacao_id, old.movimentacao_id);

  select quantidade into v_total_categoria
  from movimentacoes_rebanho where id = v_movimentacao_id;

  select coalesce(sum(quantidade), 0) into v_soma_safras
  from saldo_inicial_safras where movimentacao_id = v_movimentacao_id;

  if v_soma_safras <> v_total_categoria then
    raise exception 'A soma das quantidades por safra (%) precisa ser igual à quantidade total da categoria (%).',
      v_soma_safras, v_total_categoria;
  end if;

  return null;
end;
$$ language plpgsql;

create constraint trigger trg_validar_soma_saldo_inicial_safra
after insert or update or delete on saldo_inicial_safras
deferrable initially deferred
for each row execute function fn_validar_soma_saldo_inicial_safra();

create or replace function fn_validar_quantidade_saldo_inicial_com_safra()
returns trigger as $$
declare
  v_soma_safras int;
begin
  if new.tipo <> 'SALDO_INICIAL' then
    return new;
  end if;

  select coalesce(sum(quantidade), 0) into v_soma_safras
  from saldo_inicial_safras where movimentacao_id = new.id;

  if v_soma_safras > 0 and v_soma_safras <> new.quantidade then
    raise exception 'A quantidade da categoria (%) não bate com a soma do detalhamento por safra (%). Ajuste o detalhamento também.',
      new.quantidade, v_soma_safras;
  end if;

  return new;
end;
$$ language plpgsql;

create constraint trigger trg_validar_quantidade_saldo_inicial_com_safra
after update of quantidade on movimentacoes_rebanho
deferrable initially deferred
for each row execute function fn_validar_quantidade_saldo_inicial_com_safra();

-- ---------------------------------------------------------------------
-- fn_salvar_linha_saldo_inicial (migração 068, ajustada na 069): grava a
-- linha-mãe de Saldo Inicial e o detalhamento por safra na mesma
-- transação — as triggers de constraint adiáveis acima só ajudam dentro
-- de UMA transação, e o supabase-js faz cada update/insert/delete como
-- sua própria transação (auto-commit); editar linha-mãe + detalhamento em
-- duas chamadas separadas falharia no meio (a 1ª chamada sozinha já
-- checa "soma do detalhamento antigo bate com a quantidade nova?", que
-- só ficaria certo depois da 2ª chamada, que nunca chegaria a rodar).
-- conta_id do insert filho (migração 069) é lido explicitamente da
-- linha-mãe já resolvida, em vez de depender de novo do default
-- fn_conta_atual() — mesma classe de bug já corrigida nas migrações
-- 063/064 (o default só resolve com auth.uid() de uma sessão normal).
-- ---------------------------------------------------------------------

create or replace function fn_salvar_linha_saldo_inicial(
  p_movimentacao_id uuid,
  p_fazenda_id uuid,
  p_categoria_id uuid,
  p_data date,
  p_quantidade int,
  p_peso_medio_kg numeric,
  p_peso_total_kg numeric,
  p_pasto_id uuid,
  p_proprietario_id uuid,
  p_safra_coluna int,
  p_detalhamento jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_conta_id uuid;
begin
  if p_movimentacao_id is not null then
    update movimentacoes_rebanho set
      quantidade = p_quantidade,
      peso_medio_kg = p_peso_medio_kg,
      peso_total_kg = p_peso_total_kg,
      pasto_id = p_pasto_id,
      proprietario_id = p_proprietario_id,
      data = p_data,
      safra_nascimento_ano_inicio = p_safra_coluna
    where id = p_movimentacao_id;
    v_id := p_movimentacao_id;
  else
    insert into movimentacoes_rebanho (
      fazenda_id, categoria_id, tipo, data, quantidade, peso_medio_kg, peso_total_kg,
      pasto_id, proprietario_id, safra_nascimento_ano_inicio
    ) values (
      p_fazenda_id, p_categoria_id, 'SALDO_INICIAL', p_data, p_quantidade, p_peso_medio_kg, p_peso_total_kg,
      p_pasto_id, p_proprietario_id, p_safra_coluna
    )
    returning id into v_id;
  end if;

  select conta_id into v_conta_id from movimentacoes_rebanho where id = v_id;

  delete from saldo_inicial_safras where movimentacao_id = v_id;

  if coalesce(jsonb_array_length(p_detalhamento), 0) > 1 then
    insert into saldo_inicial_safras (conta_id, movimentacao_id, safra_nascimento_ano_inicio, quantidade)
    select v_conta_id, v_id, (item->>'safra')::int, (item->>'quantidade')::int
    from jsonb_array_elements(p_detalhamento) as item;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_safra (migração 030, renomeada/simplificada na
-- 031 — só safra, sem mês): mesmo princípio de fn_saldo_categoria_pasto,
-- mas pra dimensão do lote de nascimento, independente do pasto — as
-- duas dimensões (pasto e lote) não se cruzam. Entrada de SALDO_INICIAL
-- passa a vir do detalhamento por safra (saldo_inicial_safras, migração
-- 066) quando ele existir, em vez da coluna safra_nascimento_ano_inicio
-- da própria linha.
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_safra(
  p_fazenda_id uuid, p_categoria_id uuid, p_safra int, p_data date
)
returns integer
language plpgsql
stable
as $$
declare
  v_entradas int;
  v_saidas   int;
begin
  select coalesce(sum(quantidade), 0) into v_entradas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo in ('NASCIMENTO', 'COMPRA') and data <= p_data
    union all
    -- SALDO_INICIAL sem detalhamento por safra (o caso comum): usa a
    -- própria coluna da linha, como sempre.
    select m.quantidade from movimentacoes_rebanho m
    where m.fazenda_id = p_fazenda_id and m.categoria_id = p_categoria_id
      and m.safra_nascimento_ano_inicio = p_safra
      and m.tipo = 'SALDO_INICIAL' and m.data <= p_data
      and not exists (select 1 from saldo_inicial_safras s where s.movimentacao_id = m.id)
    union all
    -- SALDO_INICIAL de categoria bezerro com detalhamento por safra
    -- (migração 066): a quantidade de cada safra vem do detalhamento,
    -- não da quantidade total da linha.
    select s.quantidade from saldo_inicial_safras s
    join movimentacoes_rebanho m on m.id = s.movimentacao_id
    where m.fazenda_id = p_fazenda_id and m.categoria_id = p_categoria_id
      and s.safra_nascimento_ano_inicio = p_safra
      and m.tipo = 'SALDO_INICIAL' and m.data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio = p_safra
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_proprietario (migração 044): mesma receita de
-- fn_saldo_categoria_safra, por (fazenda, categoria, proprietario) —
-- dimensão independente, não cruza com pasto.
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_proprietario(
  p_fazenda_id uuid, p_categoria_id uuid, p_proprietario_id uuid, p_data date
)
returns integer
language plpgsql
stable
as $$
declare
  v_entradas int;
  v_saidas   int;
begin
  select coalesce(sum(quantidade), 0) into v_entradas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_saldo_categoria_pasto_proprietario (migração 051): cruza pasto ×
-- proprietário — mesma lista de tipos que fn_saldo_categoria_proprietario
-- já usa (Mudança de Categoria/Desmame não entram como entrada; DESMAME
-- conta só como saída), acrescida de MUDANCA_PASTO (que passa a exigir
-- proprietario_id quando há 2+ proprietários, pra não perder a atribuição
-- de dono ao mudar cabeças de pasto dentro da mesma fazenda). Necessária
-- porque as checagens separadas por pasto e por proprietário não bastam
-- sozinhas pra impedir que a combinação específica (pasto+dono) fique
-- negativa — ver fn_validar_saldo_categoria.
-- ---------------------------------------------------------------------

create or replace function fn_saldo_categoria_pasto_proprietario(
  p_fazenda_id uuid, p_categoria_id uuid, p_pasto_id uuid, p_proprietario_id uuid, p_data date
)
returns integer
language plpgsql
stable
as $$
declare
  v_entradas int;
  v_saidas   int;
begin
  select coalesce(sum(quantidade), 0) into v_entradas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_destino_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_destino_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) e;

  select coalesce(sum(quantidade), 0) into v_saidas
  from (
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_origem_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select quantidade from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id and pasto_id = p_pasto_id
      and proprietario_id = p_proprietario_id
      and tipo = 'MUDANCA_PASTO' and data <= p_data
  ) s;

  return v_entradas - v_saidas;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_lotes_nascimento_disponiveis (migração 030, simplificada na 031):
-- lista os lotes (safra) com saldo > 0 numa fazenda+categoria numa
-- data — alimenta o seletor de lote no frontend (Desmame e as demais
-- movimentações de saída — Morte, Venda em Pé, Venda Abate,
-- Consumo/Doação, Transferência — quando a categoria envolvida é
-- bezerro), mostrando só a quantidade disponível, sem peso (não faz
-- sentido pro lote de origem).
-- ---------------------------------------------------------------------

create or replace function fn_lotes_nascimento_disponiveis(p_fazenda_id uuid, p_categoria_id uuid, p_data date)
returns table(safra int, saldo int)
language plpgsql
stable
as $$
begin
  return query
  select t.safra_nascimento_ano_inicio, s.saldo
  from (
    select distinct safra_nascimento_ano_inicio
    from movimentacoes_rebanho
    where fazenda_id = p_fazenda_id and categoria_id = p_categoria_id
      and safra_nascimento_ano_inicio is not null
      and data <= p_data
  ) t
  cross join lateral (
    select fn_saldo_categoria_safra(p_fazenda_id, p_categoria_id, t.safra_nascimento_ano_inicio, p_data) as saldo
  ) s
  where s.saldo > 0
  order by t.safra_nascimento_ano_inicio;
end;
$$;

-- ---------------------------------------------------------------------
-- TRIGGER: impede lançar mais animais do que o saldo disponível na
-- categoria de origem, na data do lançamento. Não se aplica a
-- NASCIMENTO/COMPRA (só entram animais). TRANSFERENCIA checa o saldo
-- na fazenda de origem. Checa tanto o saldo da fazenda inteira quanto
-- o saldo do pasto específico (este último cobre também MUDANCA_PASTO,
-- que não mexe no saldo da fazenda — só desloca dentro dela). Quando o
-- lançamento carrega safra de nascimento (lote de bezerro), checa
-- também o saldo do lote (migração 030/031) — defesa em profundidade
-- junto com fn_validar_lote_nascimento_bezerro.
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_categoria()
returns trigger as $$
declare
  v_fazenda_checagem   uuid;
  v_saldo              int;
  v_saldo_pasto        int;
  v_saldo_lote         int;
  v_saldo_proprietario int;
  v_saldo_pasto_prop   int;
  v_nome_pasto         text;
  v_fazenda_lote       uuid;
begin
  if new.tipo in ('VENDA_PE', 'VENDA_ABATE', 'MORTE', 'CONSUMO_DOACAO', 'DESMAME', 'MUDANCA_CATEGORIA') then
    v_fazenda_checagem := new.fazenda_id;
  elsif new.tipo = 'TRANSFERENCIA' then
    v_fazenda_checagem := new.fazenda_origem_id;
  elsif new.tipo = 'MUDANCA_PASTO' then
    v_fazenda_checagem := null;
  else
    return new;
  end if;

  if v_fazenda_checagem is not null then
    v_saldo := fn_saldo_categoria(v_fazenda_checagem, new.categoria_id, new.data);
    if v_saldo < new.quantidade then
      raise exception 'Saldo insuficiente: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_saldo, new.data, new.quantidade;
    end if;
  end if;

  v_saldo_pasto := fn_saldo_categoria_pasto(new.fazenda_id, new.categoria_id, new.pasto_id, new.data);
  if v_saldo_pasto < new.quantidade then
    select nome into v_nome_pasto from pastos where id = new.pasto_id;
    raise exception 'Saldo insuficiente no pasto %: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
      v_nome_pasto, v_saldo_pasto, new.data, new.quantidade;
  end if;

  if new.safra_nascimento_ano_inicio is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA') then
    v_fazenda_lote := case when new.tipo = 'TRANSFERENCIA' then new.fazenda_origem_id else new.fazenda_id end;
    v_saldo_lote := fn_saldo_categoria_safra(
      v_fazenda_lote, new.categoria_id, new.safra_nascimento_ano_inicio, new.data
    );
    if v_saldo_lote < new.quantidade then
      raise exception 'Saldo insuficiente no lote de nascimento (safra %/%): % cabeça(s) disponível(is) na data %, mas % foi(ram) solicitada(s).',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        v_saldo_lote, new.data, new.quantidade;
    end if;
  end if;

  if new.proprietario_id is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA') then
    v_fazenda_lote := case when new.tipo = 'TRANSFERENCIA' then new.fazenda_origem_id else new.fazenda_id end;
    v_saldo_proprietario := fn_saldo_categoria_proprietario(v_fazenda_lote, new.categoria_id, new.proprietario_id, new.data);
    if v_saldo_proprietario < new.quantidade then
      raise exception 'Saldo insuficiente para esse proprietário: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_saldo_proprietario, new.data, new.quantidade;
    end if;
  end if;

  -- checagem cruzada pasto × proprietário (migração 051) — cobre
  -- MUDANCA_PASTO também (checagem de saldo simples acima não cobre
  -- esse tipo pra fazenda/proprietário, só pra pasto puro)
  if new.proprietario_id is not null
     and new.tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME', 'TRANSFERENCIA', 'MUDANCA_PASTO') then
    v_saldo_pasto_prop := fn_saldo_categoria_pasto_proprietario(new.fazenda_id, new.categoria_id, new.pasto_id, new.proprietario_id, new.data);
    if v_saldo_pasto_prop < new.quantidade then
      select nome into v_nome_pasto from pastos where id = new.pasto_id;
      raise exception 'Saldo insuficiente para esse proprietário no pasto %: % cabeça(s) disponível(is) dessa categoria na data %, mas % foi(ram) solicitada(s).',
        v_nome_pasto, v_saldo_pasto_prop, new.data, new.quantidade;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_saldo_categoria
before insert on movimentacoes_rebanho
for each row execute function fn_validar_saldo_categoria();

-- ---------------------------------------------------------------------
-- TRIGGER: garante que pasto_id (e pasto_destino_id, quando usado)
-- realmente pertencem à fazenda do lançamento — em TRANSFERENCIA,
-- pasto_id precisa ser da fazenda de origem e pasto_destino_id da
-- fazenda de destino.
-- ---------------------------------------------------------------------

create or replace function fn_validar_pasto_pertence_fazenda()
returns trigger as $$
declare
  v_fazenda_pasto         uuid;
  v_fazenda_pasto_destino uuid;
  v_fazenda_esperada      uuid;
begin
  select m.fazenda_id into v_fazenda_pasto
  from pastos p join modulos m on m.id = p.modulo_id
  where p.id = new.pasto_id;

  v_fazenda_esperada := coalesce(new.fazenda_origem_id, new.fazenda_id);
  if v_fazenda_pasto is distinct from v_fazenda_esperada then
    raise exception 'O pasto selecionado não pertence à fazenda do lançamento.';
  end if;

  if new.pasto_destino_id is not null then
    select m.fazenda_id into v_fazenda_pasto_destino
    from pastos p join modulos m on m.id = p.modulo_id
    where p.id = new.pasto_destino_id;

    v_fazenda_esperada := coalesce(new.fazenda_destino_id, new.fazenda_id);
    if v_fazenda_pasto_destino is distinct from v_fazenda_esperada then
      raise exception 'O pasto de destino selecionado não pertence à fazenda de destino do lançamento.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_pasto_pertence_fazenda
before insert or update on movimentacoes_rebanho
for each row execute function fn_validar_pasto_pertence_fazenda();

-- ---------------------------------------------------------------------
-- TRIGGER: exige que o saldo inicial da fazenda já tenha sido
-- confirmado antes de aceitar qualquer outra movimentação. Isso evita
-- que o usuário comece a lançar movimentações reais sem antes definir
-- o ponto de partida do rebanho, o que geraria contas erradas depois.
-- TRANSFERENCIA exige o saldo inicial confirmado tanto na fazenda de
-- origem quanto na de destino.
-- ---------------------------------------------------------------------

create or replace function fn_validar_saldo_inicial_obrigatorio()
returns trigger as $$
declare
  v_fazenda_ids uuid[];
  v_fazenda_id  uuid;
  v_confirmado  boolean;
begin
  if new.tipo = 'SALDO_INICIAL' then
    return new;
  end if;

  if new.tipo = 'TRANSFERENCIA' then
    v_fazenda_ids := array[new.fazenda_origem_id, new.fazenda_destino_id];
  else
    v_fazenda_ids := array[new.fazenda_id];
  end if;

  foreach v_fazenda_id in array v_fazenda_ids
  loop
    select saldo_inicial_confirmado into v_confirmado from fazendas where id = v_fazenda_id;
    if not coalesce(v_confirmado, false) then
      raise exception 'É necessário preencher e confirmar o saldo inicial da fazenda antes de lançar outras movimentações.';
    end if;
  end loop;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_saldo_inicial_obrigatorio
before insert on movimentacoes_rebanho
for each row execute function fn_validar_saldo_inicial_obrigatorio();

-- ---------------------------------------------------------------------
-- EDIÇÃO DE MOVIMENTAÇÕES — permitida em qualquer campo, mas seguindo
-- a mesma regra independente do que for editado:
--   1. sem movimentação futura da mesma categoria/fazenda -> edita direto
--   2. com movimentação futura, mas saldo continua ok -> aviso pedindo
--      confirmação (a confirmação em si é responsabilidade da tela;
--      aqui só fornecemos a informação pra decidir)
--   3. com movimentação futura e o saldo ficaria negativo em algum
--      ponto da trajetória -> bloqueado (com raise exception)
--
-- fn_delta_para_par: quanto uma movimentação (dados soltos, não uma
-- linha da tabela) contribui pra um par (fazenda, categoria) específico.
-- Mesma lógica de entrada/saída já usada em fn_saldo_categoria, só que
-- reorganizada pra responder "quanto ESSA linha contribui pra ESSE par"
-- em vez de "somando todas as linhas, qual o saldo desse par".
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par(
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_pasto_id uuid,
  p_pasto_destino_id uuid,
  p_quantidade int,
  p_par_fazenda_id uuid,
  p_par_categoria_id uuid,
  p_par_pasto_id uuid
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo in ('MUDANCA_CATEGORIA', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_destino_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo = 'TRANSFERENCIA' then
    if p_fazenda_origem_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_destino_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_destino_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo = 'MUDANCA_PASTO' then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_destino_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  end if;
  return v_total;
end;
$$;

-- fn_checar_edicao_movimentacao: dado o id de uma movimentação existente
-- e os valores NOVOS propostos (podem ser iguais ou diferentes dos
-- atuais, em qualquer campo), diz se existem movimentações futuras da(s)
-- mesma(s) categoria/fazenda envolvida(s) e se a edição deixaria o saldo
-- negativo em algum ponto da trajetória — reaproveitando fn_saldo_categoria
-- (já testada) como base, apenas ajustada para "trocar" a contribuição
-- antiga pela nova em cada data candidata.
create or replace function fn_checar_edicao_movimentacao(
  p_id uuid,
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_pasto_id uuid,
  p_pasto_destino_id uuid,
  p_data date,
  p_quantidade int
) returns table(
  tem_movimentacoes_futuras boolean,
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  categoria_saldo_negativo text,
  pasto_saldo_negativo text,
  saldo_minimo int
)
language plpgsql
as $$
declare
  v_old            movimentacoes_rebanho%rowtype;
  v_par            record;
  v_data           date;
  v_saldo          int;
  v_pior_saldo     int;
  v_pior_data      date;
  v_pior_categoria uuid;
  v_pior_pasto     uuid;
  v_tem_futuras    boolean := false;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  -- cada trio (fazenda, categoria, pasto) abaixo é uma combinação que a
  -- linha, nos valores antigos OU propostos, pode afetar como
  -- entrada/saída (ver fn_saldo_categoria_pasto / fn_delta_para_par).
  -- Checar a trajetória em todo trio afetado no nível de pasto cobre
  -- também o nível de fazenda inteira, já que
  -- fn_saldo_categoria(fazenda, categoria, data) é a soma, sobre todos
  -- os pastos da fazenda, de fn_saldo_categoria_pasto(fazenda,
  -- categoria, pasto, data).
  for v_par in (
    select distinct fazenda_id, categoria_id, pasto_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_id),
        (v_old.fazenda_id, v_old.categoria_destino_id, v_old.pasto_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.pasto_destino_id),
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_destino_id),
        (p_fazenda_id, p_categoria_id, p_pasto_id),
        (p_fazenda_id, p_categoria_destino_id, p_pasto_id),
        (p_fazenda_destino_id, p_categoria_id, p_pasto_destino_id),
        (p_fazenda_id, p_categoria_id, p_pasto_destino_id)
    ) as t(fazenda_id, categoria_id, pasto_id)
    where fazenda_id is not null and categoria_id is not null and pasto_id is not null
  )
  loop
    if exists (
      select 1 from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data > p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
        )
    ) then
      v_tem_futuras := true;
    end if;

    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_pasto(v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.categoria_destino_id,
                                    v_old.pasto_id, v_old.pasto_destino_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id,
                                    p_pasto_id, p_pasto_destino_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
        v_pior_categoria := v_par.categoria_id;
        v_pior_pasto := v_par.pasto_id;
      end if;
    end loop;
  end loop;

  tem_movimentacoes_futuras := v_tem_futuras;
  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  select nome into categoria_saldo_negativo from categorias_animal where id = v_pior_categoria;
  select nome into pasto_saldo_negativo from pastos where id = v_pior_pasto;

  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_delta_para_par_lote / fn_checar_saldo_lote_futuro (migração 030,
-- simplificadas na 031 — só safra, sem mês): mesma lógica de
-- trajetória de fn_delta_para_par / fn_checar_edicao_movimentacao, só
-- que pra dimensão do lote de nascimento, mantida deliberadamente
-- SEPARADA (função e assinatura próprias) pra não mexer nos call sites
-- já existentes da versão por pasto. Só é chamada pelas triggers de
-- bloqueio abaixo — não é exposta ao frontend pro aviso de confirmação
-- "há lançamentos futuros" (só a versão por pasto tem esse aviso);
-- violação na dimensão do lote vira exceção direta do banco.
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par_lote(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_safra int, p_quantidade int,
  p_par_fazenda_id uuid, p_par_categoria_id uuid, p_par_safra int
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_safra is null or p_par_safra is null or p_safra <> p_par_safra then
    return 0;
  end if;

  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo = 'TRANSFERENCIA' then
    if p_fazenda_origem_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_destino_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  end if;
  return v_total;
end;
$$;

create or replace function fn_checar_saldo_lote_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_safra int, p_data date, p_quantidade int
) returns table(saldo_ficaria_negativo boolean, data_saldo_negativo date, saldo_minimo int)
language plpgsql
as $$
declare
  v_old        movimentacoes_rebanho%rowtype;
  v_par        record;
  v_data       date;
  v_saldo      int;
  v_pior_saldo int;
  v_pior_data  date;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id, safra from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.safra_nascimento_ano_inicio),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.safra_nascimento_ano_inicio),
        (p_fazenda_id, p_categoria_id, p_safra),
        (p_fazenda_destino_id, p_categoria_id, p_safra)
    ) as t(fazenda_id, categoria_id, safra)
    where fazenda_id is not null and categoria_id is not null and safra is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.safra_nascimento_ano_inicio = v_par.safra
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_safra(v_par.fazenda_id, v_par.categoria_id, v_par.safra, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_lote(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.safra_nascimento_ano_inicio, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.safra)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_lote(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_safra, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.safra)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
      end if;
    end loop;
  end loop;

  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_delta_para_par_proprietario / fn_checar_saldo_proprietario_futuro
-- (migração 044): mesma receita de fn_delta_para_par_lote/
-- fn_checar_saldo_lote_futuro, agora pra dimensão (fazenda, categoria,
-- proprietario) — checagem adicional dentro das triggers de editar/
-- apagar já existentes.
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par_proprietario(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_proprietario_id uuid, p_quantidade int,
  p_par_fazenda_id uuid, p_par_categoria_id uuid, p_par_proprietario_id uuid
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_proprietario_id is null or p_par_proprietario_id is null or p_proprietario_id <> p_par_proprietario_id then
    return 0;
  end if;

  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo = 'TRANSFERENCIA' then
    if p_fazenda_origem_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_destino_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  end if;
  return v_total;
end;
$$;

create or replace function fn_checar_saldo_proprietario_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_proprietario_id uuid, p_data date, p_quantidade int
) returns table(saldo_ficaria_negativo boolean, data_saldo_negativo date, saldo_minimo int)
language plpgsql
as $$
declare
  v_old        movimentacoes_rebanho%rowtype;
  v_par        record;
  v_data       date;
  v_saldo      int;
  v_pior_saldo int;
  v_pior_data  date;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id, proprietario_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.proprietario_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.proprietario_id),
        (p_fazenda_id, p_categoria_id, p_proprietario_id),
        (p_fazenda_destino_id, p_categoria_id, p_proprietario_id)
    ) as t(fazenda_id, categoria_id, proprietario_id)
    where fazenda_id is not null and categoria_id is not null and proprietario_id is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.proprietario_id = v_par.proprietario_id
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_proprietario(v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_proprietario(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.proprietario_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_proprietario(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_proprietario_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.proprietario_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
      end if;
    end loop;
  end loop;

  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- fn_delta_para_par_pasto_proprietario / fn_checar_saldo_pasto_
-- proprietario_futuro (migração 051): mesma receita de
-- fn_delta_para_par_proprietario/fn_checar_saldo_proprietario_futuro,
-- agora pra dimensão cruzada (fazenda, categoria, pasto, proprietario) —
-- checagem adicional dentro das triggers de editar/apagar já existentes,
-- mesmo padrão "defesa em profundidade silenciosa" (sem aviso amigável
-- no frontend, só bloqueio direto do banco).
-- ---------------------------------------------------------------------

create or replace function fn_delta_para_par_pasto_proprietario(
  p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_pasto_id uuid, p_pasto_destino_id uuid, p_proprietario_id uuid, p_quantidade int,
  p_par_fazenda_id uuid, p_par_categoria_id uuid, p_par_pasto_id uuid, p_par_proprietario_id uuid
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_proprietario_id is null or p_par_proprietario_id is null or p_proprietario_id <> p_par_proprietario_id then
    return 0;
  end if;

  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo = 'TRANSFERENCIA' then
    if p_fazenda_origem_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_destino_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_destino_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo = 'MUDANCA_PASTO' then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_id = p_par_pasto_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id and p_pasto_destino_id = p_par_pasto_id then
      v_total := v_total + p_quantidade;
    end if;
  end if;
  return v_total;
end;
$$;

create or replace function fn_checar_saldo_pasto_proprietario_futuro(
  p_id uuid, p_tipo tipo_movimentacao, p_fazenda_id uuid, p_fazenda_origem_id uuid, p_fazenda_destino_id uuid,
  p_categoria_id uuid, p_pasto_id uuid, p_pasto_destino_id uuid, p_proprietario_id uuid, p_data date, p_quantidade int
) returns table(saldo_ficaria_negativo boolean, data_saldo_negativo date, saldo_minimo int)
language plpgsql
as $$
declare
  v_old        movimentacoes_rebanho%rowtype;
  v_par        record;
  v_data       date;
  v_saldo      int;
  v_pior_saldo int;
  v_pior_data  date;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id, pasto_id, proprietario_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_id, v_old.proprietario_id),
        (v_old.fazenda_destino_id, v_old.categoria_id, v_old.pasto_destino_id, v_old.proprietario_id),
        (v_old.fazenda_id, v_old.categoria_id, v_old.pasto_destino_id, v_old.proprietario_id),
        (p_fazenda_id, p_categoria_id, p_pasto_id, p_proprietario_id),
        (p_fazenda_destino_id, p_categoria_id, p_pasto_destino_id, p_proprietario_id),
        (p_fazenda_id, p_categoria_id, p_pasto_destino_id, p_proprietario_id)
    ) as t(fazenda_id, categoria_id, pasto_id, proprietario_id)
    where fazenda_id is not null and categoria_id is not null and pasto_id is not null and proprietario_id is not null
  )
  loop
    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and m.proprietario_id = v_par.proprietario_id
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_id = v_par.pasto_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id and m.pasto_destino_id = v_par.pasto_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria_pasto_proprietario(v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_par.proprietario_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par_pasto_proprietario(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.pasto_id, v_old.pasto_destino_id, v_old.proprietario_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_par.proprietario_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par_pasto_proprietario(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_pasto_id, p_pasto_destino_id, p_proprietario_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id, v_par.pasto_id, v_par.proprietario_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
      end if;
    end loop;
  end loop;

  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  return next;
end;
$$;

-- trigger de bloqueio (defesa em profundidade — a tela já deve chamar
-- fn_checar_edicao_movimentacao antes de mandar o UPDATE, pra mostrar o
-- aviso de confirmação; esta trigger garante que mesmo sem passar pela
-- tela, nunca é possível gravar uma edição que deixe saldo negativo)
create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check            record;
  v_check_lote       record;
  v_check_prop       record;
  v_check_pasto_prop record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
    new.categoria_id, new.categoria_destino_id, new.pasto_id, new.pasto_destino_id,
    new.data, new.quantidade
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível editar: o saldo da categoria % no pasto % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.pasto_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  if new.safra_nascimento_ano_inicio is not null then
    select * into v_check_lote from fn_checar_saldo_lote_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.safra_nascimento_ano_inicio, new.data, new.quantidade
    );
    if v_check_lote.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo do lote de nascimento (safra %/%) ficaria negativo (%) em %.',
        new.safra_nascimento_ano_inicio, new.safra_nascimento_ano_inicio + 1,
        v_check_lote.saldo_minimo, v_check_lote.data_saldo_negativo;
    end if;
  end if;

  if new.proprietario_id is not null then
    select * into v_check_prop from fn_checar_saldo_proprietario_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.proprietario_id, new.data, new.quantidade
    );
    if v_check_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo desse proprietário ficaria negativo (%) em %.',
        v_check_prop.saldo_minimo, v_check_prop.data_saldo_negativo;
    end if;

    select * into v_check_pasto_prop from fn_checar_saldo_pasto_proprietario_futuro(
      old.id, new.tipo, new.fazenda_id, new.fazenda_origem_id, new.fazenda_destino_id,
      new.categoria_id, new.pasto_id, new.pasto_destino_id, new.proprietario_id, new.data, new.quantidade
    );
    if v_check_pasto_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível editar: o saldo desse proprietário no pasto ficaria negativo (%) em %.',
        v_check_pasto_prop.saldo_minimo, v_check_pasto_prop.data_saldo_negativo;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_validar_edicao_movimentacao
before update on movimentacoes_rebanho
for each row execute function fn_validar_edicao_movimentacao();

-- ---------------------------------------------------------------------
-- EXCLUSÃO DE MOVIMENTAÇÕES — mesma proteção de trajetória da edição,
-- só que pra DELETE: simula "essa linha deixa de existir" chamando
-- fn_checar_edicao_movimentacao com quantidade 0 (contribuição vira
-- zero em fn_delta_para_par não importa o tipo), e bloqueia se em
-- algum ponto da trajetória o saldo ficaria negativo sem ela.
-- ---------------------------------------------------------------------

create or replace function fn_validar_delete_movimentacao()
returns trigger as $$
declare
  v_check_pasto_prop record;
  v_check      record;
  v_check_lote record;
  v_check_prop record;
begin
  select * into v_check from fn_checar_edicao_movimentacao(
    old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
    old.categoria_id, old.categoria_destino_id, old.pasto_id, old.pasto_destino_id,
    old.data, 0
  );

  if v_check.saldo_ficaria_negativo then
    raise exception 'Não é possível excluir: o saldo da categoria % no pasto % ficaria negativo (%) em %.',
      v_check.categoria_saldo_negativo, v_check.pasto_saldo_negativo, v_check.saldo_minimo, v_check.data_saldo_negativo;
  end if;

  if old.safra_nascimento_ano_inicio is not null then
    select * into v_check_lote from fn_checar_saldo_lote_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.safra_nascimento_ano_inicio, old.data, 0
    );
    if v_check_lote.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo do lote de nascimento (safra %/%) ficaria negativo (%) em %.',
        old.safra_nascimento_ano_inicio, old.safra_nascimento_ano_inicio + 1,
        v_check_lote.saldo_minimo, v_check_lote.data_saldo_negativo;
    end if;
  end if;

  if old.proprietario_id is not null then
    select * into v_check_prop from fn_checar_saldo_proprietario_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.proprietario_id, old.data, 0
    );
    if v_check_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo desse proprietário ficaria negativo (%) em %.',
        v_check_prop.saldo_minimo, v_check_prop.data_saldo_negativo;
    end if;

    select * into v_check_pasto_prop from fn_checar_saldo_pasto_proprietario_futuro(
      old.id, old.tipo, old.fazenda_id, old.fazenda_origem_id, old.fazenda_destino_id,
      old.categoria_id, old.pasto_id, old.pasto_destino_id, old.proprietario_id, old.data, 0
    );
    if v_check_pasto_prop.saldo_ficaria_negativo then
      raise exception 'Não é possível excluir: o saldo desse proprietário no pasto ficaria negativo (%) em %.',
        v_check_pasto_prop.saldo_minimo, v_check_pasto_prop.data_saldo_negativo;
    end if;
  end if;

  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_movimentacao
before delete on movimentacoes_rebanho
for each row execute function fn_validar_delete_movimentacao();

-- =====================================================================
-- 2b. PESAGENS — atribuição periódica de peso, desacoplada do fluxo
-- de estoque (não afeta vw_estoque_rebanho nem passa pela trigger acima).
-- Alimenta indicadores como GMD (ganho médio diário) ao longo do tempo.
-- =====================================================================

create table pesagens (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references contas(id) default fn_conta_atual(),
  fazenda_id      uuid not null references fazendas(id),
  categoria_id    uuid not null references categorias_animal(id),
  -- sempre obrigatório — mesmo princípio do pasto em movimentacoes_rebanho:
  -- fazenda sem controla_pasto só tem o pasto "Geral" pra escolher, e o
  -- formulário preenche isso sozinho.
  pasto_id        uuid not null references pastos(id),
  data            date not null,
  peso_medio_kg   numeric(10,2) not null check (peso_medio_kg > 0),
  observacao      text,
  usuario_id      uuid references usuarios(id),
  -- não nulo só pras pesagens compiladas automaticamente a partir de
  -- uma movimentação (ver fn_compilar_pesagem_movimentacao, migração
  -- 028) — pesagens lançadas manualmente na tela de Pesagens ficam
  -- com isso null. on delete cascade: apagar a movimentação apaga o
  -- registro de peso ligado a ela.
  movimentacao_id uuid references movimentacoes_rebanho(id) on delete cascade,
  created_at      timestamptz not null default now(),
  constraint uq_pesagens_movimentacao unique (movimentacao_id)
);

create index idx_pesagens_fazenda_categoria_pasto_data on pesagens(fazenda_id, categoria_id, pasto_id, data);
alter table pesagens enable row level security;
create policy pesagens_por_conta on pesagens for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- ---------------------------------------------------------------------
-- fn_relatorio_rebanho_por_pasto: fotografia do rebanho numa fazenda,
-- numa data (não um período — pasto é "onde os animais estão agora"),
-- cruzando fn_saldo_categoria_pasto (quantidade) com a pesagem mais
-- recente daquele pasto+categoria até aquela data (peso_medio_kg),
-- caindo pro peso de referência da categoria se aquele pasto
-- especificamente nunca foi pesado (não busca pesagem de outro pasto
-- da mesma fazenda — cada pasto é pesado à parte quando controla_pasto
-- está ligado). Pastos e categorias sem nenhum animal na data não
-- aparecem (mesmo princípio de "linha 100% zerada" já usado no
-- relatório de movimentação).
-- ---------------------------------------------------------------------

create or replace function fn_relatorio_rebanho_por_pasto(
  p_fazenda_id uuid, p_data date, p_proprietario_ids uuid[] default null
)
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
  v_prop       uuid;
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
      if p_proprietario_ids is null then
        v_qtd := fn_saldo_categoria_pasto(p_fazenda_id, v_categoria.id, v_pasto.id, p_data);
      else
        v_qtd := 0;
        foreach v_prop in array p_proprietario_ids
        loop
          v_qtd := v_qtd + fn_saldo_categoria_pasto_proprietario(p_fazenda_id, v_categoria.id, v_pasto.id, v_prop, p_data);
        end loop;
      end if;

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

-- ---------------------------------------------------------------------
-- fn_compilar_pesagem_movimentacao: toda movimentação salva com
-- peso_medio_kg cria/atualiza um registro em pesagens, ligado por
-- movimentacao_id — pesagens vira a fonte única de "peso mais recente"
-- pra relatórios, venha o dado de onde vier (lançamento manual em
-- Pesagens ou qualquer movimentação). Fazenda/categoria/pasto usados
-- são sempre os de "destino" quando existem (coalesce), senão os
-- campos únicos — cobre todos os tipos sem precisar de lógica por
-- tipo (mudança de categoria/desmame usam categoria_destino_id,
-- transferência usa fazenda/pasto_destino_id, mudança de pasto usa
-- pasto_destino_id). on delete cascade na FK cuida da limpeza quando a
-- movimentação é apagada; o UPDATE do trigger cobre edição (inclusive
-- apagar o peso de uma Mudança de Pasto, que remove o registro
-- compilado). Grava conta_id explicitamente (new.conta_id) em vez de
-- depender do default fn_conta_atual(), que resolve pelo auth.uid() da
-- sessão — funciona pra qualquer usuário logado normal, mas quebra pra
-- qualquer insert de movimentação feito fora de uma sessão de app
-- autenticada (ex.: script rodando com a chave service-role, sem
-- auth.uid() nenhum); mesmo bug já corrigido em fn_criar_modulo_pasto_geral
-- (migração 063), agora também aqui (migração 064).
-- ---------------------------------------------------------------------

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
    insert into pesagens (conta_id, fazenda_id, categoria_id, pasto_id, data, peso_medio_kg, movimentacao_id, observacao)
    values (new.conta_id, v_fazenda_id, v_categoria_id, v_pasto_id, new.data, new.peso_medio_kg, new.id,
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
-- próxima edição dela. Precisa checar se a movimentação AINDA EXISTE
-- (não só se movimentacao_id não é nulo): quando a movimentação de
-- origem é apagada, o on delete cascade dessa mesma FK dispara essa
-- trigger de novo pra limpar o registro compilado — nesse caso a
-- movimentação já não existe mais e a exclusão precisa ser permitida,
-- senão a cascata trava e a movimentação nem consegue ser apagada.
create or replace function fn_validar_delete_pesagem()
returns trigger as $$
begin
  if old.movimentacao_id is not null
     and exists (select 1 from movimentacoes_rebanho where id = old.movimentacao_id) then
    raise exception 'Esse peso foi registrado automaticamente por uma movimentação — edite ou exclua a movimentação para alterá-lo.';
  end if;
  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_pesagem
before delete on pesagens
for each row execute function fn_validar_delete_pesagem();

-- =====================================================================
-- 2c. AJUSTES FINANCEIROS — desconto/acréscimo lançados em cima do
-- valor bruto de uma movimentação comercial (COMPRA, VENDA_PE,
-- VENDA_ABATE, CONSUMO_DOACAO — as únicas com valor_total). Catálogo
-- reutilizável (ex.: "Frete", "Comissão") + itens lançados por
-- movimentação, permitindo vários por venda. Valor líquido nunca é
-- guardado — sempre calculado na hora (bruto - descontos + acréscimos)
-- pra nunca ficar dessincronizado se um item for editado/removido.
-- =====================================================================

create type tipo_ajuste_financeiro as enum ('DESCONTO', 'ACRESCIMO');

create table itens_ajuste_financeiro (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  nome       text not null,
  tipo       tipo_ajuste_financeiro not null,
  created_at timestamptz not null default now(),
  constraint uq_item_ajuste_nome_tipo unique (nome, tipo)
);
alter table itens_ajuste_financeiro enable row level security;
create policy itens_ajuste_financeiro_por_conta on itens_ajuste_financeiro for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table movimentacao_ajustes (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references contas(id) default fn_conta_atual(),
  movimentacao_id  uuid not null references movimentacoes_rebanho(id) on delete cascade,
  item_id          uuid not null references itens_ajuste_financeiro(id),
  valor            numeric(12,2) not null check (valor > 0),
  created_at       timestamptz not null default now()
);
create index idx_movimentacao_ajustes_movimentacao on movimentacao_ajustes(movimentacao_id);
alter table movimentacao_ajustes enable row level security;
create policy movimentacao_ajustes_por_conta on movimentacao_ajustes for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create or replace function fn_validar_ajuste_movimentacao_comercial()
returns trigger as $$
declare
  v_tipo tipo_movimentacao;
begin
  select tipo into v_tipo from movimentacoes_rebanho where id = new.movimentacao_id;
  if v_tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO') then
    raise exception 'Desconto/acréscimo só pode ser lançado em movimentações comerciais (compra, venda ou consumo/doação).';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_validar_ajuste_movimentacao_comercial
before insert on movimentacao_ajustes
for each row execute function fn_validar_ajuste_movimentacao_comercial();

-- =====================================================================
-- 3. FINANCEIRO
-- =====================================================================

-- Contas bancárias (Fase 2, migração 056) — catálogo pequeno e
-- extensível, mesmo princípio de itens_ajuste_financeiro/
-- subtipos_uso_area. Toda conta ganha automaticamente uma linha
-- "Dinheiro (em espécie)" (sistema=true, protegida contra exclusão)
-- via trigger abaixo.
create table contas_bancarias (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  nome       text not null,
  especie    boolean not null default false,
  sistema    boolean not null default false,
  ativo      boolean not null default true,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_conta_bancaria_nome unique (conta_id, nome)
);
alter table contas_bancarias enable row level security;
create policy contas_bancarias_por_conta on contas_bancarias for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create or replace function fn_criar_conta_bancaria_especie()
returns trigger as $$
begin
  insert into contas_bancarias (conta_id, nome, especie, sistema, ordem)
  values (new.id, 'Dinheiro (em espécie)', true, true, 0);
  return new;
end;
$$ language plpgsql;

create trigger trg_criar_conta_bancaria_especie
after insert on contas
for each row execute function fn_criar_conta_bancaria_especie();

-- Atividades Econômicas (migração 058) — dimensão de classificação
-- ortogonal ao plano de contas (que classifica o TIPO da despesa/
-- receita) e à Fazenda: classifica A QUAL NEGÓCIO o lançamento
-- pertence, pra famílias/fazendas que operam mais de uma atividade ao
-- mesmo tempo. Catálogo pequeno, mesmo molde de contas_bancarias.
create table atividades_economicas (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references contas(id) default fn_conta_atual(),
  nome       text not null,
  sistema    boolean not null default false,
  ativo      boolean not null default true,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_atividade_economica_nome unique (conta_id, nome)
);
alter table atividades_economicas enable row level security;
create policy atividades_economicas_por_conta on atividades_economicas for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- 14 sugestões comuns do meio rural, sempre INATIVAS por padrão —
-- diferente de outros seeds (categorias_animal, subtipos_uso_area),
-- que nascem ativos: aqui a lista inteira é só um cardápio de
-- possibilidades (a maioria das fazendas usa só 1-3 das 14), não um
-- ponto de partida universal — o usuário ativa só as que fazem
-- sentido pra ela.
create or replace function fn_seed_atividades_economicas_conta(p_conta_id uuid)
returns void
language plpgsql
as $$
begin
  insert into atividades_economicas (conta_id, nome, sistema, ativo, ordem)
  values
    (p_conta_id, 'Pecuária Campo', true, false, 1),
    (p_conta_id, 'Pecuária Genética', true, false, 2),
    (p_conta_id, 'Pecuária Confinamento', true, false, 3),
    (p_conta_id, 'Agricultura Anual', true, false, 4),
    (p_conta_id, 'Agricultura Permanente', true, false, 5),
    (p_conta_id, 'Silvicultura', true, false, 6),
    (p_conta_id, 'Imobiliária / Arrendamento', true, false, 7),
    (p_conta_id, 'Financiamento', true, false, 8),
    (p_conta_id, 'Haras', true, false, 9),
    (p_conta_id, 'Armazém', true, false, 10),
    (p_conta_id, 'Almoxarifado', true, false, 11),
    (p_conta_id, 'Fábrica de Ração', true, false, 12),
    (p_conta_id, 'Piscicultura', true, false, 13),
    (p_conta_id, 'Transportadora', true, false, 14);
end;
$$;

create or replace function fn_seed_atividades_economicas_conta_trigger()
returns trigger as $$
begin
  perform fn_seed_atividades_economicas_conta(new.id);
  return new;
end;
$$ language plpgsql;

create trigger trg_seed_atividades_economicas_conta
after insert on contas
for each row execute function fn_seed_atividades_economicas_conta_trigger();

-- Produto/Serviço: 4º campo do plano de contas, fora da numeração
-- Classe/Centro/Subcentro — catálogo próprio, sem seed nenhum (exceto
-- os 3 produtos-sistema pra integração com Movimentações, seedados
-- junto do plano de contas mais abaixo) — 100% cadastrado pelo
-- usuário, obrigatório em todo lançamento. subcentro_custo_id opcional
-- é a "pré-classificação padrão": escolher esse produto num lançamento
-- novo pré-preenche Tipo/Classe/Centro/Subcentro sozinho.
create table produtos_financeiros (
  id                 uuid primary key default gen_random_uuid(),
  conta_id           uuid not null references contas(id) default fn_conta_atual(),
  nome               text not null,
  subcentro_custo_id uuid references subcentros_custo(id),
  sistema            boolean not null default false,
  ativo              boolean not null default true,
  created_at         timestamptz not null default now(),
  constraint uq_produto_financeiro_nome unique (conta_id, nome)
);
alter table produtos_financeiros enable row level security;
create policy produtos_financeiros_por_conta on produtos_financeiros for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

create table lancamentos_financeiros (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references contas(id) default fn_conta_atual(),
  fazenda_id        uuid not null references fazendas(id),
  descricao         text not null,
  data              date not null,
  valor             numeric(14,2) not null,
  tipo              tipo_lancamento_financeiro not null,
  subcentro_id      uuid not null references subcentros_custo(id),
  produto_id        uuid not null references produtos_financeiros(id),
  status            status_lancamento_financeiro not null default 'CONFIRMADO',
  -- lançamento nascido de uma Compra/Venda em Movimentações (ver
  -- fn_compilar_lancamento_financeiro_movimentacao) — só editável
  -- reabrindo a movimentação de origem; on delete cascade cuida da
  -- limpeza quando a movimentação é apagada
  movimentacao_id   uuid unique references movimentacoes_rebanho(id) on delete cascade,
  -- correlação client-side entre as N linhas de um lançamento rateado
  -- entre fazendas (mesmo princípio de grupo_lancamento_id em
  -- movimentacoes_rebanho) — null pra lançamento avulso
  rateio_grupo_id   uuid,
  confirmado_por    uuid references usuarios_app(id),
  confirmado_em     timestamptz,
  -- Fase 2 (migração 056): fornecedor/cliente e proprietário do lote
  -- (mesmo cadastro unificado de pessoas já usado em Movimentações) —
  -- herdados automaticamente pra título vindo de movimentação (ver
  -- fn_compilar_lancamento_financeiro_movimentacao), opcionais/
  -- escolhidos manualmente pra lançamento manual
  pessoa_id         uuid references pessoas(id),
  proprietario_id   uuid references pessoas(id),
  numero_documento  text,
  -- migração 058 — dimensão opcional, ortogonal ao plano de contas;
  -- sempre null pra lançamento automático (Compra/Venda) nesta fase
  atividade_economica_id uuid references atividades_economicas(id),
  created_at        timestamptz not null default now()
);

create index idx_fin_fazenda_data on lancamentos_financeiros(fazenda_id, data);
create index idx_fin_subcentro on lancamentos_financeiros(subcentro_id);
create index idx_fin_status_pendente on lancamentos_financeiros(status) where status = 'PENDENTE';
create index idx_fin_rateio_grupo on lancamentos_financeiros(rateio_grupo_id) where rateio_grupo_id is not null;
alter table lancamentos_financeiros enable row level security;
create policy lancamentos_financeiros_por_conta on lancamentos_financeiros for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- Baixas (Fase 2, migração 056) — quando vence/foi pago, parcela, por
-- qual conta bancária. Um título sem nenhuma baixa é o comportamento
-- de sempre ("não rastreado"); N baixas = título parcelado. Nunca mexe
-- em lancamentos_financeiros/movimentacao_id — filha por lancamento_id,
-- sem afetar a unicidade que sustenta o registro compilado/travado.
create table lancamento_baixas (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references contas(id) default fn_conta_atual(),
  lancamento_id     uuid not null references lancamentos_financeiros(id) on delete cascade,
  numero_parcela    int not null default 1,
  total_parcelas    int not null default 1,
  data_vencimento   date,
  data_pagamento    date,
  valor             numeric(14,2) not null,
  conta_bancaria_id uuid references contas_bancarias(id),
  observacao        text,
  created_at        timestamptz not null default now(),
  constraint uq_lancamento_baixa_parcela unique (lancamento_id, numero_parcela)
);
create index idx_lancamento_baixas_lancamento on lancamento_baixas(lancamento_id);
create index idx_lancamento_baixas_aberto on lancamento_baixas(data_vencimento) where data_pagamento is null;
alter table lancamento_baixas enable row level security;
create policy lancamento_baixas_por_conta on lancamento_baixas for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- tipo do lançamento é sempre derivado do subcentro escolhido
-- (subcentro → centro → classe → tipo), nunca digitado manualmente —
-- mesmo princípio de campo derivado automaticamente já usado em
-- sexo/grupo_faixa_etaria de categoria de animal
create or replace function fn_resolver_tipo_lancamento_financeiro()
returns trigger as $$
begin
  select cf.tipo into new.tipo
  from subcentros_custo sc
  join centros_custo cc on cc.id = sc.centro_custo_id
  join classes_financeiras cf on cf.id = cc.classe_financeira_id
  where sc.id = new.subcentro_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_resolver_tipo_lancamento_financeiro
before insert or update of subcentro_id on lancamentos_financeiros
for each row execute function fn_resolver_tipo_lancamento_financeiro();

-- valor líquido de uma movimentação comercial — mesma fórmula já
-- usada no frontend (valorLiquido, components/relatorios/tipos.ts):
-- valor_total − soma(desconto) + soma(acréscimo)
create or replace function fn_valor_liquido_movimentacao(p_movimentacao_id uuid)
returns numeric
language sql
stable
as $$
  select m.valor_total
    - coalesce(sum(a.valor) filter (where i.tipo = 'DESCONTO'), 0)
    + coalesce(sum(a.valor) filter (where i.tipo = 'ACRESCIMO'), 0)
  from movimentacoes_rebanho m
  left join movimentacao_ajustes a on a.movimentacao_id = m.id
  left join itens_ajuste_financeiro i on i.id = a.item_id
  where m.id = p_movimentacao_id
  group by m.valor_total;
$$;

-- toda Compra/Venda em Pé/Venda Abate salva cria ou atualiza um
-- lançamento financeiro ligado por movimentacao_id, já classificado
-- automaticamente (via os 3 produtos-sistema seedados junto do plano
-- de contas) e sempre em status PENDENTE — precisa de confirmação
-- humana explícita na tela financeira antes de contar como oficial,
-- porque quem lança a movimentação no pecuário pode ser diferente de
-- quem controla o financeiro. Qualquer alteração posterior na
-- movimentação resincroniza o lançamento e volta o status pra
-- PENDENTE (exige nova conferência). Mesmo molde de
-- fn_compilar_pesagem_movimentacao, mais acima neste arquivo.
create or replace function fn_compilar_lancamento_financeiro_movimentacao()
returns trigger as $$
declare
  v_produto_sistema_nome text;
  v_descricao    text;
  v_subcentro_id uuid;
  v_categoria_nome text;
  v_produto_id   uuid;
  v_valor        numeric;
begin
  if new.tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE') then
    return new;
  end if;

  v_produto_sistema_nome := case new.tipo
    when 'COMPRA' then 'Gado — Compra'
    when 'VENDA_PE' then 'Gado — Venda em Pé'
    when 'VENDA_ABATE' then 'Gado — Venda Abate'
  end;

  v_descricao := case new.tipo
    when 'COMPRA' then 'Compra de gado'
    when 'VENDA_PE' then 'Venda em pé'
    when 'VENDA_ABATE' then 'Venda abate'
  end;

  -- subcentro de destino continua resolvido pelo tipo da movimentação,
  -- via o subcentro já guardado no produto-sistema histórico (nunca
  -- mais usado como produto_id, só como referência interna aqui) — é
  -- esse subcentro (Abate/Em pé/Rebanho), não o produto, quem carrega
  -- a distinção entre os 3 tipos de operação
  select subcentro_custo_id into v_subcentro_id
  from produtos_financeiros
  where conta_id = new.conta_id and nome = v_produto_sistema_nome and sistema = true;

  if v_subcentro_id is null then
    return new;
  end if;

  select nome into v_categoria_nome from categorias_animal where id = new.categoria_id;
  if v_categoria_nome is null then
    return new;
  end if;

  -- produto = a própria categoria do animal, sem sufixo de tipo —
  -- compartilhado entre Compra/Venda em Pé/Venda Abate da mesma
  -- categoria (a distinção entre os 3 já está no subcentro acima)
  select id into v_produto_id
  from produtos_financeiros
  where conta_id = new.conta_id and nome = v_categoria_nome;

  if v_produto_id is null then
    insert into produtos_financeiros (conta_id, nome, subcentro_custo_id, sistema)
    values (new.conta_id, v_categoria_nome, v_subcentro_id, true)
    returning id into v_produto_id;
  end if;

  v_valor := fn_valor_liquido_movimentacao(new.id);

  insert into lancamentos_financeiros
    (conta_id, fazenda_id, descricao, data, valor, subcentro_id, produto_id, movimentacao_id, status, pessoa_id, proprietario_id)
  values
    (new.conta_id, new.fazenda_id, v_descricao, new.data, v_valor, v_subcentro_id, v_produto_id, new.id, 'PENDENTE', new.cliente_fornecedor_id, new.proprietario_id)
  on conflict (movimentacao_id) do update set
    fazenda_id      = excluded.fazenda_id,
    data            = excluded.data,
    valor           = excluded.valor,
    subcentro_id    = excluded.subcentro_id,
    produto_id      = excluded.produto_id,
    status          = 'PENDENTE',
    confirmado_por  = null,
    confirmado_em   = null,
    pessoa_id       = excluded.pessoa_id,
    proprietario_id = excluded.proprietario_id;

  return new;
end;
$$ language plpgsql;

create trigger trg_compilar_lancamento_financeiro_movimentacao
after insert or update on movimentacoes_rebanho
for each row execute function fn_compilar_lancamento_financeiro_movimentacao();

-- desconto/acréscimo (movimentacao_ajustes) afeta o valor líquido mas
-- é uma tabela separada da movimentação em si — recalcula o
-- lançamento vinculado sempre que um ajuste muda, não só quando a
-- movimentação em si muda
create or replace function fn_recompilar_lancamento_por_ajuste()
returns trigger as $$
declare
  v_movimentacao_id uuid;
begin
  v_movimentacao_id := coalesce(new.movimentacao_id, old.movimentacao_id);
  update lancamentos_financeiros
  set valor          = fn_valor_liquido_movimentacao(v_movimentacao_id),
      status         = 'PENDENTE',
      confirmado_por = null,
      confirmado_em  = null
  where movimentacao_id = v_movimentacao_id;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger trg_recompilar_lancamento_por_ajuste
after insert or update or delete on movimentacao_ajustes
for each row execute function fn_recompilar_lancamento_por_ajuste();

-- lançamento compilado automaticamente não pode ser excluído direto
-- na tela financeira — mesmo molde de fn_validar_delete_pesagem, mais
-- acima neste arquivo, incluindo a mesma checagem de "a movimentação
-- ainda existe" pra não travar a cascata quando é a própria
-- movimentação que está sendo apagada
create or replace function fn_validar_delete_lancamento_financeiro()
returns trigger as $$
begin
  if old.movimentacao_id is not null
     and exists (select 1 from movimentacoes_rebanho where id = old.movimentacao_id) then
    raise exception 'Esse lançamento foi gerado automaticamente por uma movimentação — edite ou exclua a movimentação para alterá-lo.';
  end if;
  return old;
end;
$$ language plpgsql;

create trigger trg_validar_delete_lancamento_financeiro
before delete on lancamentos_financeiros
for each row execute function fn_validar_delete_lancamento_financeiro();

-- movimentação com lançamento financeiro vinculado já CONFIRMADO
-- (pago/recebido) não pode ser editada nem excluída direto no
-- pecuário — evita que uma edição resincronize o lançamento e desfaça
-- silenciosamente a confirmação (ver
-- fn_compilar_lancamento_financeiro_movimentacao acima). O usuário
-- precisa primeiro "Estornar" o lançamento em Financeiro (volta pra
-- PENDENTE) antes de editar/excluir a movimentação de origem.
create or replace function fn_validar_edicao_movimentacao_lancamento_confirmado()
returns trigger as $$
begin
  if exists (
    select 1 from lancamentos_financeiros
    where movimentacao_id = old.id and status = 'CONFIRMADO'
  ) then
    raise exception 'Esta movimentação tem um lançamento financeiro já confirmado. Estorne o lançamento em Financeiro antes de editar ou excluir esta movimentação.';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger trg_validar_edicao_movimentacao_lancamento_confirmado
before update or delete on movimentacoes_rebanho
for each row execute function fn_validar_edicao_movimentacao_lancamento_confirmado();

create table regras_rateio (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references contas(id) default fn_conta_atual(),
  centro_custo_id   uuid not null references centros_custo(id),
  criterio          criterio_rateio not null,
  -- fazendas contempladas pelo rateio; se null, aplica a todas as ativas
  fazendas_incluidas uuid[],
  percentual_fixo_json jsonb, -- usado quando criterio = PERCENTUAL_FIXO: {"fazenda_id": percentual}
  ativo             boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table regras_rateio enable row level security;
create policy regras_rateio_por_conta on regras_rateio for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- toda conta nova ganha o plano de contas inteiro (12 Classes, 35
-- Centros, 123 Subcentros, todos sistema=true) e os 3 produtos-sistema
-- pra integração com Movimentações — mesmo princípio de
-- fn_seed_categorias_subtipos_conta, mais acima neste arquivo. Função
-- separada de trigger (recebe p_conta_id) pra poder ser chamada tanto
-- pela trigger quanto no backfill manual de "Conta Principal" (ver bloco
-- de seed no fim deste arquivo — não dispara a trigger pelo mesmo
-- motivo de ordem: foi inserida antes desta trigger existir).
create or replace function fn_seed_plano_contas_conta(p_conta_id uuid)
returns void
language plpgsql
as $$
begin
  insert into classes_financeiras (conta_id, numero, nome, tipo, sistema, ordem)
  values
    (p_conta_id, 1, 'Receitas operacionais', 'CREDITO', true, 1),
    (p_conta_id, 2, 'Receitas não operacionais', 'CREDITO', true, 2),
    (p_conta_id, 3, 'Investimentos', 'DEBITO', true, 3),
    (p_conta_id, 4, 'Suporte à produção', 'DEBITO', true, 4),
    (p_conta_id, 5, 'Mão de obra permanente', 'DEBITO', true, 5),
    (p_conta_id, 6, 'Despesas com atividades produtivas', 'DEBITO', true, 6),
    (p_conta_id, 7, 'Prejuízo', 'DEBITO', true, 7),
    (p_conta_id, 8, 'Financiamentos créditos', 'CREDITO', true, 8),
    (p_conta_id, 9, 'Financiamentos débito', 'DEBITO', true, 9),
    (p_conta_id, 10, 'Almoxarifado', 'DEBITO', true, 10),
    (p_conta_id, 11, 'Aporte de capital', 'CREDITO', true, 11),
    (p_conta_id, 12, 'Dividendos', 'DEBITO', true, 12);

  insert into centros_custo (conta_id, classe_financeira_id, numero, nome, sistema, ordem)
  select p_conta_id, cf.id, v.numero, v.nome, true, v.numero
  from (values
    (1, 1, 'Cultura - Receita'), (1, 2, 'Rebanho'),
    (2, 1, 'Receitas Imobiliárias'), (2, 2, 'Receitas Parque de máquinas'), (2, 3, 'Receitas financeiras'),
    (2, 4, 'Receitas outros'), (2, 5, 'Vendas outros animais'),
    (3, 1, 'Investimentos em infraestrutura'), (3, 2, 'Investimentos em RH'),
    (3, 3, 'Rebanho Investimento'), (3, 4, 'Investimentos em outros animais'),
    (4, 1, 'Suporte à Produção Administração'), (4, 2, 'Manutenção da fazenda'),
    (4, 3, 'Suporte à Produção Parque de máquinas'), (4, 4, 'Outros animais'), (4, 5, 'Taxas e impostos'),
    (5, 1, 'Administração'), (5, 2, 'Cultura'), (5, 3, 'Parque de Máquinas'),
    (5, 4, 'Rebanho'), (5, 5, 'Manutenção da Fazenda'), (5, 6, 'Geral'),
    (6, 1, 'Culturas - Despesa'), (6, 2, 'Pastagens'), (6, 3, 'Insumos do rebanho'),
    (7, 1, 'Prejuízo Administração'), (7, 2, 'Prejuízo Almoxarifado'),
    (8, 1, 'Empréstimos sócios crédito'), (8, 2, 'Financiamentos créditos'),
    (9, 1, 'Empréstimos sócios débito'), (9, 2, 'Financiamentos débitos'),
    (10, 1, 'Almoxarifado'),
    (11, 1, 'Aporte de capital'),
    (12, 1, 'Dividendos')
  ) as v(classe_numero, numero, nome)
  join classes_financeiras cf on cf.conta_id = p_conta_id and cf.numero = v.classe_numero;

  insert into subcentros_custo (conta_id, centro_custo_id, numero, nome, sistema)
  select p_conta_id, cc.id, v.numero, v.nome, true
  from (values
    (1,1,1,'Culturas - Receita'), (1,1,2,'Receitas parceria agrícola'),
    (1,2,1,'Abate'), (1,2,2,'Em pé'), (1,2,3,'Sêmen e embriões'),

    (2,1,1,'Venda de Imóveis Rurais'), (2,1,2,'Venda de Imóveis Urbanos'),
    (2,1,3,'Aluguel de Imóveis Urbanos'), (2,1,4,'Arrendamento de Imóveis Rurais'),
    (2,2,1,'Venda veículos tratores e implementos'), (2,2,2,'Aluguel de Máquinas'),
    (2,3,1,'Rendimento financeiro juros'), (2,3,2,'Participação nos Lucros, Cooperativas e Outros (PLL)'),
    (2,4,1,'Madeiras e outros'), (2,4,2,'Recicláveis'), (2,4,3,'Vendas ferramentas e equipamentos'), (2,4,4,'Outros Créditos'),
    (2,5,1,'Venda tropa de reprodução'), (2,5,2,'Venda tropa de serviço'),

    (3,1,1,'Compra equipamentos informática, telefonia e comunicação'),
    (3,1,2,'Compra veículos, tratores e implementos'),
    (3,1,3,'Formação de pasto'), (3,1,4,'Imóveis rurais e urbanos'), (3,1,5,'Investimento em segurança'),
    (3,1,6,'Nova rede hidráulica'), (3,1,7,'Novas cercas'), (3,1,8,'Novas estradas e pontes'),
    (3,1,9,'Novas ferramentas e equipamentos'), (3,1,10,'Novas instalações pecuárias'),
    (3,1,11,'Novas instalações residenciais'), (3,1,12,'Novas construções, barracões e outros'),
    (3,1,13,'Novos móveis e eletrodomésticos'), (3,1,14,'Nova rede elétrica'),
    (3,1,15,'Projetos, medições e outros'), (3,1,16,'Reflorestamento'),
    (3,1,17,'Solo, contenções, destoca e recuperação'),
    (3,2,1,'Cursos e treinamentos'), (3,2,2,'Eventos e presentes'), (3,2,3,'Benefícios a funcionários'), (3,2,4,'Uniformes e EPI'),
    (3,3,1,'Rebanho'),
    (3,4,1,'Compra de aves'), (3,4,2,'Compra suínos'), (3,4,3,'Compra tropa de serviço'),
    (3,4,4,'Compra tropa reprodução'), (3,4,5,'Compra de ovinos'),

    (4,1,1,'Aluguéis e Condomínios'), (4,1,2,'Comunicação e energia da fazenda'),
    (4,1,3,'Contabilidade, jurídico, consultorias e sistemas'), (4,1,4,'Deslocamento, alimentação e hospedagem'),
    (4,1,5,'Despesa financeira'), (4,1,6,'Despesas casa sede'), (4,1,7,'Outras despesas administrativas'),
    (4,2,1,'Horta, pomar e jardins'), (4,2,2,'Manutenção, construções, barracões e outros'),
    (4,2,3,'Manutenção em segurança'), (4,2,4,'Manutenção estradas e pontes'),
    (4,2,5,'Manutenção ferramentas e equipamentos'), (4,2,6,'Manutenção informática'),
    (4,2,7,'Manutenção instalações pecuárias'), (4,2,8,'Manutenção instalações residenciais'),
    (4,2,9,'Manutenção móveis e eletrodomésticos'), (4,2,10,'Manutenção rede elétrica'),
    (4,2,11,'Manutenção rede hidráulica'), (4,2,12,'Manutenção de cercas'),
    (4,3,1,'Combustíveis'), (4,3,2,'Manutenção e conserto de máquinas e implementos'),
    (4,3,3,'Seguros, impostos, multas e outros'),
    (4,4,1,'Custeio de aves'), (4,4,2,'Custeio tropa reprodução'), (4,4,3,'Ovinos'), (4,4,4,'Suínos'), (4,4,5,'Tropa serviço'),
    (4,5,1,'Taxas e impostos. S/Venda'), (4,5,2,'Taxas e impostos S/Lucro'),
    (4,5,3,'Taxas, Impostos Sobre Propriedade, ITR, IPTU'),

    (5,1,1,'Salários e Encargos Administração'), (5,1,2,'Prêmios e benefícios Administração'), (5,1,3,'Rescisões e Acertos Administração'),
    (5,2,1,'Salários e Encargos Cultura'), (5,2,2,'Prêmios e benefícios Cultura'), (5,2,3,'Rescisões e Acertos Cultura'),
    (5,3,1,'Salários e Encargos Parque de Máquinas'), (5,3,2,'Prêmios e benefícios Parque de Máquinas'), (5,3,3,'Rescisões e Acertos Parque de Máquinas'),
    (5,4,1,'Salários e Encargos Rebanho'), (5,4,2,'Prêmios e benefícios Rebanho'), (5,4,3,'Rescisões e Acertos Rebanho'),
    (5,5,1,'Salários e Encargos Manutenção da Fazenda'), (5,5,2,'Prêmios e benefícios Manutenção da Fazenda'), (5,5,3,'Rescisões e Acertos Manutenção da Fazenda'),
    (5,6,1,'Salários e Encargos Geral'), (5,6,2,'Prêmios e benefícios Geral'), (5,6,3,'Rescisões e Acertos Geral'),

    (6,1,1,'Colheita e transporte'), (6,1,2,'Corretivos, fertilizantes e adubos'), (6,1,3,'Defensivos'),
    (6,1,4,'Despesas comerciais e outras'), (6,1,5,'Parceria agrícola'), (6,1,6,'Sementes/Mudas, tratamentos e serviços'),
    (6,1,7,'Energia para irrigação agrícola'), (6,1,8,'Aluguel de Máquinas Terceirizadas'), (6,1,9,'Preparo de Solo'),
    (6,2,1,'Arrendamento de pastagem'), (6,2,2,'Manutenção de pastagem'),
    (6,3,1,'Despesas comercias, fretes e comissões'), (6,3,2,'Identificação animal e rastreamento'), (6,3,3,'Nutrição'),
    (6,3,4,'Reprodução'), (6,3,5,'Sanidade'), (6,3,6,'Melhoramento genético'),
    (6,3,7,'Energia para irrigação pecuária'), (6,3,8,'Arrendamento de Rebanho'),

    (7,1,1,'Perda de investimentos financeiros'),
    (7,2,1,'Perda por inventário'),

    (8,1,1,'Empréstimos sócios crédito'),
    (8,2,1,'Financiamentos créditos'), (8,2,2,'Financiamentos cedidos créditos'),

    (9,1,1,'Empréstimos sócios débito'),
    (9,2,1,'Financiamentos débitos'), (9,2,2,'Financiamentos cedidos débitos'),

    (10,1,1,'Almoxarifado'),
    (11,1,1,'Aporte de capital'),
    (12,1,1,'Dividendos')
  ) as v(classe_numero, centro_numero, numero, nome)
  join classes_financeiras cf on cf.conta_id = p_conta_id and cf.numero = v.classe_numero
  join centros_custo cc on cc.classe_financeira_id = cf.id and cc.numero = v.centro_numero;

  -- inativos de propósito (migração 057): esses 3 produtos-sistema não
  -- são mais atribuídos a lançamento nenhum — servem só de referência
  -- interna pra fn_compilar_lancamento_financeiro_movimentacao resolver
  -- o subcentro de destino por tipo; o produto de verdade de uma
  -- Compra/Venda passa a ser a categoria do animal (criada sob demanda)
  insert into produtos_financeiros (conta_id, nome, subcentro_custo_id, sistema, ativo)
  select p_conta_id, v.nome, sc.id, true, false
  from (values
    ('Gado — Compra', 3, 3, 1),
    ('Gado — Venda em Pé', 1, 2, 2),
    ('Gado — Venda Abate', 1, 2, 1)
  ) as v(nome, classe_numero, centro_numero, subcentro_numero)
  join classes_financeiras cf on cf.conta_id = p_conta_id and cf.numero = v.classe_numero
  join centros_custo cc on cc.classe_financeira_id = cf.id and cc.numero = v.centro_numero
  join subcentros_custo sc on sc.centro_custo_id = cc.id and sc.numero = v.subcentro_numero;
end;
$$;

create or replace function fn_seed_plano_contas_conta_trigger()
returns trigger as $$
begin
  perform fn_seed_plano_contas_conta(new.id);
  return new;
end;
$$ language plpgsql;

create trigger trg_seed_plano_contas_conta
after insert on contas
for each row execute function fn_seed_plano_contas_conta_trigger();

-- =====================================================================
-- 4. VIEW — ESTOQUE CALCULADO POR FAZENDA / CATEGORIA
-- (substitui a digitação manual da aba "ESTOQUE PECUÁRIO")
-- =====================================================================

-- entradas/saidas são agregadas (group by) cada uma separadamente ANTES
-- de juntar com fazenda/categoria — join direto sem agregação prévia
-- gera produto cartesiano (fan-out) quando uma categoria tem múltiplos
-- lançamentos dos dois lados, inflando sum(quantidade) por um fator
-- multiplicativo (bug real, corrigido na migração 034).
create view vw_estoque_rebanho as
with entradas as (
  select fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL')
  union all
  select fazenda_destino_id as fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_destino_id as categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo in ('MUDANCA_CATEGORIA', 'DESMAME')
),
saidas as (
  select fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME')
  union all
  select fazenda_origem_id as fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo = 'TRANSFERENCIA'
  union all
  select fazenda_id, categoria_id, quantidade
  from movimentacoes_rebanho
  where tipo = 'MUDANCA_CATEGORIA'
),
entradas_agg as (
  select fazenda_id, categoria_id, sum(quantidade) as total
  from entradas
  group by fazenda_id, categoria_id
),
saidas_agg as (
  select fazenda_id, categoria_id, sum(quantidade) as total
  from saidas
  group by fazenda_id, categoria_id
)
select
  f.id as fazenda_id,
  f.nome as fazenda_nome,
  c.id as categoria_id,
  c.nome as categoria_nome,
  coalesce(e.total, 0) - coalesce(s.total, 0) as saldo_atual
from fazendas f
cross join categorias_animal c
left join entradas_agg e on e.fazenda_id = f.id and e.categoria_id = c.id
left join saidas_agg s on s.fazenda_id = f.id and s.categoria_id = c.id
where c.ativa = true and f.ativo = true;

-- ---------------------------------------------------------------------
-- fn_resumo_rebanho_atual (migração 033): alimenta o painel inicial —
-- uma linha por (fazenda, categoria) com saldo atual > 0, peso médio
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
-- 4b. RELATÓRIO DE MOVIMENTAÇÃO DE REBANHO — por fazenda e período,
-- uma linha por categoria com estoque inicial/final e a movimentação
-- detalhada por tipo. Mesma lógica de entrada/saída de vw_estoque_rebanho
-- e fn_saldo_categoria, só que sem acumular (soma só dentro do período)
-- e com o detalhamento por tipo que o relatório precisa mostrar.
-- =====================================================================

create or replace function fn_relatorio_movimentacao_rebanho(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date,
  p_proprietario_ids uuid[] default null
) returns table (
  categoria_id uuid,
  categoria_nome text,
  ordem_ciclo int,
  estoque_inicial int,
  entrada_nascimento int,
  entrada_compra int,
  entrada_desmame int,
  entrada_transferencia int,
  entrada_mudanca_categoria int,
  saida_morte int,
  saida_venda int,
  saida_desmame int,
  saida_transferencia int,
  saida_consumo_doacao int,
  saida_mudanca_categoria int,
  estoque_final int
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.nome,
    c.ordem_ciclo,
    -- saldo real das fazendas selecionadas na véspera da data inicial,
    -- somado a qualquer saldo inicial lançado dentro do próprio período
    -- filtrado (assim o relatório nunca mostra saldo inicial como se
    -- fosse uma "entrada" — ele sempre compõe o estoque inicial). Com
    -- filtro de proprietário (migração 044), soma por fazenda×proprietário
    -- via fn_saldo_categoria_proprietario em vez do saldo da fazenda
    -- inteira.
    case when p_proprietario_ids is null then
      coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_inicio - 1))
        from unnest(p_fazenda_ids) as f(id)), 0)
    else
      coalesce((select sum(fn_saldo_categoria_proprietario(f.id, c.id, pr.id, p_data_inicio - 1))
        from unnest(p_fazenda_ids) as f(id), unnest(p_proprietario_ids) as pr(id)), 0)
    end::int
    + coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'SALDO_INICIAL'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'NASCIMENTO'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'COMPRA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    -- transferência só conta como entrada/saída do grupo quando cruza a
    -- fronteira do grupo selecionado; transferência 100% interna (origem
    -- e destino ambas no grupo) não muda o total e não aparece aqui
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_destino_id = any(p_fazenda_ids) and not (m.fazenda_origem_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_destino_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MORTE'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo in ('VENDA_PE', 'VENDA_ABATE')
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'DESMAME'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_origem_id = any(p_fazenda_ids) and not (m.fazenda_destino_id = any(p_fazenda_ids))
        and m.categoria_id = c.id and m.tipo = 'TRANSFERENCIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'CONSUMO_DOACAO'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    coalesce((select sum(m.quantidade) from movimentacoes_rebanho m
      where m.fazenda_id = any(p_fazenda_ids) and m.categoria_id = c.id and m.tipo = 'MUDANCA_CATEGORIA'
        and m.data between p_data_inicio and p_data_fim
        and (p_proprietario_ids is null or m.proprietario_id = any(p_proprietario_ids))), 0)::int,
    case when p_proprietario_ids is null then
      coalesce((select sum(fn_saldo_categoria(f.id, c.id, p_data_fim))
        from unnest(p_fazenda_ids) as f(id)), 0)
    else
      coalesce((select sum(fn_saldo_categoria_proprietario(f.id, c.id, pr.id, p_data_fim))
        from unnest(p_fazenda_ids) as f(id), unnest(p_proprietario_ids) as pr(id)), 0)
    end::int
  from categorias_animal c
  -- sem filtro de ativa aqui de propósito: uma categoria inativada
  -- some dos formulários de lançamento, mas o histórico dela precisa
  -- continuar aparecendo em relatórios de períodos em que teve
  -- movimentação real. Linhas totalmente zeradas (categoria nunca usada
  -- no período, ativa ou não) são filtradas no frontend, não aqui.
  order by c.ordem_ciclo, c.nome;
end;
$$;

-- =====================================================================
-- 4c. RELATÓRIO DE LOTAÇÃO — rebanho médio, peso médio (ponderado dia a
-- dia), área média em Pecuária e lotação por mês.
-- =====================================================================

-- fn_estoque_rebanho_na_data: mesma lógica corrigida de vw_estoque_rebanho
-- (entradas/saidas agregadas antes do join, sem fan-out), parametrizada
-- por data e por uma lista de fazendas (soma direto, sem quebrar por
-- fazenda). Sem filtro de ativa/ativo de propósito — relatório histórico.
create or replace function fn_estoque_rebanho_na_data(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(categoria_id uuid, quantidade int)
language sql
stable
as $$
  with entradas as (
    select fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') and data <= p_data
    union all
    select fazenda_destino_id as fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select fazenda_id, categoria_destino_id as categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo in ('MUDANCA_CATEGORIA', 'DESMAME') and data <= p_data
  ),
  saidas as (
    select fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'DESMAME') and data <= p_data
    union all
    select fazenda_origem_id as fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo = 'TRANSFERENCIA' and data <= p_data
    union all
    select fazenda_id, categoria_id, quantidade, proprietario_id
    from movimentacoes_rebanho
    where tipo = 'MUDANCA_CATEGORIA' and data <= p_data
  ),
  entradas_agg as (
    select categoria_id, sum(quantidade) as total
    from entradas
    where fazenda_id = any(p_fazenda_ids)
      and (p_proprietario_ids is null or proprietario_id = any(p_proprietario_ids))
    group by categoria_id
  ),
  saidas_agg as (
    select categoria_id, sum(quantidade) as total
    from saidas
    where fazenda_id = any(p_fazenda_ids)
      and (p_proprietario_ids is null or proprietario_id = any(p_proprietario_ids))
    group by categoria_id
  )
  select
    c.id,
    (coalesce(e.total, 0) - coalesce(s.total, 0))::int
  from categorias_animal c
  left join entradas_agg e on e.categoria_id = c.id
  left join saidas_agg s on s.categoria_id = c.id
$$;

-- fn_indicadores_rebanho_dia: cabeças totais e peso vivo total das
-- fazendas selecionadas numa data — o "valor do dia" que
-- fn_relatorio_lotacao_mensal integra dia a dia (mesmo princípio de
-- fn_area_media_ponderada, aplicado a rebanho/peso em vez de área). Peso
-- resolvido = pesagem mais recente da categoria naquela(s) fazenda(s)
-- até a data, caindo pro peso de referência. p_proprietario_ids
-- (migração 062, default null) filtra só a quantidade — peso médio de
-- uma categoria não depende de quem é o dono, então pesagens nunca são
-- filtradas por proprietário.
create or replace function fn_indicadores_rebanho_dia(
  p_fazenda_ids uuid[], p_data date, p_proprietario_ids uuid[] default null
)
returns table(headcount int, peso_vivo_total numeric)
language sql
stable
as $$
  select
    coalesce(sum(e.quantidade), 0)::int,
    coalesce(sum(e.quantidade * coalesce(
      (select p.peso_medio_kg from pesagens p
       where p.fazenda_id = any(p_fazenda_ids) and p.categoria_id = e.categoria_id and p.data <= p_data
       order by p.data desc limit 1),
      c.peso_referencia_kg
    )), 0)
  from fn_estoque_rebanho_na_data(p_fazenda_ids, p_data, p_proprietario_ids) e
  join categorias_animal c on c.id = e.categoria_id
  where e.quantidade > 0
$$;

-- fn_relatorio_lotacao_mensal: uma linha por mês do período filtrado,
-- com rebanho médio (integrado dia a dia), peso médio (ponderado dia a
-- dia — não só a última pesagem), área média em Pecuária (reaproveitando
-- fn_area_media_ponderada) e dias_no_mes (pro frontend derivar o resumo
-- do período inteiro ponderando pelos dias de cada mês, mesmo princípio
-- já usado em fn_relatorio_distribuicao_area pra área). p_proprietario_ids
-- (migração 062, default null) alimenta os Relatórios Financeiros
-- (Desembolso R$/cab./mês) — repassado direto pra fn_indicadores_rebanho_dia.
create or replace function fn_relatorio_lotacao_mensal(
  p_fazenda_ids uuid[],
  p_data_inicio date,
  p_data_fim date,
  p_proprietario_ids uuid[] default null
) returns table(
  mes int,
  ano int,
  rebanho_medio numeric,
  peso_medio numeric,
  area_media numeric,
  dias_no_mes int
)
language plpgsql
as $$
declare
  v_mes_inicio date := date_trunc('month', p_data_inicio)::date;
  v_mes_fim    date;
  v_janela_ini date;
  v_janela_fim date;
  v_dia        date;
  v_soma_headcount numeric;
  v_soma_peso_vivo numeric;
  v_dias       int;
  v_area_media numeric;
  v_tipo_pecuaria_id uuid;
  v_ind        record;
begin
  select id into v_tipo_pecuaria_id from tipos_uso_area where nome = 'Pecuária';

  while v_mes_inicio <= p_data_fim loop
    v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;
    v_janela_ini := greatest(v_mes_inicio, p_data_inicio);
    v_janela_fim := least(v_mes_fim, p_data_fim);

    v_soma_headcount := 0;
    v_soma_peso_vivo := 0;
    v_dias := 0;

    for v_dia in select generate_series(v_janela_ini, v_janela_fim, interval '1 day')::date
    loop
      select * into v_ind from fn_indicadores_rebanho_dia(p_fazenda_ids, v_dia, p_proprietario_ids);
      v_soma_headcount := v_soma_headcount + v_ind.headcount;
      v_soma_peso_vivo := v_soma_peso_vivo + v_ind.peso_vivo_total;
      v_dias := v_dias + 1;
    end loop;

    select coalesce(sum(fn_area_media_ponderada(f.id, v_tipo_pecuaria_id, v_janela_ini, v_janela_fim)), 0)
      into v_area_media
    from unnest(p_fazenda_ids) as f(id);

    return query select
      extract(month from v_mes_inicio)::int,
      extract(year from v_mes_inicio)::int,
      case when v_dias > 0 then round(v_soma_headcount / v_dias, 2) else 0 end,
      case when v_soma_headcount > 0 then round(v_soma_peso_vivo / v_soma_headcount, 2) else null end,
      v_area_media,
      (v_janela_fim - v_janela_ini + 1)::int;

    v_mes_inicio := (v_mes_inicio + interval '1 month')::date;
  end loop;
end;
$$;

-- =====================================================================
-- 6. SEED — grupos, papéis e categorias padrão do sistema
-- =====================================================================

insert into grupos_categoria (nome, ordem) values
  ('BEZERRO', 1),
  ('JOVEM', 2),
  ('ADULTO', 3);

insert into grupos_categoria_papel (nome, sexo, ordem) values
  ('Bezerras Mamando', 'FEMEA', 1),
  ('Bezerros Mamando', 'MACHO', 2),
  ('Novilhas', 'FEMEA', 3),
  ('Garrotes e Bois', 'MACHO', 4),
  ('Matrizes em Reprodução', 'FEMEA', 5),
  ('Matrizes Descarte', 'FEMEA', 6),
  ('Touros', 'MACHO', 7),
  ('Outros', null, 8);

-- categorias do sistema (sistema = true): pré-cadastradas, não podem ser
-- renomeadas/reclassificadas/excluídas pelo usuário. grupo_id (Grupo
-- Faixa Etária) é preenchido automaticamente pela trigger
-- fn_calcular_atributos_categoria a partir da era informada aqui.
-- categorias_animal é conta-scoped (migração 046) — esse seed vale só
-- pra "Conta Principal" (inserida antes de fn_seed_categorias_subtipos_
-- conta existir, ver comentário logo acima daquela trigger); toda conta
-- nova criada depois (onboarding de Suporte, migração 049) recebe esse
-- mesmo seed sozinha via essa trigger, mesmo princípio já usado pro
-- módulo/pasto "Geral" de toda fazenda nova.
insert into categorias_animal (conta_id, nome, grupo_categoria_papel_id, sexo, era, ordem_ciclo, sistema)
select (select id from contas limit 1), 'Bezerra 00 a 08 Meses', p.id, 'FEMEA'::sexo_categoria, '00-08', 1, true from grupos_categoria_papel p where p.nome = 'Bezerras Mamando'
union all
select (select id from contas limit 1), 'Bezerro 00 a 08 Meses', p.id, 'MACHO'::sexo_categoria, '00-08', 2, true from grupos_categoria_papel p where p.nome = 'Bezerros Mamando'
union all
select (select id from contas limit 1), 'Novilha 08 a 12 Meses', p.id, 'FEMEA'::sexo_categoria, '08-12', 3, true from grupos_categoria_papel p where p.nome = 'Novilhas'
union all
select (select id from contas limit 1), 'Novilha 12 a 24 Meses', p.id, 'FEMEA'::sexo_categoria, '12-24', 4, true from grupos_categoria_papel p where p.nome = 'Novilhas'
union all
select (select id from contas limit 1), 'Novilha 24 a 36 Meses', p.id, 'FEMEA'::sexo_categoria, '24-36', 5, true from grupos_categoria_papel p where p.nome = 'Novilhas'
union all
select (select id from contas limit 1), 'Garrote 08 a 12 Meses', p.id, 'MACHO'::sexo_categoria, '08-12', 6, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select (select id from contas limit 1), 'Garrote 12 a 24 Meses', p.id, 'MACHO'::sexo_categoria, '12-24', 7, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select (select id from contas limit 1), 'Boi 24 a 36 Meses', p.id, 'MACHO'::sexo_categoria, '24-36', 8, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select (select id from contas limit 1), 'Boi +36 Meses', p.id, 'MACHO'::sexo_categoria, '36+', 9, true from grupos_categoria_papel p where p.nome = 'Garrotes e Bois'
union all
select (select id from contas limit 1), 'Vaca +36 Meses', p.id, 'FEMEA'::sexo_categoria, '36+', 10, true from grupos_categoria_papel p where p.nome = 'Matrizes em Reprodução'
union all
select (select id from contas limit 1), 'Touro', p.id, 'MACHO'::sexo_categoria, '36+', 11, true from grupos_categoria_papel p where p.nome = 'Touros';

insert into tipos_uso_area (nome, ordem) values
  ('Reserva Legal/APP', 1),
  ('Pecuária', 2),
  ('Agricultura', 3),
  ('Área em Reforma', 4),
  ('Área Alagada', 5),
  ('Infraestrutura', 6),
  ('Outros', 7);

-- subtipos_uso_area (migração 032): "Geral" pra todos os tipos de uso
-- (garante que todo lançamento sempre tem subtipo pra apontar, mesmo
-- com controla_subtipo_area desligado) + sugestões iniciais pra
-- Pecuária e Agricultura (usuário pode cadastrar outras livremente).
-- Conta-scoped desde a migração 046 — mesma observação de
-- categorias_animal acima: esse seed vale só pra "Conta Principal".
insert into subtipos_uso_area (conta_id, tipo_uso_id, nome, sistema, ordem)
select (select id from contas limit 1), id, 'Geral', true, 0 from tipos_uso_area;

insert into subtipos_uso_area (conta_id, tipo_uso_id, nome, ordem)
select (select id from contas limit 1), t.id, s.nome, s.ordem
from tipos_uso_area t
cross join (values
  ('Corte', 1), ('Leite', 2), ('Ovinocultura', 3), ('Haras', 4)
) as s(nome, ordem)
where t.nome = 'Pecuária';

insert into subtipos_uso_area (conta_id, tipo_uso_id, nome, ordem)
select (select id from contas limit 1), t.id, s.nome, s.ordem
from tipos_uso_area t
cross join (values
  ('Soja', 1), ('Milho', 2), ('Cana-de-açúcar', 3), ('Café', 4)
) as s(nome, ordem)
where t.nome = 'Agricultura';

-- plano de contas financeiro (migração 054): mesma observação de
-- categorias_animal/subtipos_uso_area acima — a trigger
-- trg_seed_plano_contas_conta só vale pra conta criada depois dela
-- existir; "Conta Principal" precisa do seed chamado manualmente.
select fn_seed_plano_contas_conta(id) from contas where nome = 'Conta Principal';

-- contas bancárias (Fase 2, migração 056): "Conta Principal" também
-- precisa do seed manual de "Dinheiro (em espécie)" — mesma observação
-- de categorias_animal/subtipos_uso_area/plano de contas acima, a
-- trigger só vale pra conta criada depois dela existir.
insert into contas_bancarias (conta_id, nome, especie, sistema, ordem)
select id, 'Dinheiro (em espécie)', true, true, 0 from contas where nome = 'Conta Principal';

-- "Conta Principal" já nasce com o recurso "Contas a Pagar/Receber"
-- contratado (é a conta de uso/teste do próprio usuário)
insert into conta_recursos (conta_id, dominio, recurso, ativo)
select id, 'financeiro', 'contas_a_pagar_receber', true from contas where nome = 'Conta Principal';

update configuracoes set controla_contas_pagar_receber = true
where conta_id = (select id from contas where nome = 'Conta Principal');

-- atividades econômicas (migração 058): "Conta Principal" também
-- precisa do seed manual, mesma observação de sempre — a trigger só
-- vale pra conta criada depois dela existir.
select fn_seed_atividades_economicas_conta(id) from contas where nome = 'Conta Principal';

-- =====================================================================
-- FIM DO SCRIPT
-- =====================================================================
