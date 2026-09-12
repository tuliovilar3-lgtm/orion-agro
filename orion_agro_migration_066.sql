-- Migração 066: detalhamento por safra de nascimento dentro de uma única
-- linha de Saldo Inicial de categoria bezerro
--
-- Descoberto ao carregar dados reais da Fazenda Teste 1: o rebanho inicial
-- de "Bezerro/Bezerra 00 a 08 Meses" de uma fazenda pode legitimamente
-- conter animais de mais de uma safra de nascimento (ex.: uma leva nascida
-- no fim da safra anterior, outra já na safra corrente) — mas o Saldo
-- Inicial continua sendo, por decisão explícita do usuário, **uma única
-- linha por categoria** (nunca duas linhas pra "Bezerro 00 a 08 Meses" na
-- mesma fazenda). A solução: uma tabela filha nova detalha, por safra, a
-- quantidade dentro dessa única linha — mesmo princípio já usado em
-- `lancamento_baixas` (detalha um lançamento financeiro) e
-- `movimentacao_ajustes` (detalha desconto/acréscimo de uma movimentação).
--
-- A quantidade da linha-mãe (`movimentacoes_rebanho.quantidade`) continua
-- sendo o total da categoria, como sempre. Quando existe detalhamento, a
-- soma das safras precisa ser EXATAMENTE igual a esse total — checado por
-- uma trigger de constraint adiável (roda só no fim da transação, pra
-- permitir apagar-e-reinserir todo o detalhamento de uma vez, mesmo
-- padrão "apaga e reinsere" já usado em outras listas filhas do sistema).
--
-- `movimentacoes_rebanho.safra_nascimento_ano_inicio` da linha-mãe
-- continua obrigatório (a trigger fn_validar_lote_nascimento_bezerro já
-- exige isso pra toda categoria bezerro) — vira a safra "representativa"
-- (a de maior quantidade) quando há detalhamento, mas deixa de ser lida
-- por fn_saldo_categoria_safra nesse caso: o saldo por safra passa a vir
-- inteiramente do detalhamento.
--
-- Fora do escopo desta migração (limitação aceita conscientemente, documentada
-- aqui pra não ser esquecida): a trajetória de edição/exclusão
-- (fn_checar_saldo_lote_futuro/fn_delta_para_par_lote) ainda lê só a safra/
-- quantidade da própria linha-mãe, não o detalhamento — editar ou excluir
-- uma linha de Saldo Inicial JÁ dividida por safra não tem, ainda, a mesma
-- proteção fina de "isso deixaria uma safra específica negativa no futuro"
-- que o resto do sistema tem. A proteção de escrita (soma bater com o
-- total) e a leitura do saldo por safra (fn_saldo_categoria_safra, usada
-- por toda validação de saída de bezerro) estão corretas; só a checagem
-- de trajetória ao editar/excluir a própria linha de Saldo Inicial dividida
-- é que fica pra uma extensão futura, se algum dia fizer falta na prática
-- (Saldo Inicial normalmente não é reeditado depois de confirmado).

create table saldo_inicial_safras (
  id                        uuid primary key default gen_random_uuid(),
  conta_id                  uuid not null references contas(id) default fn_conta_atual(),
  movimentacao_id           uuid not null references movimentacoes_rebanho(id) on delete cascade,
  safra_nascimento_ano_inicio int not null,
  quantidade                int not null check (quantidade > 0),
  created_at                timestamptz not null default now(),
  constraint uq_saldo_inicial_safra unique (movimentacao_id, safra_nascimento_ano_inicio)
);

create index idx_saldo_inicial_safras_movimentacao on saldo_inicial_safras(movimentacao_id);

alter table saldo_inicial_safras enable row level security;
create policy saldo_inicial_safras_por_conta on saldo_inicial_safras for all
  using (conta_id = fn_conta_atual()) with check (conta_id = fn_conta_atual());

-- ---------------------------------------------------------------------
-- Validação: só pode existir detalhamento pra linha de SALDO_INICIAL de
-- categoria bezerro (reaproveita fn_categoria_e_bezerro, já existente).
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- Validação (adiável): a soma das quantidades por safra precisa ser
-- exatamente igual à quantidade total da categoria na linha-mãe. Adiável
-- (roda só no fim da transação) pra permitir "apaga e reinsere" — apagar
-- todo o detalhamento antigo e inserir o novo na mesma transação só
-- bateria a soma certa depois de todos os inserts, não a cada linha.
-- ---------------------------------------------------------------------

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

-- Mesma checagem, do outro lado: se a quantidade da linha-mãe mudar
-- depois de já ter detalhamento, a soma precisa continuar batendo (ou o
-- app precisa ajustar as duas coisas na mesma transação).
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
-- fn_saldo_categoria_safra: entrada de SALDO_INICIAL passa a vir do
-- detalhamento por safra quando ele existir, em vez da coluna
-- safra_nascimento_ano_inicio da própria linha.
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
