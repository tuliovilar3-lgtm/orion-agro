-- Migração 070: remove os overloads antigos (sem p_proprietario_ids) de
-- fn_estoque_rebanho_na_data / fn_indicadores_rebanho_dia /
-- fn_relatorio_lotacao_mensal
--
-- Bug real encontrado ao implementar o "Efetivo atual" reativo à data em
-- Lançamento de Movimentações: a migração 062 estendeu essas 3 funções
-- acrescentando `p_proprietario_ids uuid[] default null` no fim da lista
-- de parâmetros via `create or replace function`, sob a suposição
-- (registrada no CLAUDE.md, incorreta) de que um novo parâmetro com
-- default não precisaria de `drop function` antes. Isso está errado:
-- Postgres identifica uma função pelo nome + a lista de TIPOS de
-- parâmetro, então mudar a assinatura via `create or replace` não
-- substitui a função antiga — cria um SEGUNDO overload com o mesmo nome,
-- deixando a versão de 2/3 parâmetros órfã no banco ao lado da nova.
--
-- Isso não quebrava nenhuma chamada já existente porque toda chamada
-- interna (fn_indicadores_rebanho_dia → fn_estoque_rebanho_na_data,
-- fn_relatorio_lotacao_mensal → fn_indicadores_rebanho_dia) e toda
-- chamada nova (Relatórios Financeiros) sempre passa os 3/4 parâmetros
-- completos, inclusive p_proprietario_ids explicitamente como null —
-- nesse caso o Postgres/PostgREST resolve sem ambiguidade. Mas qualquer
-- chamada omitindo esse último parâmetro (a forma "sem filtro" mais
-- natural de chamar via supabase-js, com só os parâmetros nomeados que
-- fazem sentido) trava com "Could not choose the best candidate function
-- between..." — confirmado quebrando de fato:
--   1. app/relatorio-lotacao/page.tsx (fn_relatorio_lotacao_mensal com só
--      3 parâmetros) — bug PRÉ-EXISTENTE desde a migração 062, nunca
--      notado até agora porque não fazia parte do escopo de teste desta
--      sessão revisitar essa tela depois daquela migração.
--   2. app/movimentacoes/page.tsx, "Efetivo atual" reativo à data (novo
--      nesta sessão, usa fn_estoque_rebanho_na_data com só 2 parâmetros).
--
-- Corrigido removendo os overloads antigos — sem nenhuma mudança de
-- frontend necessária, já que os dois pontos acima já omitiam o
-- parâmetro corretamente pra pedir "sem filtro de proprietário" (o
-- default null da única assinatura que sobra resolve isso sozinho).

drop function if exists fn_estoque_rebanho_na_data(uuid[], date);
drop function if exists fn_indicadores_rebanho_dia(uuid[], date);
drop function if exists fn_relatorio_lotacao_mensal(uuid[], date, date);
