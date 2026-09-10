-- =====================================================================
-- ORION AGRO — Migração 054
--
-- Módulo Financeiro — Fase 1: plano de contas (Tipo → Classe → Centro
-- de Custo → Subcentro de Custo → Produto/Serviço), integração
-- automática com Movimentações (Compra/Venda em Pé/Venda Abate) via
-- lançamento "Pendente de conferência", e rateio de despesa entre
-- fazendas materializado em N linhas (esse último sem migração de
-- schema — é resolvido no frontend, ad-hoc, sem tabela de regra salva
-- nesta fase).
--
-- Reaproveita a espinha dorsal já existente no schema (centros_custo/
-- subcentros_custo/lancamentos_financeiros/regras_rateio, desde o
-- rascunho original do projeto, nunca usada por nenhuma tela) —
-- corrige 2 bugs herdados (centros_custo.nome único global, não por
-- conta; lancamentos_financeiros.usuario_id apontando pra tabela
-- usuarios morta) e estrutura o plano de contas como uma transcrição
-- literal do plano de referência do usuário (Metryx): 12 Classes
-- (1 dígito) → 35 Centros de Custo (2 dígitos, aninhados na Classe) →
-- 123 Subcentros (3 dígitos, aninhados no Centro). Ver CLAUDE.md
-- ("Módulo Financeiro") pro histórico completo da decisão.
--
-- IMPORTANTE — rodar em duas etapas: ALTER TYPE ... RENAME VALUE não
-- tem a mesma restrição de ADD VALUE (pode ser usado na mesma
-- transação), mas o restante da migração depende dos novos rótulos
-- 'CREDITO'/'DEBITO' já existirem — pra segurança, rode a ETAPA 1
-- sozinha primeiro, espere terminar, depois rode o resto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ETAPA 1 — rodar sozinha, esperar terminar antes de continuar
-- ---------------------------------------------------------------------

alter type tipo_lancamento_financeiro rename value 'RECEITA' to 'CREDITO';
alter type tipo_lancamento_financeiro rename value 'DESPESA' to 'DEBITO';

-- ---------------------------------------------------------------------
-- ETAPA 2 — rodar depois que a ETAPA 1 já tiver sido confirmada
-- ---------------------------------------------------------------------

create type status_lancamento_financeiro as enum ('PENDENTE', 'CONFIRMADO');

-- 1) Classe (1 dígito) — catálogo fixo, sem CRUD de usuário (mesmo
-- princípio de tipos_uso_area)
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

-- 2) Centro de Custo (2 dígitos) — deixa de ser uma lista solta
-- reutilizada e passa a existir dentro de uma Classe só (por isso
-- "Rebanho" aparece mais de uma vez no plano — cada ocorrência é uma
-- linha própria, com sua própria lista de subcentros)
alter table centros_custo add column classe_financeira_id uuid references classes_financeiras(id);
alter table centros_custo add column numero int;
alter table centros_custo add column sistema boolean not null default false;
alter table centros_custo add column ativo boolean not null default true;
alter table centros_custo add column ordem int not null default 0;
alter table centros_custo drop constraint centros_custo_nome_key;
alter table centros_custo alter column classe_financeira_id set not null;
alter table centros_custo add constraint uq_centro_custo_nome
  unique (conta_id, classe_financeira_id, nome);

-- 3) Subcentro de Custo (3 dígitos) — já existia (centro_custo_id,
-- nome, unique por centro); ganha numero/sistema/ativo
alter table subcentros_custo add column numero int;
alter table subcentros_custo add column sistema boolean not null default false;
alter table subcentros_custo add column ativo boolean not null default true;

-- 4) Produto/Serviço — fora da numeração, catálogo à parte. Sem seed
-- nenhum, exceto os 3 produtos-sistema da integração com Movimentações
-- (criados no fim desta migração) — 100% cadastrado pelo usuário.
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

-- 5) lancamentos_financeiros — remove os campos de texto livre e a FK
-- morta pra usuarios, adiciona a classificação estruturada + o fluxo
-- de conferência + rateio. Assume a tabela vazia (nunca usada por
-- nenhuma tela até hoje — conferir `select count(*) from
-- lancamentos_financeiros` antes de rodar, se der >0 parar e avisar).
alter table lancamentos_financeiros drop column conta;
alter table lancamentos_financeiros drop column setor;
alter table lancamentos_financeiros drop column classe;
alter table lancamentos_financeiros drop column usuario_id;
alter table lancamentos_financeiros drop column centro_custo_id;

alter table lancamentos_financeiros alter column subcentro_id set not null;

alter table lancamentos_financeiros add column produto_id uuid not null references produtos_financeiros(id);
alter table lancamentos_financeiros add column status status_lancamento_financeiro not null default 'CONFIRMADO';
alter table lancamentos_financeiros add column movimentacao_id uuid unique references movimentacoes_rebanho(id) on delete cascade;
alter table lancamentos_financeiros add column rateio_grupo_id uuid;
alter table lancamentos_financeiros add column confirmado_por uuid references usuarios_app(id);
alter table lancamentos_financeiros add column confirmado_em timestamptz;

drop index if exists idx_fin_centro_custo;
create index idx_fin_subcentro on lancamentos_financeiros(subcentro_id);
create index idx_fin_status_pendente on lancamentos_financeiros(status) where status = 'PENDENTE';
create index idx_fin_rateio_grupo on lancamentos_financeiros(rateio_grupo_id) where rateio_grupo_id is not null;

-- 6) fn_valor_liquido_movimentacao — mesma fórmula já usada no
-- frontend (valorLiquido, components/relatorios/tipos.ts:42-48):
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

