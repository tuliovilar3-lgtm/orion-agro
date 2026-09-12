-- Migração 063: corrige fn_criar_modulo_pasto_geral() pra gravar
-- conta_id explicitamente (new.conta_id, a mesma conta da fazenda que
-- acabou de ser inserida) em vez de depender do default
-- fn_conta_atual(). Bug real: fn_conta_atual() resolve pelo auth.uid()
-- da sessão — funciona pra qualquer usuário logado normal (cuja sessão
-- sempre bate com a própria conta), mas quebra pra qualquer insert de
-- fazenda feito fora de uma sessão de app autenticada (ex.: um script
-- rodando com a chave service-role, sem auth.uid() nenhum) — o mesmo
-- tipo de bug já corrigido uma vez, mas só no backfill pontual da
-- migração 052 (conversão pasto↔talhão), nunca na própria função/trigger.
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
