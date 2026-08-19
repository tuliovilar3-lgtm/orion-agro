-- =====================================================================
-- ORION AGRO — Migração 051
--
-- Proprietário cruzado com pasto + proprietário em todos os
-- lançamentos/relatórios do rebanho. Pedido do usuário: filtrar o
-- rebanho por proprietário deve valer em todos os lançamentos (não só
-- Movimentações — também Saldo Inicial e Mudança de Pasto) e em todos
-- os relatórios/movimentações do rebanho (não só os 3 já cobertos —
-- também "Rebanho por pasto").
--
-- Decisões fechadas com o usuário (AskUserQuestion, 2 perguntas):
-- - "Rebanho por pasto" GANHA o cruzamento pasto × proprietário
--   (recomendado) — nova dimensão de saldo, revertendo o princípio
--   "não cruza com pasto" só pra essa combinação específica, porque
--   sem isso não dá pra filtrar esse relatório por dono.
-- - "Relatório de Lotação" NÃO ganha o filtro (recomendado) — mantém a
--   exclusão já documentada: lotação cruza rebanho com área, e área não
--   tem dimensão de proprietário, então filtrar só o rebanho produziria
--   um número matematicamente enganoso.
--
-- Por que cruzar é necessário (não é só um relatório a mais): as
-- checagens de saldo insuficiente já existentes (por pasto, por
-- proprietário, separadas) não bastam sozinhas — um pasto com cabeças
-- de 2 donos onde só uma parte pertence ao dono X pode ter saldo de
-- pasto suficiente E saldo de proprietário suficiente (somado sobre
-- todos os pastos), mas ainda assim ficar negativo NA COMBINAÇÃO
-- pasto+dono específica se alguém tentar vender mais cabeças do dono X
-- daquele pasto do que ele realmente tem ali. Por isso esta migração
-- adiciona a checagem cruzada como uma terceira camada de defesa em
-- profundidade, no mesmo espírito de pasto/lote/proprietário já
-- existentes — não é feature nova de UI, é integridade de dado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) fn_saldo_categoria_pasto_proprietario: mesmo princípio de
-- fn_saldo_categoria_pasto, cruzando com proprietario_id. Mesma lista
-- de tipos que fn_saldo_categoria_proprietario já usa (Mudança de
-- Categoria/Desmame não entram como entrada — proprietário não
-- atravessa reclassificação de categoria, DESMAME conta só como saída,
-- mesmo tratamento já documentado pra essa função), acrescida de
-- MUDANCA_PASTO (que fn_saldo_categoria_proprietario não tinha, porque
-- antes proprietário não cruzava com pasto — agora precisa, senão mover
-- só parte de um pasto multi-dono quebraria o saldo cruzado).
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
-- 2) fn_delta_para_par_pasto_proprietario / fn_checar_saldo_pasto_
-- proprietario_futuro: mesma receita de fn_delta_para_par_proprietario/
-- fn_checar_saldo_proprietario_futuro, na dimensão cruzada (fazenda,
-- categoria, pasto, proprietario). Segue o padrão "defesa em
-- profundidade silenciosa" já usado pra lote/proprietário — sem aviso
-- de confirmação amigável no frontend, só bloqueio direto do banco.
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

-- ---------------------------------------------------------------------
-- 3) Wireia a checagem cruzada nas 3 triggers já existentes — insert
-- (fn_validar_saldo_categoria), edição (fn_validar_edicao_movimentacao)
-- e exclusão (fn_validar_delete_movimentacao). Condicionada a
-- proprietario_id is not null, mesmo gate já usado pra checagem de
-- proprietário simples (maioria das linhas tem, mas é opcional).
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

create or replace function fn_validar_edicao_movimentacao()
returns trigger as $$
declare
  v_check           record;
  v_check_lote      record;
  v_check_prop      record;
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

create or replace function fn_validar_delete_movimentacao()
returns trigger as $$
declare
  v_check           record;
  v_check_lote      record;
  v_check_prop      record;
  v_check_pasto_prop record;
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

-- ---------------------------------------------------------------------
-- 4) fn_relatorio_rebanho_por_pasto ganha p_proprietario_ids opcional
-- — quando informado, soma fn_saldo_categoria_pasto_proprietario sobre
-- os proprietários selecionados em vez de fn_saldo_categoria_pasto
-- (sem filtro). Precisa de drop antes do create, já que muda a
-- assinatura (mesmo princípio já usado em fn_saldo_categoria_safra_mes
-- → fn_saldo_categoria_safra na migração 031).
-- ---------------------------------------------------------------------

drop function if exists fn_relatorio_rebanho_por_pasto(uuid, date);

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
