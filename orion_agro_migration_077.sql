-- Migração 077: corrige de verdade o timeout do Relatório de Lotação / Relatórios Financeiros
--
-- Reportado pelo usuário: "Relatório de Lotação" dando "canceling statement due to statement
-- timeout". Causa: fn_relatorio_lotacao_mensal chamava fn_indicadores_rebanho_dia uma vez POR
-- DIA do calendário dentro do período filtrado — recalculando o histórico inteiro do zero a
-- cada dia, MESMO em dias sem nenhuma movimentação. Confirmado com dado real: no período exato
-- que travou (75 dias, 4 fazendas), não havia NENHUMA movimentação relevante — o sistema estava
-- refazendo a mesma conta 75 vezes só pra chegar sempre no mesmo resultado.
--
-- Correção (sem precisar aumentar tempo limite nenhum): fn_relatorio_lotacao_mensal passa a
-- reavaliar só nas datas em que algo de fato muda pra essas fazendas (uma movimentação que afeta
-- o rebanho, ou qualquer pesagem — manual ou compilada automaticamente por uma movimentação,
-- incluindo Mudança de Pasto). Entre dois desses "pontos de mudança", o valor do ponto anterior
-- continua valendo sem custo nenhum — é uma função em degrau: o número só muda quando algo
-- acontece, nunca sozinho de um dia pro outro. O resultado numérico é idêntico ao de antes
-- (conferido linha a linha contra o comportamento anterior, em 3 cenários reais, antes de
-- aplicar) — só a forma de calcular mudou, nunca a fórmula.

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
  v_soma_headcount numeric;
  v_soma_peso_vivo numeric;
  v_dias       int;
  v_area_media numeric;
  v_tipo_pecuaria_id uuid;
  v_ind        record;
  v_pontos     date[];
  v_ponto      date;
  v_fim_intervalo   date;
  v_dias_intervalo  int;
  i int;
begin
  select id into v_tipo_pecuaria_id from tipos_uso_area where nome = 'Pecuária';

  while v_mes_inicio <= p_data_fim loop
    v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;
    v_janela_ini := greatest(v_mes_inicio, p_data_inicio);
    v_janela_fim := least(v_mes_fim, p_data_fim);

    -- pontos de reavaliação: sempre o início da janela + toda data (dentro da janela) em que
    -- alguma movimentação relevante ou pesagem aconteceu pra essas fazendas
    select array_agg(distinct d order by d) into v_pontos
    from (
      select v_janela_ini as d
      union
      select data from movimentacoes_rebanho
      where data between v_janela_ini and v_janela_fim
        and (
          (fazenda_id = any(p_fazenda_ids)
            and tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL', 'MUDANCA_CATEGORIA', 'DESMAME',
                         'MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO'))
          or (fazenda_origem_id = any(p_fazenda_ids) and tipo = 'TRANSFERENCIA')
          or (fazenda_destino_id = any(p_fazenda_ids) and tipo = 'TRANSFERENCIA')
        )
      union
      select data from pesagens
      where fazenda_id = any(p_fazenda_ids) and data between v_janela_ini and v_janela_fim
    ) x;

    v_soma_headcount := 0;
    v_soma_peso_vivo := 0;
    v_dias := 0;

    for i in 1 .. array_length(v_pontos, 1) loop
      v_ponto := v_pontos[i];
      v_fim_intervalo := case when i < array_length(v_pontos, 1) then v_pontos[i + 1] - 1 else v_janela_fim end;
      v_dias_intervalo := v_fim_intervalo - v_ponto + 1;
      if v_dias_intervalo > 0 then
        select * into v_ind from fn_indicadores_rebanho_dia(p_fazenda_ids, v_ponto, p_proprietario_ids);
        v_soma_headcount := v_soma_headcount + v_ind.headcount * v_dias_intervalo;
        v_soma_peso_vivo := v_soma_peso_vivo + v_ind.peso_vivo_total * v_dias_intervalo;
        v_dias := v_dias + v_dias_intervalo;
      end if;
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
