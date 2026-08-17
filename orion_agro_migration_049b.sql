-- =====================================================================
-- Migração 049b — hotfix: uq_subtipo_nome_tipo_uso precisa incluir
-- conta_id
-- =====================================================================
--
-- Bug encontrado ao testar o onboarding de conta nova (migração 049):
-- subtipos_uso_area virou conta-scoped na Fase 1 (migração 046, que
-- adicionou conta_id em 18 tabelas + RLS), mas essa constraint
-- (criada na migração 032, antes de conta_id existir) nunca foi
-- atualizada pra incluir a coluna nova — ficou "unique (tipo_uso_id,
-- nome)", sem conta_id. Como tipos_uso_area é catálogo global
-- (mesmo tipo_uso_id pra todas as contas), a segunda conta a inserir
-- um subtipo "Geral" pra qualquer tipo de uso colide com a linha
-- "Geral" já existente da primeira conta.
--
-- Só apareceu agora porque, até a migração 049 (trigger de seed
-- automático por conta nova), nunca tinha existido uma segunda conta
-- tentando inserir subtipos_uso_area — mesma classe de bug que
-- fn_existe_dono() (048b): invisível enquanto só existia uma conta no
-- sistema inteiro.
--
-- fazendas.nome já recebeu esse mesmo tratamento corretamente na
-- própria migração 046 (uq_fazendas_conta_nome unique (conta_id,
-- nome)) — este hotfix aplica o mesmo princípio, só que num lugar que
-- ficou pra trás na hora.
-- =====================================================================

alter table subtipos_uso_area drop constraint uq_subtipo_nome_tipo_uso;
alter table subtipos_uso_area add constraint uq_subtipo_nome_tipo_uso unique (conta_id, tipo_uso_id, nome);
