-- =====================================================================
-- Migração 046 — Fase 1 do multi-tenant: tabela `contas` + conta_id em
-- toda tabela operacional + RLS por conta (reativado)
-- =====================================================================
--
-- Contexto (ver memória de projeto project_multi_tenant_saas): o ORION
-- Agro vai virar um produto multi-tenant — vários clientes pagantes
-- ("contas"), cada um com seus próprios dados isolados, mais um papel de
-- Suporte que acessa qualquer conta, mais módulos vendidos avulsos por
-- conta. Esta migração é só a Fase 1: criar o conceito de conta e
-- isolar os dados — não cria ainda as tabelas de módulo/plano/limite
-- (Fase 2), nem a tela de Suporte (Fase 4).
--
-- Decisão de sequenciamento importante (diferente do que foi esboçado
-- na conversa inicial): em vez de "conta_id em tudo" (Fase 1) e "RLS"
-- (Fase 3) como passos separados no tempo, as duas coisas entram juntas
-- aqui. Motivo: sem RLS, cada uma das dezenas de queries do app
-- precisaria ganhar um `.eq('conta_id', ...)` manual — grande e fácil
-- de esquecer um lugar. Com RLS ligado usando uma coluna `conta_id`
-- com **valor padrão automático** (`default fn_conta_atual()`), o
-- banco resolve sozinho tanto a escrita (nova linha herda a conta do
-- usuário logado, sem o app precisar informar) quanto a leitura
-- (usuário só enxerga linhas da própria conta) — nenhuma das ~30
-- funções/triggers existentes precisa mudar (nenhuma usa
-- `security definer`, então todas já respeitam RLS automaticamente) e
-- praticamente nenhuma tela do app precisa de código novo.
--
-- Exceção: os dois Route Handlers que usam o cliente admin/service-role
-- pra gerenciar usuário (`app/api/usuarios/route.ts` e
-- `app/api/usuarios/[id]/route.ts`) bypassam RLS de propósito (é assim
-- que criam login via Admin API) — esses dois precisam de um ajuste de
-- código à parte, feito na mesma leva desta migração, pra passar
-- `conta_id` explicitamente em vez de depender do valor padrão (que só
-- funciona quando existe uma sessão de usuário autenticada por trás).
--
-- Com só uma conta existindo (a atual, do próprio usuário), esta
-- migração não muda nenhum comportamento visível do app — é
-- estritamente aditiva e transparente. O ganho é só estrutural: a partir
-- daqui, criar uma segunda conta de cliente já nasce isolada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabela `contas` — o tenant
-- ---------------------------------------------------------------------
create table contas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. conta_id em toda tabela operacional + backfill pra uma conta só
--    (representando os dados atuais, single-tenant até aqui)
--
-- usuarios_app é tratado à parte da lista genérica abaixo: sua coluna
-- conta_id fica nullable permanentemente (usuários de Suporte, ainda
-- não implementados — Fase 4 — não pertencem a nenhuma conta de
-- cliente) e sem valor padrão automático (ver nota sobre os dois Route
-- Handlers acima).
-- ---------------------------------------------------------------------
-- movimentacoes_rebanho tem uma CHECK constraint (ck_peso_medio_obrigatorio)
-- adicionada NOT VALID na migração 028 de propósito, pra não validar
-- retroativamente 2 lançamentos legados sem peso médio (1 Nascimento, 1
-- Compra, de antes dessa regra existir). CHECK constraint não é gatilho
-- — "disable trigger" não a afeta — e um UPDATE em massa como o backfill
-- abaixo re-dispara essa validação em cada linha tocada, mesmo só
-- mudando conta_id, quebrando nesses 2 lançamentos antigos. Descartada e
-- recriada exatamente como estava (NOT VALID) só ao redor do backfill —
-- comportamento final idêntico ao de antes da migração.
alter table movimentacoes_rebanho drop constraint ck_peso_medio_obrigatorio;

