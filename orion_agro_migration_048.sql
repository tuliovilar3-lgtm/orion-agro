-- =====================================================================
-- Migração 048 — Fase 4 do multi-tenant: papel de Suporte
-- =====================================================================
--
-- Contexto (ver memória de projeto project_multi_tenant_saas): a
-- equipe interna do fornecedor (hoje só o próprio usuário) precisa
-- poder acessar e gerenciar a conta de qualquer cliente pra dar
-- suporte técnico. Decisão confirmada: acesso via "seletor de conta"
-- (escolhe uma conta numa lista e passa a navegar o app normal com os
-- dados dela) — não personificação de usuário específico, não painel
-- administrativo separado. Toda sessão de suporte fica registrada em
-- log de auditoria.
--
-- Decisão adicional confirmada nesta conversa: o primeiro usuário de
-- suporte é a própria conta já existente do usuário (dono da "Conta
-- Principal"), não um login separado — ele continua sendo dono normal
-- da própria conta, e ganha a opção extra de "entrar" em qualquer
-- outra conta pra dar suporte. Por isso fn_conta_atual() precisa de um
-- fallback: quando o usuário de suporte não está navegando em nenhuma
-- conta de cliente (sem linha em suporte_conta_ativa), ele continua
-- vendo a própria conta normalmente, sem nenhuma mudança de
-- comportamento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. suporte_conta_ativa — em qual conta um usuário de suporte está
--    navegando agora. Uma linha por usuário de suporte (chave primária
--    = usuario_id): "entrar" numa conta faz upsert, "sair" apaga a
--    linha. Preferida a uma variável de sessão do Postgres porque o
--    Supabase usa pool de conexões — uma session var não sobreviveria
--    de forma confiável entre requisições.
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

-- ---------------------------------------------------------------------
-- 2. suporte_auditoria — log append-only de quem entrou/saiu de qual
--    conta e quando. Populado só pela trigger abaixo (nunca por código
--    do app diretamente) — sem RLS permissiva pra ninguém autenticado,
--    só a função security definer consegue inserir.
-- ---------------------------------------------------------------------
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
-- 3. usuarios_app.suporte — marca a equipe interna do fornecedor.
--    Já existe desde a migração 046 (coluna criada, sem comportamento
--    nenhum até agora). Marca o(s) dono(s) atuais também como suporte
--    — hoje só existe um dono real no sistema inteiro, então isso é
--    seguro sem precisar saber o e-mail de ninguém.
-- ---------------------------------------------------------------------
update usuarios_app set suporte = true where dono = true;

-- ---------------------------------------------------------------------
-- 4. fn_conta_atual() — passa a checar suporte_conta_ativa primeiro
--    (só vale quando o usuário é suporte); sem linha ativa lá, cai pro
--    conta_id próprio de sempre. Cobre os 3 casos: usuário comum
--    (sempre usa o próprio conta_id), usuário de suporte "em casa"
--    (mesma coisa, sem nenhuma mudança de comportamento), usuário de
--    suporte navegando numa conta de cliente (usa a conta selecionada).
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

-- ---------------------------------------------------------------------
-- 5. RLS — suporte precisa enxergar TODAS as contas (pra montar o
--    seletor), não só a própria. Policy adicional (as policies de
--    SELECT se somam com OR) — não afeta INSERT/UPDATE/DELETE em
--    `contas`, que continuam restritos pela policy original
--    (onboarding de conta nova é fora do escopo desta fase).
-- ---------------------------------------------------------------------
create policy contas_visivel_suporte on contas for select
  using (exists (select 1 from usuarios_app where id = auth.uid() and suporte = true));

-- ---------------------------------------------------------------------
-- 6. usuarios_app — um usuário de suporte precisa continuar
--    enxergando o PRÓPRIO perfil (nome, dono, modo, suporte) mesmo
--    enquanto está navegando em outra conta (fn_conta_atual() aponta
--    pra conta selecionada nesse momento, não mais pra conta_id
--    próprio do usuário) — sem isso, o carregamento de sessão
--    (usuarios_app.select(...).eq('id', auth.uid())) quebraria assim
--    que o modo suporte fosse ativado. A policy antiga é substituída
--    por uma que soma "é o próprio usuário" com "é da conta ativa".
-- ---------------------------------------------------------------------
drop policy usuarios_app_por_conta on usuarios_app;
create policy usuarios_app_por_conta on usuarios_app for all
  using (id = auth.uid() or conta_id = fn_conta_atual())
  with check (id = auth.uid() or conta_id = fn_conta_atual());