-- 7) tipo do lançamento é sempre derivado do subcentro escolhido
-- (subcentro → centro → classe → tipo) — nunca digitado manualmente,
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

-- 8) fn_compilar_lancamento_financeiro_movimentacao — mesmo molde de
-- fn_compilar_pesagem_movimentacao (orion_agro_schema.sql:3526-3557):
-- toda Compra/Venda em Pé/Venda Abate salva cria ou atualiza um
-- lançamento financeiro ligado por movimentacao_id, já classificado
-- automaticamente (via os 3 produtos-sistema criados no fim desta
-- migração) e sempre em status PENDENTE — precisa de confirmação
-- humana explícita na tela financeira antes de contar como oficial.
-- Qualquer alteração posterior na movimentação resincroniza o
-- lançamento e volta o status pra PENDENTE (exige nova conferência).
create or replace function fn_compilar_lancamento_financeiro_movimentacao()
returns trigger as $$
declare
  v_produto_nome text;
  v_produto_id   uuid;
  v_subcentro_id uuid;
  v_valor        numeric;
begin
  if new.tipo not in ('COMPRA', 'VENDA_PE', 'VENDA_ABATE') then
    return new;
  end if;

  v_produto_nome := case new.tipo
    when 'COMPRA' then 'Gado — Compra'
    when 'VENDA_PE' then 'Gado — Venda em Pé'
    when 'VENDA_ABATE' then 'Gado — Venda Abate'
  end;

  select id, subcentro_custo_id into v_produto_id, v_subcentro_id
  from produtos_financeiros
  where conta_id = new.conta_id and nome = v_produto_nome and sistema = true;

  -- produto-sistema ainda não existe pra essa conta (ex.: conta criada
  -- antes desta migração, sem backfill rodado) — não bloqueia a
  -- movimentação, só não gera lançamento financeiro nenhum
  if v_produto_id is null then
    return new;
  end if;

  v_valor := fn_valor_liquido_movimentacao(new.id);

  insert into lancamentos_financeiros
    (conta_id, fazenda_id, descricao, data, valor, subcentro_id, produto_id, movimentacao_id, status)
  values
    (new.conta_id, new.fazenda_id, v_produto_nome, new.data, v_valor, v_subcentro_id, v_produto_id, new.id, 'PENDENTE')
  on conflict (movimentacao_id) do update set
    fazenda_id     = excluded.fazenda_id,
    data           = excluded.data,
    valor          = excluded.valor,
    subcentro_id   = excluded.subcentro_id,
    produto_id     = excluded.produto_id,
    status         = 'PENDENTE',
    confirmado_por = null,
    confirmado_em  = null;

  return new;
end;
$$ language plpgsql;

create trigger trg_compilar_lancamento_financeiro_movimentacao
after insert or update on movimentacoes_rebanho
for each row execute function fn_compilar_lancamento_financeiro_movimentacao();

-- desconto/acréscimo (movimentacao_ajustes) afeta o valor líquido, mas
-- é uma tabela separada da movimentação em si — precisa da própria
-- trigger pra recalcular o lançamento vinculado sempre que um ajuste é
-- inserido/editado/removido, não só quando a movimentação muda
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

-- 9) lançamento compilado automaticamente não pode ser excluído direto
-- na tela financeira — mesmo molde de fn_validar_delete_pesagem
-- (orion_agro_schema.sql:3568-3581), incluindo a mesma checagem de "a
-- movimentação ainda existe" pra não travar a cascata quando é a
-- própria movimentação que está sendo apagada
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

-- 10) fn_seed_plano_contas_conta — insere o plano de contas inteiro
-- (12 Classes, 35 Centros, 123 Subcentros, todos sistema=true) e os 3
-- produtos-sistema pra uma conta. Função separada de trigger (recebe
-- p_conta_id) pra poder ser chamada tanto pela trigger de conta nova
-- quanto no backfill da Conta Principal logo abaixo, sem duplicar as
-- ~160 linhas de seed duas vezes.
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
    (2, 1, 'Arrendamento'), (2, 2, 'Receitas Parque de máquinas'), (2, 3, 'Receitas financeiras'),
    (2, 4, 'Receitas outros'), (2, 5, 'Vendas outros animais'), (2, 6, 'Venda de Imóveis'),
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

    (2,1,1,'Arrendamento'),
    (2,2,1,'Venda veículos tratores e implementos'), (2,2,2,'Aluguel de Máquinas'),
    (2,3,1,'Rendimento financeiro juros'), (2,3,2,'Participação nos Lucros, Cooperativas e Outros (PLL)'),
    (2,4,1,'Madeiras e outros'), (2,4,2,'Recicláveis'), (2,4,3,'Vendas ferramentas e equipamentos'), (2,4,4,'Outros Créditos'),
    (2,5,1,'Venda tropa de reprodução'), (2,5,2,'Venda tropa de serviço'),
    (2,6,1,'Imóveis Rurais'), (2,6,2,'Imóveis Urbanos'),

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

  insert into produtos_financeiros (conta_id, nome, subcentro_custo_id, sistema)
  select p_conta_id, v.nome, sc.id, true
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

-- toda conta nova ganha o plano de contas inteiro sozinha — mesmo
-- princípio de fn_seed_categorias_subtipos_conta (migração 049)
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

-- backfill pra "Conta Principal" (inserida antes desta trigger
-- existir, mesma dança já documentada nas migrações 049/050)
select fn_seed_plano_contas_conta(id) from contas where nome = 'Conta Principal';