do $$
declare
  v_conta_id uuid;
  v_tabela   text;
  v_tabelas  text[] := array[
    'fazendas', 'configuracoes', 'usuario_modulos', 'categorias_animal',
    'pessoas', 'pessoa_papeis', 'subtipos_uso_area', 'movimentacoes_area',
    'modulos', 'pastos', 'movimentacoes_rebanho', 'pesagens',
    'itens_ajuste_financeiro', 'movimentacao_ajustes',
    'lancamentos_financeiros', 'centros_custo', 'subcentros_custo', 'regras_rateio'
  ];
begin
  insert into contas (nome) values ('Conta Principal') returning id into v_conta_id;

  -- disable trigger user: desliga só os gatilhos de negócio definidos
  -- pelo usuário (validações como "informe a safra de nascimento do
  -- lote de bezerros envolvido"), sem desligar os gatilhos internos de
  -- integridade referencial do Postgres. Necessário porque um UPDATE
  -- em massa como este dispara esses gatilhos pra cada linha mesmo só
  -- preenchendo uma coluna nova sem relação — e alguns lançamentos
  -- antigos (legados, de antes de certas regras existirem) não passam
  -- nessas validações se forem re-checados agora. Não estamos mudando
  -- nenhum dado de negócio, só rotulando a linha com a conta, então é
  -- seguro pular essas checagens só durante o backfill.
  alter table usuarios_app add column conta_id uuid references contas(id);
  alter table usuarios_app disable trigger user;
  update usuarios_app set conta_id = v_conta_id;
  alter table usuarios_app enable trigger user;

  foreach v_tabela in array v_tabelas loop
    execute format('alter table %I add column conta_id uuid references contas(id)', v_tabela);
    execute format('alter table %I disable trigger user', v_tabela);
    execute format('update %I set conta_id = %L', v_tabela, v_conta_id);
    execute format('alter table %I enable trigger user', v_tabela);
    execute format('alter table %I alter column conta_id set not null', v_tabela);
    execute format('create index %I on %I (conta_id)', 'idx_' || v_tabela || '_conta', v_tabela);
  end loop;
end $$;

-- recria a constraint exatamente como estava (NOT VALID) — nada mudou
-- do ponto de vista de comportamento, só sobreviveu ao backfill
alter table movimentacoes_rebanho add constraint ck_peso_medio_obrigatorio check (
  tipo = 'MUDANCA_PASTO' or peso_medio_kg is not null
) not valid;

-- ---------------------------------------------------------------------
-- 3. fn_conta_atual() — resolve a conta do usuário autenticado
--
-- security definer + search_path fixo: função padrão do Supabase pra
-- evitar recursão de RLS (a policy de usuarios_app também chama essa
-- função, e sem security definer a consulta interna a usuarios_app
-- disparuia a própria RLS de novo, num ciclo). Executa com o
-- privilégio de quem criou a função (bypassa RLS só pra essa consulta
-- interna específica), nunca expõe dado nenhum além da conta do
-- próprio usuário que está chamando.
-- ---------------------------------------------------------------------
create or replace function fn_conta_atual()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select conta_id from usuarios_app where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 4. conta_id ganha valor padrão automático — uma linha nova criada
--    sem informar conta_id herda a do usuário logado sozinha. Isso é o
--    que permite o app inteiro continuar inserindo exatamente como
--    hoje, sem precisar mencionar conta_id em nenhuma tela.
--    (usuarios_app fica de fora — ver nota no topo do arquivo)
-- ---------------------------------------------------------------------
do $$
declare
  v_tabela  text;
  v_tabelas text[] := array[
    'fazendas', 'configuracoes', 'usuario_modulos', 'categorias_animal',
    'pessoas', 'pessoa_papeis', 'subtipos_uso_area', 'movimentacoes_area',
    'modulos', 'pastos', 'movimentacoes_rebanho', 'pesagens',
    'itens_ajuste_financeiro', 'movimentacao_ajustes',
    'lancamentos_financeiros', 'centros_custo', 'subcentros_custo', 'regras_rateio'
  ];
begin
  foreach v_tabela in array v_tabelas loop
    execute format('alter table %I alter column conta_id set default fn_conta_atual()', v_tabela);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Corrige restrições únicas que hoje assumem "um grupo só":
--    - fazendas.nome era único globalmente; agora precisa ser único só
--      dentro da mesma conta (duas contas diferentes podem ambas ter
--      uma "Fazenda Teste"). Descobre o nome real da constraint em vez
--      de arriscar um nome errado.
--    - configuracoes tinha um índice único sobre uma expressão
--      constante forçando exatamente uma linha NO SISTEMA INTEIRO;
--      agora precisa ser uma linha por conta.
-- ---------------------------------------------------------------------
do $$
declare
  v_constraint_nome text;
begin
  select conname into v_constraint_nome
  from pg_constraint
  where conrelid = 'fazendas'::regclass
    and contype = 'u'
    and conkey = (
      select array_agg(attnum) from pg_attribute
      where attrelid = 'fazendas'::regclass and attname = 'nome'
    );
  if v_constraint_nome is not null then
    execute format('alter table fazendas drop constraint %I', v_constraint_nome);
  end if;
end $$;

alter table fazendas add constraint uq_fazendas_conta_nome unique (conta_id, nome);

drop index if exists uq_configuracoes_singleton;
create unique index uq_configuracoes_conta on configuracoes (conta_id);

-- ---------------------------------------------------------------------
-- 6. usuarios_app.suporte — booleano paralelo a `dono`, marca quem é
--    da equipe interna (não pertence a nenhuma conta de cliente). Só a
--    coluna por enquanto — a tela de seletor de conta e o bypass de
--    RLS pra Suporte são Fase 4, ainda não implementados. Com o
--    default `false`, nenhum usuário existente é afetado.
-- ---------------------------------------------------------------------
alter table usuarios_app add column suporte boolean not null default false;

-- ---------------------------------------------------------------------
-- 7. RLS — reativado (estava desligado de propósito desde a migração
--    042, documentado como "passo futuro"; a decisão de produtizar
--    multi-tenant torna isso pré-requisito, não mais opcional). Uma
--    policy por tabela: só enxerga/altera linhas da própria conta.
--
--    `contas` usa `id = fn_conta_atual()` (compara contra o próprio id
--    da linha, não uma coluna conta_id); todas as outras usam
--    `conta_id = fn_conta_atual()`.
-- ---------------------------------------------------------------------
do $$
declare
  v_tabela  text;
  v_tabelas text[] := array[
    'fazendas', 'configuracoes', 'usuarios_app', 'usuario_modulos', 'categorias_animal',
    'pessoas', 'pessoa_papeis', 'subtipos_uso_area', 'movimentacoes_area',
    'modulos', 'pastos', 'movimentacoes_rebanho', 'pesagens',
    'itens_ajuste_financeiro', 'movimentacao_ajustes',
    'lancamentos_financeiros', 'centros_custo', 'subcentros_custo', 'regras_rateio'
  ];
begin
  execute 'alter table contas enable row level security';
  execute 'create policy contas_por_conta on contas for all using (id = fn_conta_atual()) with check (id = fn_conta_atual())';

  foreach v_tabela in array v_tabelas loop
    execute format('alter table %I enable row level security', v_tabela);
    execute format(
      'create policy %I on %I for all using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual())',
      v_tabela || '_por_conta', v_tabela
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Nova conta ganha uma linha em `configuracoes` sozinha — mesmo
--    princípio já usado pra módulo/pasto "Geral" de toda fazenda nova
--    (fn_criar_modulo_pasto_geral). Criado só agora, no fim do
--    arquivo, pra não disparar durante o insert da "Conta Principal"
--    lá em cima (que já tem sua própria linha de configuracoes vinda
--    do backfill) — evitaria duas linhas de configuracoes pra mesma
--    conta, batendo na constraint uq_configuracoes_conta.
-- ---------------------------------------------------------------------
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
