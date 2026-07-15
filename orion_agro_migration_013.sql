-- =====================================================================
-- ORION AGRO — Migração 013 (correção da 012)
--
-- A migração 011 adicionou o parâmetro p_direcao_ajuste a
-- fn_checar_edicao_movimentacao e fn_delta_para_par usando
-- CREATE OR REPLACE. Só que mudar a quantidade de parâmetros via
-- CREATE OR REPLACE não substitui a função existente — cria uma
-- SEGUNDA sobrecarga (9 params original + 10 params nova). As duas
-- conviveram sem problema enquanto todo mundo sempre chamava com os
-- 10 argumentos. A migração 012 passou a chamar essas funções com 9
-- argumentos posicionais (já que o ajuste de estoque não existe
-- mais), o que ficou ambíguo entre as duas sobrecargas:
--   ERROR 42725: function ... is not unique
--
-- Esta migração remove as sobrecargas de 10 parâmetros e deixa só a
-- versão limpa de 9 parâmetros (igual ao schema.sql), já sem nenhuma
-- referência a direcao_ajuste.
-- =====================================================================

drop function if exists fn_checar_edicao_movimentacao(
  uuid, tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, date, integer, direcao_ajuste
);

drop function if exists fn_delta_para_par(
  tipo_movimentacao, uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, direcao_ajuste
);

-- fn_delta_para_par — versão limpa, sem p_direcao_ajuste
create or replace function fn_delta_para_par(
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_quantidade int,
  p_par_fazenda_id uuid,
  p_par_categoria_id uuid
) returns int
language plpgsql
immutable
as $$
declare
  v_total int := 0;
begin
  if p_tipo in ('NASCIMENTO', 'COMPRA', 'SALDO_INICIAL') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
    end if;
  elsif p_tipo in ('MORTE', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
  elsif p_tipo in ('MUDANCA_CATEGORIA', 'DESMAME') then
    if p_fazenda_id = p_par_fazenda_id and p_categoria_id = p_par_categoria_id then
      v_total := v_total - p_quantidade;
    end if;
    if p_fazenda_id = p_par_fazenda_id and p_categoria_destino_id = p_par_categoria_id then
      v_total := v_total + p_quantidade;
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

-- fn_checar_edicao_movimentacao — versão limpa, sem p_direcao_ajuste
create or replace function fn_checar_edicao_movimentacao(
  p_id uuid,
  p_tipo tipo_movimentacao,
  p_fazenda_id uuid,
  p_fazenda_origem_id uuid,
  p_fazenda_destino_id uuid,
  p_categoria_id uuid,
  p_categoria_destino_id uuid,
  p_data date,
  p_quantidade int
) returns table(
  tem_movimentacoes_futuras boolean,
  saldo_ficaria_negativo boolean,
  data_saldo_negativo date,
  categoria_saldo_negativo text,
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
  v_tem_futuras    boolean := false;
begin
  select * into v_old from movimentacoes_rebanho where id = p_id;

  for v_par in (
    select distinct fazenda_id, categoria_id from (
      values
        (v_old.fazenda_id, v_old.categoria_id),
        (v_old.fazenda_id, v_old.categoria_destino_id),
        (v_old.fazenda_destino_id, v_old.categoria_id),
        (p_fazenda_id, p_categoria_id),
        (p_fazenda_id, p_categoria_destino_id),
        (p_fazenda_destino_id, p_categoria_id)
    ) as t(fazenda_id, categoria_id)
    where fazenda_id is not null and categoria_id is not null
  )
  loop
    if exists (
      select 1 from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data > p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
    ) then
      v_tem_futuras := true;
    end if;

    for v_data in (
      select distinct m.data from movimentacoes_rebanho m
      where m.id <> p_id
        and m.data >= p_data
        and (
          (m.fazenda_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
          or (m.fazenda_id = v_par.fazenda_id and m.categoria_destino_id = v_par.categoria_id)
          or (m.fazenda_destino_id = v_par.fazenda_id and m.categoria_id = v_par.categoria_id)
        )
      union
      select p_data
      order by 1
    )
    loop
      v_saldo := fn_saldo_categoria(v_par.fazenda_id, v_par.categoria_id, v_data)
        - case when v_old.data <= v_data
            then fn_delta_para_par(v_old.tipo, v_old.fazenda_id, v_old.fazenda_origem_id, v_old.fazenda_destino_id,
                                    v_old.categoria_id, v_old.categoria_destino_id, v_old.quantidade,
                                    v_par.fazenda_id, v_par.categoria_id)
            else 0 end
        + case when p_data <= v_data
            then fn_delta_para_par(p_tipo, p_fazenda_id, p_fazenda_origem_id, p_fazenda_destino_id,
                                    p_categoria_id, p_categoria_destino_id, p_quantidade,
                                    v_par.fazenda_id, v_par.categoria_id)
            else 0 end;

      if v_saldo < 0 and (v_pior_data is null or v_data < v_pior_data) then
        v_pior_saldo := v_saldo;
        v_pior_data := v_data;
        v_pior_categoria := v_par.categoria_id;
      end if;
    end loop;
  end loop;

  tem_movimentacoes_futuras := v_tem_futuras;
  saldo_ficaria_negativo := v_pior_data is not null;
  data_saldo_negativo := v_pior_data;
  saldo_minimo := v_pior_saldo;
  select nome into categoria_saldo_negativo from categorias_animal where id = v_pior_categoria;

  return next;
end;
$$;

-- a coluna e ambos os call sites que usavam direcao_ajuste já foram
-- removidos na migração 012 — o tipo não é mais referenciado por nada
drop type if exists direcao_ajuste;

-- =====================================================================
-- FIM DA MIGRAÇÃO 013
-- =====================================================================
