@AGENTS.md

# ORION Agro — design system

O ORION Agro é uma ferramenta de trabalho de uso diário (lançamento de movimentações, estoque,
financeiro), não um site institucional. Priorize densidade de informação e velocidade de uso sobre
decoração. Toda tela nova deve seguir este padrão sem precisar reexplicar.

## Cores

Definidas como CSS custom properties em `app/globals.css` e expostas como tokens Tailwind v4 via
`@theme inline` (uso: `bg-brand-500`, `text-error`, etc.).

| Token | Hex | Uso |
|---|---|---|
| `brand-900` | `#0E2A2E` | Fundo da sidebar/topbar mobile |
| `brand-700` | `#15514C` | Hover em superfícies escuras |
| `brand-500` | `#1C8C7C` | Ação principal (botão salvar, link ativo, foco de input) |
| `brand-500-hover` | `#167064` | Hover de `brand-500` |
| `brand-100` | `#E4F3F0` | Tint claro (linha selecionada, destaque sutil) |
| `success` / `success-bg` | `#2E9E5B` / `#E8F6EE` | Confirmação de salvamento |
| `error` / `error-bg` | `#D64545` / `#FBEAEA` | Erro, validação, bloqueio |
| `warning` / `warning-bg` | `#DB9A1F` / `#FAF1DE` | Alerta (ex.: saldo já confirmado, edição sensível) |
| `bg` | `#F6F8F7` | Fundo da página |
| `surface` | `#FFFFFF` | Cards, inputs, tabelas |
| `border` | `#DDE4E1` | Bordas padrão |
| `text-primary` | `#14231F` | Texto principal |
| `text-secondary` | `#5E6E6A` | Texto de apoio, labels |
| `text-muted` | `#8A9793` | Placeholders, hints |

Nunca use verde puro (`success`) como cor de ação principal — `brand-500` é petróleo/verde-água e
precisa ficar visualmente distinto de "sucesso" para não confundir os dois significados.

Paleta categórica separada pros 7 tipos de uso de área (`area-reserva`, `area-pecuaria`,
`area-agricultura`, `area-reforma`, `area-alagada`, `area-infraestrutura`, `area-outros`) — usada
só no gráfico/legenda de distribuição de área, nunca misturada com os tokens semânticos acima.
Mapeamento nome-do-tipo → cor fica em `lib/area-cores.ts` (`corTipoUsoArea`).

## Tipografia

Uma família só: **Inter**, carregada via `next/font/google` em `app/layout.tsx` (variável
`--font-inter`, exposta como `font-sans`). Hierarquia por peso, não por família:
- Títulos (`h1`/`h2` de página): `font-extrabold` (800) ou `font-bold` (700)
- Texto e labels: `font-normal` (400) ou `font-medium` (500)
- Dados tabulares (quantidade, peso, valor): `font-semibold` (600) + `tabular-nums` para alinhar
  dígitos em colunas

## Espaçamento e cantos

- Cards: `rounded-card` (12px), `border border-border bg-surface`, padding `p-5` a `p-6`
- Botões/inputs/badges: `rounded-control` (8px)
- Formulários: campos empilhados com `space-y-4` ou `gap-4` em grid; label em `text-sm font-medium
  text-text-secondary` acima do campo, com `mb-1.5`
- Seções de página: título `text-2xl font-extrabold`, subtítulo opcional `text-sm text-text-secondary
  mt-1`, bloco seguinte com `mt-6` a `mt-8`
- Largura de conteúdo: `max-w-4xl` para formulários/listagens simples, `max-w-6xl` para relatórios

## Componentes padrão

- **Botão primário**: `bg-brand-500 text-white hover:bg-brand-500-hover rounded-control px-4 py-2
  text-sm font-semibold`
- **Botão secundário/cancelar**: `border border-border rounded-control px-4 py-2 text-sm`
- **Card de listagem**: `rounded-card border border-border bg-surface p-5`, título em
  `font-semibold text-text-primary`, metadados em `text-sm text-text-secondary`
- **Estado vazio**: card com `border-dashed`, mensagem convidativa em duas linhas (título em negrito
  + explicação do próximo passo), nunca só "Nenhum item cadastrado"
- **Estado de carregamento**: skeleton (`animate-pulse` com blocos `bg-border`) no formato do
  conteúdo real — nunca só o texto "Carregando..."
- **Aviso/confirmação inline**: use `warning-bg`/`warning` para ações sensíveis que pedem
  confirmação extra (ex.: editar saldo inicial já confirmado), `error-bg`/`error` para bloqueios,
  nunca `window.confirm()`/`alert()` nativo para fluxos de confirmação (só para erros pontuais)

## Peso e valor médio em totais

Qualquer linha de "Total" que precise mostrar peso médio ou valor médio agregando várias categorias
(cada uma com sua própria quantidade) deve usar **média ponderada pela quantidade**
(`soma(peso_total) / soma(quantidade)`), nunca a média simples das médias por categoria — categorias
com mais cabeças devem pesar mais no total. Implementado hoje em `app/saldo-inicial/page.tsx`; ao
adicionar peso/valor médio a outros relatórios (ex.: relatório de movimentação), seguir o mesmo
cálculo.

## Formatação de números

Todo número exibido ao usuário passa por `lib/format.ts` (`Intl.NumberFormat('pt-BR', ...)`) —
nunca `toFixed()` cru nem interpolação direta de número em string, porque isso perde o separador de
milhar (`toFixed(2)` em 1234.5 dá `"1234.50"`, não `"1.234,50"`) e mistura ponto/vírgula com o padrão
brasileiro. Cada grandeza tem sua própria função e sua própria regra de casas decimais — nunca
reaproveitar a função de uma grandeza pra outra mesmo que o número de casas coincida hoje:

| Função | Grandeza | Casas decimais | Exemplo |
|---|---|---|---|
| `formatMoeda` | dinheiro (valores em R$) | 2 | `R$ 1.234,56` |
| `formatQuantidade` | contagem de cabeças/itens | 0 | `1.234` |
| `formatPeso` | peso (kg), valor por arroba, e outras grandezas contínuas genéricas | 2 | `1.234,56` |
| `formatArea` | área (ha) | 2 | `1.234,56` |
| `formatLotacao` | lotação (UA/ha) | 2 | `1,85` |
| `formatGmd` | ganho médio diário (kg) | 3 | `0,850` |
| `formatDecimal` | decimal genérico sem grandeza própria (ex.: arroba por animal) | 2 | `18,33` |

Todas retornam `'—'` para `null`/`undefined`/`NaN`, nunca `"0"` ou string vazia — um valor ausente
não é o mesmo que zero. `formatLotacao`/`formatGmd` ainda não têm uso no app hoje (lotação UA/ha e
GMD são indicadores futuros, já mencionados como forward-looking em `orion_agro_schema.sql`), mas a
regra de casas decimais (2 e 3, respectivamente) já está fixada aqui pra quando forem implementados,
evitando que cada relatório novo escolha um arredondamento diferente. Ao adicionar uma tela nova, use
a função correspondente pela grandeza (não pelo número de casas que "parece certo") — quantidade de
cabeças é sempre `formatQuantidade` mesmo que o valor seja pequeno, dinheiro é sempre `formatMoeda`
mesmo dentro de um card de resumo.

## Campos obrigatórios

Todo campo obrigatório — em formulários de cadastro e em filtros de relatório — leva o componente
`<Required />` (`components/Required.tsx`) logo depois do texto do label: um asterisco em
`text-error`. Vale também para campos condicionalmente obrigatórios (ex.: peso médio só é
obrigatório no DESMAME) — nesse caso o `<Required />` some/aparece junto com a própria
condição. Filtros de relatório que travam a exibição dos dados (ex.: fazenda selecionada) contam
como obrigatórios mesmo sem validação de formulário nativa por trás. Ao criar um campo novo,
sempre decidir se ele é obrigatório e marcar de acordo — não deixar como pendência.

## Envio de formulário

Nenhum `<form>` pode ser enviado apertando Enter num campo — só clicando (ou dando Enter/Espaço)
no botão de salvar. Todo `<form onSubmit={...}>` novo leva `onKeyDown={bloquearEnvioPorEnter}`
(`lib/form-utils.ts`). Existe pra evitar lançamento acidental ao digitar/tabular pelos campos.

## Navegação

`app/layout.tsx` renderiza `components/Sidebar.tsx`, compartilhado por todas as páginas:
- Desktop (`md:` e acima): sidebar fixa de 240px (`brand-900`), com grupos de links ("Gestão",
  "Movimentação") e itens placeholder no rodapé ("Financeiro", "Configurações" — ainda sem rota,
  marcados "em breve")
- Mobile (abaixo de `md:`): topbar fixa com botão hambúrguer que abre um menu retrátil (drawer) com
  os mesmos links
- Item ativo: barra de destaque à esquerda (`border-l-[3px] border-brand-500`) + fundo
  `bg-white/8` + texto branco em negrito
- Ao adicionar uma página nova, inclua o link correspondente em `GROUPS` (ou crie um novo grupo) em
  `components/Sidebar.tsx` — páginas sem link na sidebar ficam inacessíveis pela navegação

## PWA (instalável no celular)

`app/manifest.ts` (convenção de arquivo do Next.js — gera `/manifest.webmanifest` e o `<link
rel="manifest">` sozinho, sem precisar declarar nada em `layout.tsx`) define nome, cores
(`background_color`/`theme_color` usando os tokens `bg`/`brand-900`) e `display: 'standalone'`
(abre sem a barra de endereço do navegador, como um app nativo). `app/icon.svg` é o ícone
(favicon/aba do navegador — sol nascendo sobre um pasto, nas cores da marca) e `app/apple-icon.png`
é a versão raster 180×180 exigida pelo iOS pra "Adicionar à Tela de Início" (ambos são convenções de
arquivo do Next.js, cada um gera sua própria tag automaticamente). Os 3 ícones referenciados pelo
manifest (`public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`) foram
gerados uma única vez a partir de um SVG fonte via `sharp` (instalado como devDependency temporária
e removido depois — não precisa ficar no projeto, só serviu pra rasterizar). A versão "maskable" tem
o mesmo desenho, só que reduzido a ~62% e centralizado, porque o Android aplica sua própria máscara
(círculo/squircle) sobre o ícone adaptativo — sem essa margem extra, partes do desenho (sol, grama)
seriam cortadas nas bordas.

`app/layout.tsx` também define `appleWebApp` (título e cor da barra de status no iOS) e um export
`viewport` com `themeColor` — esse último gera automaticamente tanto a tag moderna
(`mobile-web-app-capable`, reconhecida por Android/Chrome e iOS/Safari recentes) quanto as
específicas do iOS mais antigo (`apple-mobile-web-app-*`), então cobre os dois sem duplicar código.
Escolha deliberada: **sem service worker/cache offline** — o app depende de dados ao vivo do
Supabase pra tudo (lançar movimentação, conferir saldo), então funcionar offline não agregaria valor
real e só adicionaria risco de servir uma versão desatualizada da tela depois de um deploy. O
"instalável" aqui é só ter ícone próprio na tela inicial e abrir em tela cheia — não uma cópia
que funciona sem internet.

## Modelo de categorias de animal

`categorias_animal` tem três atributos derivados automaticamente por trigger
(`fn_calcular_atributos_categoria`) — nunca escolhidos direto no formulário:

- **Grupo Categoria** (`grupos_categoria_papel` — Bezerras Mamando, Novilhas, Garrotes e Bois,
  Matrizes em Reprodução, Matrizes Descarte, Touros, Bezerros Mamando, Outros): papel zootécnico,
  escolhido pelo usuário. Determina o **sexo** automaticamente (trava pro sexo do papel; "Outros" é
  o único com sexo livre, exige seleção manual).
- **Era** (`00-08`/`08-12`/`12-24`/`24-36`/`36+`): escolhida pelo usuário, exceto papéis "Bezerros
  Mamando"/"Bezerras Mamando" — trava em `00-08` automaticamente. Determina o **Grupo Faixa
  Etária** (`grupo_id`/`grupos_categoria` — Bezerro/Jovem/Adulto) automaticamente.

Categoria com `sistema = true` (as 11 pré-cadastradas do sistema) não pode ter nome, papel, sexo,
era ou grupo faixa etária editados nem pode ser excluída (`fn_validar_edicao_categoria` /
`fn_validar_delete_categoria`) — só peso de referência e o status `ativa` continuam livres.
Categoria criada pelo usuário só pode ser excluída se não tiver nenhuma movimentação lançada.

Inativar (`ativa = false`) tira a categoria dos formulários de lançamento (movimentações, saldo
inicial), mas **nunca** dos relatórios — o histórico de período com movimentação real precisa
continuar aparecendo. `fn_relatorio_movimentacao_rebanho` não filtra por `ativa`; quem decide o que
some do relatório é a regra de "linha 100% zerada" no frontend (`linhaEstaZerada` em
`app/relatorio-movimentacao/page.tsx`) — vale tanto pra categoria inativa sem atividade no período
quanto pra categoria ativa nunca usada.

## Gestão de áreas

Mesma arquitetura da movimentação de rebanho, aplicada a hectares em vez de cabeças:
`movimentacoes_area` é um ledger de eventos (`SALDO_INICIAL` ou `MUDANCA_USO`, com tipo de uso
origem/destino) e `fn_area_por_uso(fazenda, tipo_uso, data)` calcula o saldo de área por tipo de
uso somando os eventos até aquela data — igual `fn_saldo_categoria`. Edição/exclusão seguem a
mesma proteção de trajetória já usada pro rebanho (`fn_checar_edicao_area`, mesmo princípio de
`fn_checar_edicao_movimentacao`, só que com 2 baldes — origem/destino — em vez de 6).

Os 7 tipos de uso (`tipos_uso_area`) são fixos, seedados pelo sistema — sem tela de cadastro/edição
própria (diferente de categorias de animal, que o usuário pode criar).

**Média ponderada por dias**: relatórios de área nunca usam média simples — usam a área de cada dia
integrada no período (`fn_area_media_ponderada`, via `generate_series` dia a dia) dividida pelos
dias. Se a área mudou de uso no meio do mês, os dias antes e depois do câmbio entram com pesos
diferentes na média mensal. A média do período completo é derivada das médias mensais ponderadas
pelos dias de cada mês (`soma(média_mês × dias_mês) / soma(dias_mês)`) — matematicamente idêntico a
integrar direto sobre todos os dias do período, sem precisar reconsultar. Essa regra estende a de
"Peso e valor médio em totais" acima (ponderar por quantidade) para o eixo do tempo (ponderar por
dias) — os dois princípios devem ser lembrados juntos ao criar qualquer relatório novo que agregue
por período.

`fn_relatorio_distribuicao_area` retorna uma linha por (mês, tipo de uso) dentro do período
filtrado. **A distribuição de área vive na aba "Distribuição da Área" dentro de Fazendas**
(`components/fazendas/DistribuicaoAreaPanel.tsx`, recebe `fazendaId` como prop — ver "Reorganização
de Fazendas" mais abaixo pra história completa dessa migração) — a fazenda já selecionada no card
da página Fazendas alimenta tanto essa aba quanto a de "Lançar mudança de uso" logo abaixo, sem
seletor de fazenda próprio. O frontend pivota o resultado num gráfico de barras empilhadas (uma barra por mês, cor por
tipo de uso via `corTipoUsoArea`) e numa **tabela com tipo de uso nas linhas e mês nas colunas**
(invertida em relação ao gráfico, que continua com mês no eixo horizontal) — cada linha termina em
duas colunas: "Área média" (ponderada pelos dias, não a média mensal simples) e, por último, "Área
final" — a área alocada naquele tipo de uso no **último dia do período** (`fn_area_por_uso` chamada
direto na `data_fim`, uma vez por tipo de uso, sem função SQL nova), não uma média. Cabeçalho da
coluna leva `title` (tooltip nativo no hover) explicando essa diferença, já que só o nome "Área
final" sozinho pode ser confundido com mais uma média. O rodapé soma os tipos de uso por mês (e
também a coluna "Área final") numa linha "Total". Linha de tipo de uso 100% zerada no período visível não aparece
(mesmo princípio de "linha 100% zerada" do relatório de rebanho). O gráfico fica centralizado e com
largura de barra flexível (`flex-1` + `max-width`, container `mx-auto max-w-3xl`) — nunca largura
fixa por mês. Valores de área sempre exibidos com 2 casas decimais fixas (`formatArea`, de
`lib/format.ts` — ver "Formatação de números" abaixo), nunca arredondamento simples que pode esconder
o `.00`.

Área nunca "some" depois de declarada — só realoca entre tipos de uso — então um mês com total
zerado (soma de todos os tipos de uso = 0) só pode significar que ainda não havia saldo inicial
naquela data. Esses meses são filtrados fora da tabela/gráfico **e** da conta da área média (senão
dias sem nenhum dado puxariam a média pra baixo indevidamente).

**Área inicial por tipo de uso é cadastrada na aba "Área Inicial" de Fazendas**, diferente da aba
"Distribuição da Área" — que só mostra a distribuição já consolidada e lança/edita `MUDANCA_USO`
(mudanças de uso ao longo do tempo). As duas ficam lado a lado como abas do mesmo painel por
fazenda (ver "Reorganização de Fazendas" mais abaixo).

## Filtros de período (Mês / Ano Safra / Ano Calendário / Período personalizado)

Todo relatório com filtro de período (`components/fazendas/DistribuicaoAreaPanel.tsx` e
`app/relatorio-movimentacao/page.tsx` — o "Rebanho por pasto" é uma foto de um dia só, não se
aplica) oferece 4 opções, não só mês e período personalizado. "Ano Safra" (1º de julho a 30 de
junho — se estamos entre janeiro e junho, a safra vigente começou em julho do ano anterior) e "Ano
Calendário" (1º de janeiro a 31 de dezembro) não trazem só o ano corrente: cada modo abre um
`<select>` com o ano-safra/ano-calendário atual e os 5 anteriores (`opcoesSafra`/`opcoesAno` em
`lib/periodo.ts`), com o atual marcado "(atual)" e pré-selecionado por padrão ao clicar no filtro.
`periodoSafra(anoInicio)`/`periodoAno(ano)` (também em `lib/periodo.ts`, reaproveitadas nas duas
telas — nunca duplicar essa conta de datas num componente) calculam o intervalo: **só o ano-safra/
ano-calendário atual** vai até o fim do mês corrente (uma previsão — pra área, se nada mais for
lançado até lá, o estado atual persiste); qualquer ano anterior já está encerrado, então vai até a
data fixa (30/06 ou 31/12), sem previsão nenhuma.

**Rebanho não tem essa previsão** — não é possível lançar movimentação com data futura, então
`app/relatorio-movimentacao/page.tsx` (e a data única de `relatorio-rebanho-por-pasto`) trava o
`data_fim` efetivo em `min(data_fim_calculada, hoje)` antes de consultar e de exibir, além de `max`
nos próprios inputs (mês corrente / hoje) pra nem deixar escolher uma data futura. O número em si já
seria idêntico de qualquer forma (nada muda depois de hoje), mas sem o clamp o rótulo mostraria uma
data futura como se fosse uma foto real — só uma questão de exibição, não de cálculo.

## Controle de rebanho por pasto

Opt-in único pro grupo inteiro via `configuracoes.controla_pasto` (tabela singleton — uma linha só,
garantida por índice único sobre expressão constante — não uma coluna por fazenda). Editável a
qualquer momento em `app/fazendas/page.tsx` (topo da página, fora dos cards de fazenda) e vale pra
todas as fazendas do grupo de uma vez — não dá pra ligar só numa fazenda específica, decisão
explícita pra simplificar e padronizar. Hierarquia de dois níveis: **módulo** (onde roda o pastejo
rotacionado,
`modulos`) contém **pastos/talhões** (`pastos`, mesma tabela pros dois — "Pasto" vs "Talhão" é só
rótulo de exibição conforme `modulos.tipo_utilizacao`). Só `PECUARIA` é utilizável hoje —
`AGRICULTURA` fica reservada no enum `tipo_utilizacao_modulo` pra não exigir migração de schema
quando talhão for implementado (`ck_modulo_tipo_utilizacao` trava em `PECUARIA` por enquanto).

Toda fazenda ganha módulo + pasto **"Geral"** automaticamente ao ser criada
(`fn_criar_modulo_pasto_geral`, trigger `AFTER INSERT on fazendas`) — esse par nunca é removido pela
UI (só inativado, e só se não for o único ativo), então toda fazenda sempre tem exatamente um pasto
pra apontar enquanto `controla_pasto` estiver desligado, e ligar depois nunca exige migração de
dados (nem por fazenda nem em lote). Cadastro/edição de módulos e pastos (criar, renomear,
redimensionar, ativar/inativar) fica em `app/fazendas/page.tsx` (seção expansível "Módulos e pastos"
em cada card de fazenda, só aparece se `controla_pasto` estiver ligado no grupo) — igual ao padrão
já usado pra área inicial. `ativo = false` só tira o módulo/pasto dos seletores de lançamento, nunca
dos relatórios/histórico (mesmo princípio de `ativa` em categorias).

**Exclusão de módulo/pasto**: mesmo princípio já usado em categorias de animal — excluir só é
permitido se não houver histórico (pasto sem nenhuma referência em `movimentacoes_rebanho`, nem como
origem nem como destino, e sem `pesagens`; módulo sem nenhum pasto/talhão cadastrado, exclua-os
primeiro), checado por trigger (`fn_validar_delete_pasto`/`fn_validar_delete_modulo`), não só
escondido na UI. O par "Geral" auto-criado (`fn_criar_modulo_pasto_geral`) tem uma coluna `sistema`
própria (mesmo padrão do `categorias_animal.sistema`) que bloqueia a exclusão incondicionalmente —
só inativação —, mesmo que o usuário renomeie esse par depois (por isso a proteção não pode
depender do nome "Geral"). Confirmação de exclusão é inline (texto + "Sim, excluir"/"Cancelar" em
`error`/`bg-error`), nunca `window.confirm()`.

**Reconciliação com área**: a soma das áreas (`area_ha`) de todos os pastos de uma fazenda nunca
pode ultrapassar a área alocada em "Pecuária" nessa fazenda **na data de hoje**
(`fn_validar_area_pasto`, via `fn_area_por_uso(..., current_date)`) — checado só no momento de
criar/editar um pasto, sem histórico por data no pasto e sem reconciliação retroativa se a área de
Pecuária encolher depois (opção simples, decisão explícita do usuário).

`movimentacoes_rebanho` tem `pasto_id` (sempre obrigatório — se `controla_pasto` estiver desligado
no grupo, só existe o "Geral" pra escolher, e o formulário preenche sozinho) e `pasto_destino_id`
(nullable, só usado em `MUDANCA_PASTO` e `TRANSFERENCIA` — ver `ck_pasto_destino`).
`MUDANCA_CATEGORIA`/`DESMAME` nunca mudam de pasto no mesmo lançamento (precisa de um `MUDANCA_PASTO`
à parte pra isso). No formulário de `app/movimentacoes/page.tsx`, o seletor de pasto (origem) só
aparece quando o grupo tem `controla_pasto` ligado **e** a fazenda envolvida tem mais de um pasto
ativo — do contrário o pasto "Geral" é preenchido sozinho, sem UI. Mesmo princípio para o pasto de
destino em `TRANSFERENCIA`; em `MUDANCA_PASTO` o destino é sempre um seletor obrigatório (é o
propósito do lançamento), bloqueado com aviso se `controla_pasto` estiver desligado ou a fazenda não
tiver pelo menos 2 pastos ativos em uso.

`fn_saldo_categoria(fazenda, categoria, data)` continua sendo o agregado da fazenda inteira, sem
mudanças — pasto é uma dimensão ortogonal que não afeta essa soma (`MUDANCA_PASTO` sempre entra e
sai dentro da mesma fazenda). `fn_saldo_categoria_pasto(fazenda, categoria, pasto, data)` é o
equivalente no nível de pasto; vale sempre `fn_saldo_categoria = soma, sobre todos os pastos da
fazenda, de fn_saldo_categoria_pasto`. A trajetória de edição/exclusão (`fn_checar_edicao_movimentacao`,
`fn_delta_para_par`) passou de pares (fazenda, categoria) pra trios (fazenda, categoria, pasto) —
checar a trajetória em todo trio afetado no nível de pasto cobre também o nível de fazenda inteira
(soma dos pastos = saldo da fazenda), então não precisa checar as duas dimensões separadamente ali.
A trigger de saldo insuficiente (`fn_validar_saldo_categoria`) continua checando o nível de fazenda
(como antes) e **também** o nível de pasto (novo) — os dois convivem como defesa em profundidade.

## Controle de Pasto (módulo separado)

`MUDANCA_PASTO` deixou de ser lançável em `app/movimentacoes/page.tsx` e ganhou tela própria em
`app/controle-pasto/page.tsx` — existe pra permitir, no futuro modelo de permissões por perfil (ver
memória de projeto sobre perfis customizáveis), liberar só esse módulo pra um perfil tipo "peão de
campo" sem precisar de nenhuma trava fina dentro da tela geral de Movimentações: acesso ao módulo
inteiro já delimita exatamente esse tipo de lançamento. Continua sendo o mesmo tipo `MUDANCA_PASTO`
na mesma tabela `movimentacoes_rebanho` — nenhuma mudança de schema, só de organização de tela.
`app/movimentacoes/page.tsx` remove `MUDANCA_PASTO` de `TIPOS`/`TIPOS_COM_LOTE` (não aparece mais no
seletor de tipo nem no filtro) e exclui esse tipo da query de listagem (`.neq('tipo',
'MUDANCA_PASTO')`) — sem isso, um lançamento antigo apareceria ali sem os campos/JSX que cuidavam
dele (já removidos), quebrando a edição.

`app/controle-pasto/page.tsx` reimplementa, de forma simplificada (sem peso/preço/cliente/ajustes,
que `MUDANCA_PASTO` nunca usou), o mesmo padrão de lote já estabelecido em Movimentações: linhas de
categoria + quantidade repetíveis, `grupo_lancamento_id` compartilhado quando há 2+ categorias,
insert atômico em lote, e a mesma checagem de trajetória (`fn_checar_edicao_movimentacao`) por linha
antiga antes de apagar e reinserir ao editar. O bloqueio "essa fazenda só tem um pasto ativo" (mesma
regra de antes: `controla_pasto` desligado no grupo, ou fazenda com menos de 2 pastos ativos)
continua idêntico, já que sem 2+ pastos o módulo inteiro não faz sentido. Navegação: grupo próprio
"Pastejo" na sidebar (`components/Sidebar.tsx`), com "Controle de Pasto" e "Rebanho por pasto"
juntos (saíram do grupo "Movimentação") — os dois giram em torno de onde o rebanho está, então faz
sentido ficarem lado a lado; a página de lançamento linka direto pro relatório de distribuição.

## Pesagens e peso médio nos relatórios

Peso é atribuído por **fazenda + categoria + pasto** — `app/pesagens/page.tsx` lança registros na
tabela `pesagens` (data + peso médio kg + observação opcional). `pasto_id` é sempre obrigatório,
mesmo princípio do pasto em `movimentacoes_rebanho`. Isso existe porque, com controle por pasto
ligado, o mesmo lote de uma categoria pode estar em pastos diferentes com peso médio diferente (ex.:
um piquete com pasto melhor engorda mais rápido) — pesar "a categoria" sem dizer de qual pasto
perderia essa diferença.

**Fluxo de lançamento (página única, sem wizard)**: primeiro Data + Fazenda; se o grupo usa
`controla_pasto`, aparece um toggle "Por categoria" / "Por pasto" (se não usa, é sempre "por
categoria", sem toggle — só existe o pasto "Geral" mesmo). Em qualquer um dos dois modos, o que abre
embaixo é uma **tabela em lote** (categoria + quantidade atual + campo de peso), não um formulário de
uma linha por vez — dá pra pesar várias categorias no mesmo lançamento. **Modo "por pasto"**: escolhe
o pasto primeiro, e a tabela mostra só as categorias que têm saldo (`fn_relatorio_rebanho_por_pasto`)
naquele pasto específico naquela data — evita listar categoria que nem está ali. **Modo "por
categoria"**: mostra todas as categorias ativas (quantidade agregada de todos os pastos, como
referência), e ao salvar, o peso digitado é gravado **em todos os pastos onde aquela categoria tem
saldo na data** — mesmo peso, um registro por pasto (fan-out), com uma nota inline avisando esse
comportamento. Se a categoria ainda não tem saldo em nenhum pasto, cai pro pasto "Geral" da fazenda
(mantém possível registrar peso antes do primeiro lançamento de estoque). Essa lógica de fan-out usa
os mesmos dados já retornados por `fn_relatorio_rebanho_por_pasto` — não precisou de função SQL nova.

Qualquer relatório que precise de "peso médio atual" de uma categoria num pasto busca a pesagem mais
recente com `data <= data_do_relatório` casando **fazenda + categoria + pasto** exatos, e cai pro
`categorias_animal.peso_referencia_kg` se aquele pasto especificamente nunca foi pesado — nunca busca
a pesagem de outro pasto da mesma fazenda como segunda tentativa (mesma lógica de "sem fallback
cruzado" já usada em outros pontos do sistema: cada dimensão é resolvida com o dado mais específico
disponível, sem interpolar de dimensões vizinhas). `pesagens` não participa do saldo/estoque (sem
trigger de validação de trajetória) — só exclusão simples com confirmação inline, sem o
edição-com-aviso usado em movimentações.

`fn_relatorio_rebanho_por_pasto(fazenda, data)` é uma **fotografia num dia** (não um período — pasto
é "onde os animais estão agora"), não uma agregação por intervalo como os outros relatórios. Uma
linha por (pasto, categoria) com `quantidade > 0` (via `fn_saldo_categoria_pasto`) e o peso médio
resolvido como acima. `app/relatorio-rebanho-por-pasto/page.tsx` agrupa isso numa lista única com o
pasto mesclado (`rowSpan`) nas linhas que ele ocupa — formato de lista vertical, não em colunas por
pasto, porque fazendas com muitos pastos ficariam apertadas num crosstab horizontal. A linha de
"Total geral" usa peso médio **ponderado pela quantidade** (mesmo princípio de "Peso e valor médio em
totais" acima), mas só sobre as linhas com peso conhecido — misturar quantidade de peso desconhecido
como se fosse "0 kg" puxaria a média pra baixo indevidamente.

## Peso médio obrigatório e compilação automática em Pesagens

Peso médio (`peso_medio_kg`) é obrigatório em **toda** movimentação, tanto no formulário quanto no
banco (`ck_peso_medio_obrigatorio`), com uma única exceção: `MUDANCA_PASTO`, onde o peso é opcional
— se não informado no lançamento de Controle de Pasto, o lote simplesmente continua com o último
peso conhecido (nenhuma ação precisa acontecer nesse caso). A constraint foi adicionada `not valid`
na migração 028 — não quebra os lançamentos antigos sem peso já existentes (a maioria é Mudança de
Pasto, que continua sem exigir; sobravam 1 Nascimento e 1 Compra legados), só passa a valer pra
inserts/updates novos. Se um desses lançamentos antigos for editado, o peso passa a ser exigido
nesse momento — não é retroativo.

`peso_total_kg` deixou de ser calculado por tipo (antes só os comerciais/transferência calculavam
via `fn_calcular_valores_movimentacao`, e Mudança de Categoria tinha um campo "Peso total" digitado
à mão, sem relação garantida com o peso médio) e passou a ser **sempre** derivado de
`peso_medio_kg × quantidade` por um trigger novo (`fn_calcular_peso_total_movimentacao`), pra
qualquer tipo. Esse trigger roda antes de `fn_calcular_valores_movimentacao` (ordem alfabética do
nome: `trg_calcular_peso_total` < `trg_calcular_valores_movimentacao`), já que este último usa
`peso_total_kg` como entrada pro cálculo de arroba/valor.

**Toda movimentação salva com peso médio compila automaticamente em `pesagens`** — não só as
lançadas manualmente na tela de Pesagens. `fn_compilar_pesagem_movimentacao` (trigger `AFTER INSERT
OR UPDATE` em `movimentacoes_rebanho`) cria ou atualiza um registro em `pesagens` ligado por
`pesagens.movimentacao_id` (nulo pras pesagens manuais). Fazenda/categoria/pasto usados são sempre
os de "destino" quando existem, senão os campos únicos (`coalesce(fazenda_destino_id, fazenda_id)`
e o mesmo padrão pra categoria/pasto) — cobre todos os tipos sem lógica por tipo: Mudança de
Categoria/Desmame usam a categoria nova, Transferência usa a fazenda/pasto de destino, Mudança de
Pasto usa o pasto de destino. `on delete cascade` na FK apaga o registro compilado junto quando a
movimentação é apagada; o `UPDATE` do trigger cobre edição (inclusive remover o peso de uma Mudança
de Pasto, que apaga o registro compilado). "O último peso sempre atualiza o anterior do lote" não
precisou de lógica nova — como a busca de peso mais recente (`fn_relatorio_rebanho_por_pasto`) já
pega sempre o registro de `pesagens` com maior `data`, isso já funciona automaticamente assim que o
dado entra na tabela, venha de onde vier.

Um registro compilado automaticamente **não pode ser excluído direto na tela de Pesagens**
(`fn_validar_delete_pesagem` bloqueia com uma mensagem explicando pra editar/excluir a movimentação
em vez disso) — excluir o registro de peso por fora deixaria a movimentação e Pesagens
dessincronizados até a próxima edição dela. Essa trigger precisa checar se a movimentação de origem
**ainda existe** (não só se `movimentacao_id` não é nulo): apagar a movimentação dispara o `on
delete cascade` da mesma FK, que tenta apagar o registro compilado — nesse ponto a movimentação já
não existe mais, e a exclusão precisa ser permitida, senão a cascata trava e a movimentação nem
consegue ser apagada (bug encontrado e corrigido ainda durante o teste desta funcionalidade, antes
de qualquer uso real — ver migração 029).

`app/saldo-inicial/page.tsx` tinha um bug pré-existente descoberto ao implementar essa regra: nunca
enviava `pasto_id` no lançamento, e como essa coluna é `not null`, qualquer categoria *nova*
adicionada ao saldo inicial falhava (com uma mensagem de erro enganosa de "pasto não pertence à
fazenda", vinda de `fn_validar_pasto_pertence_fazenda` rodando antes da checagem de not-null). A
tela ganhou o mesmo padrão de seletor de pasto já usado em Controle de Pasto (some sozinho pro
"Geral" quando o grupo não usa `controla_pasto` ou a fazenda só tem um pasto ativo) — um único pasto
por lançamento de saldo inicial, aplicado a todas as categorias daquela fazenda.

## Desconto e acréscimo em movimentações comerciais

Vale só pros 4 tipos com `valor_total` (`COMPRA`, `VENDA_PE`, `VENDA_ABATE`, `CONSUMO_DOACAO`) —
checado por trigger (`fn_validar_ajuste_movimentacao_comercial`), não só escondido na UI. Dois
níveis: um **catálogo reutilizável** (`itens_ajuste_financeiro` — nome + tipo `DESCONTO`/
`ACRESCIMO`, ex.: "Frete" como acréscimo) e o **lançamento por movimentação**
(`movimentacao_ajustes` — qual movimentação, qual item, valor), permitindo vários itens por venda.
Cadastro de item novo é inline no próprio formulário (select com opção "+ Novo item..." que revela
um campo de nome) — mesmo espírito do "+ Novo" já usado em Cliente/Fornecedor, mas sem modal
separado, já que aqui é só um nome.

**Valor líquido nunca é guardado** — sempre `valor_total - soma(descontos) + soma(acréscimos)`,
calculado na hora (preview em `app/movimentacoes/page.tsx` durante o lançamento, e a partir do join
`movimentacao_ajustes(item:itens_ajuste_financeiro(...))` na listagem) — mesmo princípio de nunca
persistir um valor derivado que já vale pra saldo/estoque no resto do sistema, evita ficar
dessincronizado se um item for editado ou removido depois. Editar uma movimentação **substitui**
todos os seus ajustes pelos que estão no formulário no momento de salvar (apaga tudo e reinsere) —
inclui o caso do tipo ser trocado pra fora dos comerciais durante a edição, que limpa os ajustes sem
tentar reinserir (a trigger rejeitaria mesmo).

## Lançamento de mais de uma categoria por movimentação (lote)

Na prática é comum vender/comprar/transferir mais de uma categoria no mesmo lote (ex.: garrotes e
novilhas pro mesmo comprador, no mesmo dia). `TIPOS_COM_LOTE`
(`NASCIMENTO`, `MORTE`, `COMPRA`, `VENDA_PE`, `VENDA_ABATE`, `CONSUMO_DOACAO`, `TRANSFERENCIA`)
mostram uma tabela repetível de linhas (categoria + quantidade + peso médio +
preço, cada campo só aparece se o tipo precisar) em vez do formulário de categoria única, com um "+
Adicionar categoria" pra incluir mais linhas. `MUDANCA_CATEGORIA` e `DESMAME` ficam de fora — os
dois já têm duas categorias por lançamento (origem+destino), então uma "linha de lote" exigiria
dois seletores de categoria cada, complexidade desproporcional ao ganho; continuam com um
lançamento por vez.

Campos compartilhados (data, fazenda(s), pasto(s), cliente/fornecedor, causa da morte, subtipo
consumo/doação, observação, descontos/acréscimos) são preenchidos uma vez só e aplicados a todas as
linhas. As linhas são inseridas numa **única chamada de insert em lote** (`handleSubmitLote`, uma
chamada com várias linhas, não N inserts separados) — isso garante atomicidade (se uma linha
estourar o saldo, a trigger rejeita e nenhuma linha é salva) e, como o Postgres processa cada linha
de um INSERT multi-linha em sequência, a checagem de saldo de uma linha já enxerga o efeito das
linhas anteriores do mesmo lote.

**Desconto/acréscimo é um valor único do lançamento inteiro**, não por categoria — dividido
proporcionalmente pelo valor bruto de cada linha na hora de salvar (`valorLinha / somaValorTotal`),
gravado como `movimentacao_ajustes` própria por linha, pra o "valor líquido" somado bater com o
valor líquido total do lançamento. O valor bruto por categoria continua sempre visível linha a
linha (preview "Valor total (bruto) dessa categoria"), já que cada categoria tem seu próprio preço.

### Agrupamento na listagem e edição do lote inteiro

Um lote de 2+ linhas ganha um `grupo_lancamento_id` (uuid gerado no cliente, `crypto.randomUUID()`)
compartilhado entre as linhas — puramente um id de correlação, sem tabela própria; cada linha
continua uma movimentação independente pro resto do sistema (saldo, relatórios, trajetória — ver
"Relatório por movimentação" mais abaixo). Uma linha lançada sozinha (fora do modo lote, ou um lote
de 1 linha só) fica com `grupo_lancamento_id = null`.

Na listagem, `gruposMovimentacoes` (client-side, agrupando as linhas já carregadas por
`grupo_lancamento_id`) funde as linhas de um mesmo grupo num único card — cabeçalho com
tipo/data/fazenda/cliente (idênticos em todas as linhas, por construção), uma linha por categoria
com seus próprios valores, e um rodapé com quantidade/bruto/líquido somados. Um grupo de 1 linha só
renderiza exatamente como uma movimentação avulsa (sem card diferente) — o agrupamento é
transparente até realmente existirem 2+ categorias.

Clicar em "Editar" num card agrupado (`iniciarEdicaoGrupo`) reabre o formulário de lote com todas as
linhas, campos de cabeçalho vindos da primeira linha, e desconto/acréscimo **reconstruído** somando
de volta o que foi dividido proporcionalmente por linha (`reconstruirAjustesGrupo` — o inverso exato
do rateio). Salvar (`handleSubmitLote` com `editandoGrupoId` setado) roda a mesma checagem de
trajetória já usada pra editar uma movimentação avulsa
(`fn_checar_edicao_movimentacao`) em **cada linha antiga do grupo** antes de tocar em qualquer
coisa — se alguma tiver movimentação posterior dependente, mostra o mesmo aviso de confirmação já
usado em edição avulsa, agora estendido pro grupo inteiro (`avisoEdicaoFuturaGrupo`). Confirmando
(ou se nada tem conflito), `finalizarSalvarLote` apaga todas as linhas antigas do grupo e insere as
novas com o mesmo `grupo_lancamento_id` — o mesmo princípio de "apaga e reinsere" já usado em
`sincronizarAjustes`, só que agora nas movimentações em si, não só nos ajustes. Isso significa que
uma edição pode livremente adicionar/remover categorias do lote, não só ajustar valores.

## Peso morto/rendimento de carcaça obrigatório em venda abate

`movimentacoes_rebanho` já tinha `peso_morto_kg`/`rendimento_carcaca_pct` e uma trigger
(`fn_calcular_valores_movimentacao`) que deriva um do outro e escolhe a base de cálculo da arroba:
peso morto/15 quando disponível, senão peso vivo/30 (fallback). Esses campos nunca tinham UI — toda
venda abate lançada até então caía no fallback de peso vivo/30, que embute uma suposição *silenciosa*
de 50% de rendimento (`peso_vivo × 0.5 / 15 = peso_vivo / 30`), sem o usuário nunca ver ou escolher
esse número. Um animal de 500kg com rendimento real de 55% (18,33@) seria cobrado como se desse
16,67@ — uma diferença real de dinheiro, não só de exibição.

Por isso `VENDA_ABATE` (só esse tipo — os outros comerciais continuam livres pra usar o fallback
quando o rendimento real não é conhecido) agora **exige** peso morto ou rendimento de carcaça, um
por categoria/linha (`isVendaAbate`, campo com `<Required />` tanto no formulário de lote quanto no
de edição avulsa). Validado nos dois lados: `ck_venda_abate_peso_morto_ou_rendimento` no banco
(bloqueia mesmo se alguém inserir direto via SQL/API) e `alert()` no frontend antes de chamar
`fn_checar_edicao_movimentacao`/inserir. `resolverBaseArroba` (`lib` inline no componente) espelha em
JS a mesma escolha de base/fator que a trigger faz no banco, usada tanto no preview do lote
(`calcularLinha`) quanto no preview da edição avulsa (`totalArrobas`) — sem isso o "Valor total
(bruto)" mostrado durante o lançamento ficaria incorreto mesmo com o banco calculando certo depois.

**Preenchimento automático e peso em arrobas por animal**: peso morto e rendimento de carcaça se
calculam um a partir do outro assim que qualquer um dos dois é digitado
(`atualizarPesoMortoLinha`/`atualizarRendimentoLinha` no lote, `handlePesoMortoChange`/
`handleRendimentoChange` na edição avulsa) — cada handler só escreve no campo que **não** está sendo
digitado, nunca sobrescreve o que o usuário acabou de teclar. Existe pra deixar claro que só um dos
dois precisa ser preenchido, evitando a dúvida de "preciso informar os dois?". Junto com isso, o
peso em arrobas por animal (`arrobaPorAnimal` de `calcularLinha`) aparece ao vivo assim que peso
médio + peso morto/rendimento estão preenchidos ("Peso em arrobas: 18,33 @/animal") — antes desse
número só aparecia depois de salvo, dentro do valor calculado.

Todos os campos que alimentam esse cálculo são obrigatórios em `VENDA_ABATE`: categoria, quantidade,
peso médio, peso morto **ou** rendimento (um dos dois, com o mesmo `<Required />` condicional já
usado noutros campos condicionalmente obrigatórios), e depois um dos quatro campos de preço (arroba/
cabeça/kg/total). Peso médio já era obrigatório em `VENDA_ABATE` antes de virar obrigatório em toda
movimentação (ver "Peso médio obrigatório e compilação automática em Pesagens") — sem ele não dá pra
resolver o peso base da arroba nem mostrar o preview.

**Bruto por categoria, sem duplicar o total do lançamento**: cada linha sempre mostra seu "Valor
total (bruto) dessa categoria" (via `calcularLinha`), mas a linha separada "Valor bruto total do
lançamento" só aparece pra `TRANSFERENCIA` (que não tem ajuste financeiro) — pros 4 tipos comerciais
com desconto/acréscimo (`isComPreco && !isComAjuste`), esse total já aparece embaixo, no resumo
"Valor bruto (todas as categorias)" ao lado de descontos/acréscimos/líquido, então repetir uma
segunda linha de "bruto total" seria redundante e um número a mais pra conferir sem necessidade.

## Filtro na listagem de movimentações

`app/movimentacoes/page.tsx` tem um filtro (fazenda, tipo, categoria, data início/fim) acima da
listagem — existe pra achar/conferir um lançamento específico antes de editar, já que sem filtro a
lista só traz os 20 lançamentos mais recentes (`carregarMovimentacoes`). Sem nenhum filtro ativo o
`.limit(20)` continua valendo (carregamento leve, comportamento de sempre); assim que qualquer filtro
é aplicado o limite é removido e todos os lançamentos que baterem aparecem, sem paginação — o
objetivo aqui é achar, não navegar por páginas.

O filtro de **fazenda** casa `fazenda_id` OU `fazenda_destino_id` (`.or()`), e o de **categoria** casa
`categoria_id` OU `categoria_destino_id` — nos dois casos porque tipos como `TRANSFERENCIA` e
`MUDANCA_CATEGORIA`/`DESMAME` guardam a fazenda/categoria "nova" num campo `_destino_id` separado;
filtrar só pelo campo de origem esconderia lançamentos onde o valor buscado é o destino. Os selects de
fazenda/categoria do filtro carregam **todas** as fazendas/categorias (sem o `.eq('ativo'/'ativa',
true)` usado no formulário de lançamento), porque um lançamento antigo pode referenciar uma
fazenda/categoria já inativada — o filtro precisa continuar achando esse histórico.

## Lote de nascimento (safra) para bezerros

Fazendas de cria agrupam bezerros por **safra de nascimento** (estação de monta — ex.: "safra
2025/2026"), e o sistema precisa respeitar esse agrupamento em qualquer movimentação que envolva
bezerro, não só no nascimento — senão o saldo por safra vira bagunça assim que o primeiro
lote é parcialmente vendido/morto/transferido/desmamado. `movimentacoes_rebanho.
safra_nascimento_ano_inicio` (int, ex.: `2025` para "2025/2026") é a única coluna dessa dimensão —
migração 030 também tinha `mes_nascimento` (mês exato), removida na migração 031 por decisão do
usuário: exigia um segundo campo em todo lançamento (obrigatório em Compra/Saldo Inicial, seletor de
dois níveis nas saídas) sem ganho proporcional, já que o mês não sobrevivia além do lançamento de
entrada de qualquer forma (uma saída não carrega "de qual mês" foi puxada, só quanto). Perda real
aceita conscientemente: não dá pra perguntar "quantos nasceram em junho" depois do lançamento
inicial — só "quantos da safra 2025/2026" — mas a data exata de cada Nascimento/Compra/Saldo Inicial
continua no campo `data` de cada lançamento, só não alimenta mais uma dimensão de saldo separada.

**Só se aplica quando a categoria envolvida é bezerro** — `fn_categoria_e_bezerro(categoria_id)`
checa o papel (`grupos_categoria_papel.nome in ('Bezerros Mamando', 'Bezerras Mamando')`), não o
grupo faixa etária (que pode incluir "Outros" com era 00-08). No frontend, o equivalente é
`categoriaEhBezerro(c)` em `app/movimentacoes/page.tsx`, usando `PAPEIS_BEZERRO_MAMANDO` de
`lib/faixa-etaria.ts`.

**Regras por tipo de lançamento** (`fn_validar_lote_nascimento_bezerro`, trigger `before insert or
update` em `movimentacoes_rebanho`):
- **Bezerro só entra no sistema por Nascimento, Compra ou Saldo Inicial** — nunca por Mudança de
  Categoria (nem como origem, nem como destino; a única evolução de bezerro é o Desmame). A trigger
  bloqueia com exceção direta se `MUDANCA_CATEGORIA` envolver bezerro em qualquer ponta. No frontend,
  isso já é impedido pela UI (`categoriasVisiveis`/o seletor de destino filtram bezerro fora das
  opções pra `MUDANCA_CATEGORIA` — ver `!categoriaEhBezerro(c)`), mas a trigger é a fonte de verdade
  (defesa em profundidade, igual todo o resto do sistema).
- **Desmame exige categoria destino com era exatamente `08-12`** (não basta ser do grupo Jovem
  genérico) — `categoriasDestinoDesmame` no frontend já filtra por isso, a trigger reforça.
- **Todo lançamento cuja categoria de origem é bezerro exige `safra_nascimento_ano_inicio`
  preenchido** — Nascimento, Compra, Saldo Inicial (entrada) e Morte/Venda em Pé/Venda Abate/
  Consumo-Doação/Desmame/Transferência (saída).

**Safra é sempre sugerida, nunca travada**: `safraSugeridaParaData(dataIso)` em `lib/periodo.ts`
generaliza a mesma regra julho-junho de `anoInicioSafraAtual()` (mês ≥ 7 → ano corrente; senão ano
anterior) pra uma data qualquer, não só hoje. O campo de safra em todo formulário mostra esse valor
sugerido via `value={linha.safraNascimento || (data ? String(safraSugeridaParaData(data)) : '')}` —
mas o usuário sempre pode digitar por cima, porque a parição real pode cair fora da janela calendário
(ex.: bezerro da safra 26/27 nascido no fim de junho de 2026, ainda dentro da janela julho-junho da
safra 25/26). No submit, se o campo não foi tocado, o valor sugerido é o que efetivamente é gravado
(`safraNascimento ? parseInt(...) : safraSugeridaParaData(data)`) — nunca fica em branco silenciosamente
mesmo que o usuário nunca clique no campo, já que a sugestão é sempre calculável a partir de `data`
(campo já obrigatório em todo lançamento).

**Saldo por lote é uma dimensão independente do pasto** — `fn_saldo_categoria_safra(fazenda,
categoria, safra, data)` segue o mesmo princípio de `fn_saldo_categoria_pasto`, mas as duas dimensões
não se cruzam (decisão explícita de simplicidade: rastrear seria fazenda×categoria×pasto×safra,
complexidade desproporcional). `fn_validar_saldo_categoria` chama essa função como checagem adicional
(além do saldo por fazenda inteira e por pasto) sempre que o lançamento carrega
`safra_nascimento_ano_inicio` e é um tipo de saída. A trajetória de edição/exclusão tem sua própria
versão paralela e independente da de pasto: `fn_delta_para_par_lote`/`fn_checar_saldo_lote_futuro`
(mesmo princípio de `fn_delta_para_par`/`fn_checar_edicao_movimentacao`, mantida deliberadamente
separada — função e assinatura próprias — pra não mexer nos call sites já existentes da versão por
pasto). Essa versão da trajetória só é chamada pelas triggers de bloqueio (`fn_validar_edicao_movimentacao`/
`fn_validar_delete_movimentacao`), não é exposta ao frontend pro aviso de confirmação "há
lançamentos futuros" — violação na dimensão do lote vira exceção direta do banco em vez do aviso
amigável que a versão por pasto tem.

**Seletor de lote nas saídas**: `fn_lotes_nascimento_disponiveis(fazenda, categoria, data)` lista
todas as safras com saldo > 0 pra aquela fazenda+categoria — mostra só a quantidade disponível, sem
peso (não faz sentido pro lote de origem, e o usuário pediu explicitamente pra não mostrar). Alimenta
o seletor de lote em Morte/Venda em Pé/Venda Abate/Consumo-Doação/Transferência (linha por linha no
lançamento em lote, ou o campo único no formulário de edição avulsa) e no Desmame — em todos os
casos, o campo só aparece quando a categoria da linha é bezerro (`categoriaEhBezerro`), reaproveitando
a mesma função `buscarLotesDisponiveis` em `app/movimentacoes/page.tsx`.

**Desmame vira uma estrutura própria** (`linhasDesmame`, não reaproveita `LinhaCategoria`/`linhas`) —
categoria origem/destino, fazenda e pasto ficam fixos no cabeçalho do lançamento (únicos por
lançamento, igual antes), e as linhas repetíveis variam só por lote (safra) + quantidade + peso médio
— um mesmo lançamento pode desmamar de safras diferentes (raro, mas suportado) ou em ondas ao longo
do tempo (cada Desmame é um lançamento novo, reduzindo o saldo daquela safra). Editar reabre via
`iniciarEdicaoDesmame`, que reaproveita o mesmo mecanismo `editandoGrupoId`/
`editandoGrupoLinhasOriginais` já usado pelos demais lotes (mesmo quando é 1 linha só) — inclusive o
mesmo limite conhecido de que o botão "Salvar edição"/"Cancelar edição" só reage a `editandoId`, não
a `editandoGrupoId` (comportamento pré-existente dos outros tipos em lote, não específico do Desmame).

**Saldo inicial também pode declarar bezerro** — confirmado explicitamente pelo usuário (contradição
que seria criada por "bezerro só entra por Nascimento/Compra" levada ao pé da letra, já que fazendas
novas precisam poder declarar um plantel pré-existente com bezerros). `app/saldo-inicial/page.tsx`
ganha a mesma coluna de safra que Compra, condicional por linha (`categoriaEhBezerro`), suprimida
inteiramente da tabela quando nenhuma categoria da fazenda é bezerro (`existeCategoriaBezerro`).

## Relatórios por tipo de movimentação

`app/relatorios/page.tsx` é **uma página só com abas**, uma por tipo de movimentação (Nascimento,
Desmame, Compra, Venda em Pé, Venda Abate, Mortalidade, Consumo/Doação, Transferência) — não 8 rotas
separadas — decisão confirmada com o usuário, pra reaproveitar um único bloco de filtros
(fazenda/categoria/período) trocando só o conteúdo abaixo conforme a aba ativa. Os filtros replicam
o mesmo padrão já usado em `app/relatorio-movimentacao/page.tsx` (multi-fazenda por checkbox,
período Mês/Ano Safra/Ano Calendário/Personalizado via `lib/periodo.ts`), mas com o visual
atualizado pros tokens do design system (`rounded-card`, `bg-surface`, `text-text-*`) em vez do
estilo legado daquela tela. Filtro de categoria casa `categoria_id` OU `categoria_destino_id` (mesmo
princípio do filtro de Movimentações), e o de fazenda usa `.in('fazenda_id', ...)` pros 7 tipos que
têm fazenda única, mas `.or('fazenda_origem_id.in.(...),fazenda_destino_id.in.(...)')` só pra
Transferência (único tipo sem `fazenda_id` próprio).

**`recharts`** foi adicionado como dependência nova (nenhuma lib de gráfico existia antes) — os
gráficos existentes no app (barra empilhada de Gestão de Áreas) eram `<div>`s com CSS puro, sem SVG.
`lib/relatorio-cores.ts` replica o padrão categórico de `lib/area-cores.ts` (paleta fixa +
`corCategorica(indice)` cíclica) e acrescenta `CORES_BINARIAS` (par brand-500/warning) pra divisões
de duas categorias (sexo, consumo×doação) — nunca `success` puro nesse contexto, reservado pra
confirmação em outras telas.

`components/relatorios/tipos.ts` centraliza o tipo de linha (`MovimentacaoRelatorio`, já com os
relacionamentos de fazenda/categoria/cliente/ajustes) e os helpers reusados pelos 8 componentes:
`valorLiquido` (bruto − desconto + acréscimo, igual usado em Movimentações), `mediaPonderada`
(pondera pela quantidade — ou outro peso — nunca média simples das médias por linha, mesma regra já
documentada em "Peso e valor médio em totais"), `agruparPorChave` (agrupamento genérico usado por
todo gráfico de evolução mensal/por categoria/por safra) e formatação de data/safra/mês.
`components/relatorios/KpiCard.tsx` é o card de estatística reusado nas 8 abas.

Os quatro campos de valor comercial (`valor_arroba`/`valor_cabeca`/`valor_kg`/`valor_total`) e os de
carcaça (`peso_morto_kg`/`rendimento_carcaca_pct`) já vêm **todos preenchidos pelo banco**
(`fn_calcular_valores_movimentacao`), então os relatórios nunca recalculam esses valores a partir do
primeiro campo preenchido (isso já aconteceu na tela de lançamento) — só derivam o que não é uma
coluna própria: arroba total (`peso_total_kg/30` pra tipos de peso vivo — Compra/Venda em Pé/
Transferência; `peso_morto_kg/15` pra Venda Abate, que sempre tem peso morto/rendimento por ser
obrigatório; Consumo/Doação tenta peso morto primeiro e cai pro fallback de peso vivo/30 quando não
informado, mesmo princípio de `resolverBaseArroba` em `app/movimentacoes/page.tsx` mas sem
recalcular rendimento/peso morto, que o banco já resolveu). Peso morto por animal (exibido em Venda
Abate) é sempre `peso_morto_kg / quantidade`, já que a coluna é gravada como total do lote (mesma
convenção de `peso_total_kg`, documentada acima em "Peso morto/rendimento de carcaça obrigatório em
venda abate").

Cada aba tem seu conjunto próprio de KPIs/gráficos pensado pro que faz sentido de decisão pro tipo
(ex.: Nascimento mostra % macho/fêmea e nascimentos por safra; Compra/Venda mostram preço médio da
arroba ponderado e ranking de fornecedor/cliente; Venda Abate mostra rendimento de carcaça médio
ponderado ao longo do tempo; Mortalidade quebra por causa mortis **e** por grupo faixa etária
— `categoria.grupo.nome`, pedido explícito do usuário; Transferência mostra fluxo líquido por
fazenda e uma tabela cruzada origem×destino). Estado vazio (`linhas.length === 0`) segue o padrão de
card tracejado já estabelecido no design system, nunca só "Nenhum registro".

Desmame mostra a **categoria destino** (a categoria jovem resultante) na coluna "Categoria", não a
categoria de bezerro de origem — mais informativo pra gestão, já que a origem é sempre um papel de
bezerro conhecido e o destino é o dado novo do lançamento. Link de navegação "Relatórios por tipo"
foi adicionado ao grupo "Movimentação" da sidebar (`components/Sidebar.tsx`), com ícone próprio
(`ICONS.relatorios`, um grid de painéis) pra não ser confundido com o "Relatório" (singular, já
existente, aponta pro relatório de estoque por período em `relatorio-movimentacao`).

## Reorganização de Fazendas (fazenda selecionável, saldo inicial embutido) e renomeações de navegação

**Fazenda ganha edição inline** (nome/localização/área) em `app/fazendas/page.tsx` — cada card tem
um botão "Editar" que troca a exibição estática por um formulário inline (`editandoFazendaId`),
sem navegar pra outra tela. Antes só existia formulário de criação.

**Fazenda passa a ser selecionável, um só painel de detalhe por vez** — em vez dos antigos botões
avulsos "Área inicial"/"Módulos e pastos" (cada um com seu próprio estado de expansão
independente, permitindo ver dados de duas fazendas diferentes ao mesmo tempo — fonte de confusão
identificada pelo usuário), clicar num card agora seleciona a fazenda (`fazendaSelecionadaId`,
destaque `border-brand-500 bg-brand-100`) e abre **um único painel abaixo da lista, com abas** —
Saldo Inicial | Área Inicial | Módulos e Pastos (essa última só se `controla_pasto` estiver ligado)
— mesmo padrão de abas já usado em `app/relatorios/page.tsx`. Nunca é possível ver dados de duas
fazendas ao mesmo tempo. Clicar no botão "Editar" de um card usa `e.stopPropagation()` pra não
disparar a seleção da fazenda.

**Saldo inicial sai da rota própria `/saldo-inicial` e vira a aba "Saldo Inicial"** — toda a lógica
que antes vivia em `app/saldo-inicial/page.tsx` (uma página inteira, selecionada por query
string `?fazenda=`) foi portada pra `components/fazendas/SaldoInicialPanel.tsx`, um componente que
recebe `fazendaId` como prop em vez de ler da URL, e usa os tokens do design system em vez do
estilo legado da página antiga. A rota `/saldo-inicial` foi removida, junto do link na sidebar; os
poucos lugares que apontavam pra ela (avisos de "saldo inicial não confirmado" em
`app/movimentacoes/page.tsx` e `app/controle-pasto/page.tsx`) agora apontam pra `/fazendas`. Ao
cadastrar uma fazenda nova, ela já é automaticamente selecionada com a aba "Área Inicial" aberta
(antes era um link separado "Continuar para o saldo inicial do rebanho") — o fluxo de setup vira
tudo dentro do mesmo painel, sem navegar de página.

**Área inicial ganha checagem real de trajetória antes de editar** — antes, editar uma área inicial
já confirmada não mostrava nenhum aviso, e o erro do banco (se a trigger bloqueasse por causa de uma
mudança de uso posterior dependente) era descartado silenciosamente (`await
supabase...update(...)` sem checar `{ error }` — bug real, não só uma lacuna de UX). Agora
`handleSalvarAreaInicialClick` roda `fn_checar_edicao_area` (mesma função RPC que
`DistribuicaoAreaPanel.tsx` já usa pra editar `MUDANCA_USO`) pra cada linha com `existingId`, e:
bloqueia com alerta se a edição faria o saldo de algum tipo de uso ficar negativo; mostra um aviso
de confirmação (`avisoEdicaoAreaFutura`) se existem mudanças de uso posteriores desses tipos de uso;
senão salva direto. Optou-se por reaproveitar esse mecanismo (mais preciso, já testado) em vez de
copiar o aviso estático mais simples do saldo inicial (baseado só numa flag booleana de
"confirmado", sem checar de fato se há risco real).

## Subtipos de uso de área (Pecuária: Corte/Leite/Ovinocultura/Haras; Agricultura: Soja/Milho/Cana/Café)

Migração 032. Mesmo princípio já usado no controle de rebanho por pasto: **tipo de uso** (Pecuária,
Agricultura, Reserva...) continua sendo o nível amplo e fixo já existente; **subtipo de uso**
(Corte, Leite, Soja, Milho...) é uma dimensão mais fina *dentro* de um tipo de uso — igual pasto é
mais fino dentro de fazenda+categoria. `subtipos_uso_area` (tipo_uso_id, nome, ativo, sistema,
ordem) é um catálogo **genérico** (mecanismo vale pra qualquer tipo de uso, igual
`tipo_utilizacao_modulo` reserva `AGRICULTURA` sem usar ainda pros módulos/pastos), mas só exposto
na UI hoje pra Pecuária e Agricultura — os outros 5 tipos de uso nunca mostram seletor de subtipo,
sempre usam o "Geral" por baixo dos panos. Cada tipo de uso ganha um subtipo **"Geral"**
(`sistema = true`, nunca pode ser excluído — mesma proteção de `pastos.sistema`) automaticamente
seedado; Pecuária e Agricultura ganham sugestões iniciais editáveis (Corte/Leite/Ovinocultura/Haras
e Soja/Milho/Cana-de-açúcar/Café) que o usuário pode complementar livremente.

**Opt-in por grupo via `configuracoes.controla_subtipo_area`** (mesmo padrão de `controla_pasto`) —
desligado, todo lançamento de área usa o subtipo "Geral" do tipo de uso automaticamente, sem
nenhuma tela de seleção. Confirmado explicitamente pelo usuário: subtipo é opcional mesmo depois de
ligado — "ficar em Geral" é um estado válido permanente, não só uma ponte até o usuário detalhar.
Por isso a **área inicial (declarada em Fazendas) nunca pede subtipo** — sempre grava no "Geral" do
tipo de uso, mesmo com o recurso ligado; refinar por subtipo (ex.: separar 10ha de Corte de 5ha de
Leite dentro de Pecuária) é feito depois via `MUDANCA_USO` em Gestão de Áreas, igual qualquer outra
realocação de área.

`movimentacoes_area` ganha `subtipo_uso_origem_id`/`subtipo_uso_destino_id`, espelhando o par
`tipo_uso_origem_id`/`tipo_uso_destino_id` já existente (origem só em `MUDANCA_USO`, destino sempre
obrigatório). `fn_area_por_subtipo_uso(fazenda, tipo_uso, subtipo_uso, data)` espelha
`fn_area_por_uso`, com a mesma relação de sempre: `fn_area_por_uso` = soma, sobre todos os subtipos
daquele tipo de uso, de `fn_area_por_subtipo_uso`. Saldo insuficiente é checado nos dois níveis
(defesa em profundidade, mesmo princípio de `fn_saldo_categoria` + pasto) — `fn_validar_saldo_area`
bloqueia tanto por tipo de uso quanto por subtipo. A trajetória de edição/exclusão tem sua própria
versão paralela e independente da de tipo de uso — `fn_delta_area_para_subtipo`/
`fn_subtipo_area_ficaria_negativo`, wireada em `fn_validar_edicao_area`/`fn_validar_delete_area` —
mesmo princípio já usado pra trajetória de lote de nascimento: é a fonte de bloqueio real (defesa em
profundidade no banco), mas ainda não tem o aviso amigável com data/quantidade que a versão por
tipo de uso tem; um conflito nessa dimensão hoje vira uma exceção crua do banco em vez de um aviso
bonito — extensão natural pra quando fizer sentido.

**Superseeds o campo `cultura`** (texto livre, só usado antes quando tipo de uso destino era
Agricultura, obrigatório nesse caso) — a migração faz backfill dos valores já digitados: cada texto
único de `cultura` vira (ou casa com) um subtipo real dentro de Agricultura, preservando o dado
histórico como catálogo estruturado. `cultura` continua na tabela só como histórico bruto — não é
mais lido nem escrito pelo frontend a partir de agora.

Em `DistribuicaoAreaPanel.tsx`, o formulário de "Lançar mudança de uso" ganha dois seletores de
subtipo (origem e destino), cada um só aparece quando `controla_subtipo_area` está ligado **e** o
tipo de uso daquele lado é Pecuária ou Agricultura **e** há 2+ subtipos ativos pra escolher (mesmo
critério tríplice já usado pro seletor de pasto em Movimentações) — do contrário o subtipo "Geral"
é preenchido sozinho, sem UI. Cada seletor tem uma opção "+ Novo subtipo..." que revela um campo de
nome (mesmo padrão inline já usado pro catálogo de `itens_ajuste_financeiro` em desconto/acréscimo,
sem modal separado) — o subtipo novo é criado no submit do formulário (`resolverSubtipoId`), antes
de montar o payload do lançamento. A lista "Últimas mudanças de uso" mostra o subtipo entre
parênteses junto ao tipo de uso (`labelTipoUso`, ex.: "Pecuária (Corte) → Agricultura (Soja)"),
omitindo o sufixo quando o subtipo é "Geral" pra não poluir a maioria dos lançamentos que não usam
esse detalhamento.

## Distribuição da Área absorvida por Fazendas

`app/gestao-areas/page.tsx` (rota própria, com seletor de fazenda independente) foi removida —
mesmo padrão já usado quando `/saldo-inicial` virou aba (ver "Reorganização de Fazendas" acima).
Todo o conteúdo (filtro de período, gráfico empilhado, tabela cruzada, formulário "Lançar mudança de
uso", "Últimas mudanças de uso") foi portado pra `components/fazendas/DistribuicaoAreaPanel.tsx`,
recebendo `fazendaId` como prop — mesmo molde de `SaldoInicialPanel.tsx`. O painel de Fazendas ganha
uma 4ª aba: **Saldo Inicial | Área Inicial | Distribuição da Área | Módulos e Pastos** (essa última
continua condicional a `controla_pasto`). O item "Distribuição da Área" e o grupo "Gestão de Áreas"
saem da sidebar — nenhum item de menu novo, a fazenda já selecionada no card acima alimenta a aba
diretamente, sem seletor de fazenda duplicado.

**Conferência com pastos**: quando `controla_pasto` está ligado, a aba mostra um card extra
comparando a soma da área de todos os pastos ativos da fazenda (buscados via `modulos(pastos(...))`,
sem depender de a aba "Módulos e Pastos" já ter sido visitada) com a área alocada em "Pecuária" hoje
(`fn_area_por_uso`). É só uma conferência visual — decisão deliberada de **não** criar um vínculo
estrutural entre pasto e subtipo de uso (ex.: pasto apontando pra um `subtipo_uso_area_id`
específico) nesta rodada, porque `controla_pasto` e `controla_subtipo_area` são dois opt-ins
independentes hoje, e um vínculo estrutural só faria sentido pleno com os dois ligados ao mesmo
tempo — complexidade desproporcional ao ganho por enquanto. Pasto continua sem nenhuma coluna de
subtipo; se um dia fizer sentido decompor a distribuição por subtipo cruzando com pastos específicos,
essa extensão fica pra depois.

## Renomeações de navegação

Ajuste puramente de rótulo/organização, sem mudança de rota nem de comportamento (exceto onde
indicado). Grupos da sidebar: "Gestão" → "Gerenciamento"; "Movimentação" → "Rebanho"; "Pastejo" →
"Controle de Pasto"; "Áreas" → "Gestão de Áreas". Itens: "Movimentações" → "Lançamento de
Movimentações"; "Relatório" (singular, `/relatorio-movimentacao`) → "Resumo de Movimentação de
Rebanho"; "Relatórios por tipo" (`/relatorios`) → "Relatórios de Movimentações"; "Saldo inicial"
removido (absorvido pela fazenda, ver acima); "Controle de Pasto" (`/controle-pasto`) → "Mudança de
Pasto"; "Gestão de áreas" (`/gestao-areas`) → "Distribuição da Área". O `<h1>` de cada página
renomeada foi atualizado junto pro mesmo texto do novo rótulo do item (convenção já seguida antes),
com uma exceção deliberada, hoje já superada: `app/gestao-areas/page.tsx` mantinha o `<h1>` "Gestão
de Áreas" mesmo com o item de menu renomeado pra "Distribuição da Área" (a página também era onde
se lançava `MUDANCA_USO`, então "Distribuição da Área" sozinho descreveria só metade do conteúdo).
Essa página inteira foi depois absorvida por Fazendas como aba (ver "Distribuição da Área absorvida
por Fazendas" mais abaixo) — a exceção não existe mais porque não há mais `<h1>` próprio pra essa
tela, só o título da aba dentro do painel de Fazendas.

## Painel inicial

`app/page.tsx` deixou de redirecionar pra `/fazendas` e virou o painel inicial de verdade — link
"Painel" próprio no topo da sidebar (fora de qualquer grupo, `components/Sidebar.tsx`), apontando
pra `/`. Objetivo: dar uma visão geral do rebanho e das movimentações recentes assim que o usuário
entra no sistema, sem precisar navegar pra nenhum relatório específico.

**Distribuição atual do rebanho** vem de `fn_resumo_rebanho_atual(p_fazenda_ids)` (migração 033) —
uma linha por (fazenda, categoria) com saldo atual > 0, reaproveitando a `vw_estoque_rebanho` já
existente (mais eficiente que chamar `fn_saldo_categoria` fazenda×categoria por fazenda
selecionada). **Bug corrigido na migração 034**: `vw_estoque_rebanho` (existente desde a migração
004, nunca usada pra exibir número nenhum ao usuário até esta) juntava os CTEs `entradas`/`saidas`
direto por `fazenda_id+categoria_id` sem agregação prévia — categoria com N lançamentos de entrada e
M de saída gerava um produto cartesiano de N×M linhas no join, inflando os dois `sum(quantidade)` por
um fator multiplicativo (fan-out clássico de SQL). Só aparecia em categorias com vários lançamentos
dos dois lados (por isso o Total de cabeças do painel divergia bem mais do que o Estoque Final do
`fn_relatorio_movimentacao_rebanho` — este nunca teve o problema, cada tipo é uma subquery escalar
isolada). Corrigido agregando `entradas`/`saidas` cada uma com seu próprio `group by`
(`entradas_agg`/`saidas_agg`) antes de juntar com fazenda/categoria, tornando o join 1:1. O peso
médio de cada linha é resolvido pela pesagem mais recente da categoria naquela
fazenda **em qualquer pasto** — diferente da regra "sem fallback cruzado entre pastos" usada nos
relatórios de pastagem (`fn_relatorio_rebanho_por_pasto`), decisão deliberada aqui porque o painel é
uma visão agregada da fazenda inteira, não um relatório por pasto; a granularidade por pasto não faz
sentido nesse contexto. Cai pro `peso_referencia_kg` da categoria quando nunca foi pesada.

**KPIs**: Total de cabeças e Peso médio geral (ponderado pela quantidade, mesma regra de sempre) vêm
direto da soma/média do resumo. **Lotação atual (UA/ha)** é a única métrica genuinamente nova no
sistema — `formatLotacao` já existia reservado pra isso desde a criação de `lib/format.ts`, sem uso
até agora. Convenção adotada (confirmada com o usuário): **1 UA = 450 kg de peso vivo** — padrão
usual da pecuária brasileira. Lotação = (peso vivo total do rebanho / 450) / hectares em uso
"Pecuária" (`fn_area_por_uso`, somado sobre as fazendas selecionadas) — usa o tipo de uso inteiro,
não filtra por subtipo (Corte vs. Leite), já que lotação é sobre área de pastagem em geral,
independente de qual subtipo. Mostra "—" quando não há área de Pecuária declarada (sem teto pra
dividir).

**Distribuição do rebanho atual** substituiu a antiga tabela "Cabeças por categoria" (e o pie chart
"Distribuição por Grupo Faixa Etária", removido) — lista de barras horizontais (categoria + peso
médio + participação %), mesmo padrão visual já usado em "Distribuição do rebanho final"
(`app/relatorio-movimentacao/page.tsx`), mas com `bg-brand-500` em vez do preto/cinza legado daquela
tela (nunca copiado 1:1) e com peso médio por categoria adicionado. Linha de rodapé "Total" soma
cabeças e mostra peso médio ponderado, sem o rótulo "média ponderada" (redundante ali, diferente do
KPI card "Peso médio geral" que mantém o rótulo).

**Distribuição sexo × categoria** é uma rosca aninhada (anel interno: Fêmeas/Machos com
`CORES_BINARIAS`; anel externo: categoria com `corCategorica`, fatias agrupadas contíguas por sexo
via `porCategoriaPorSexo`) — pedido do usuário inspirado num modelo de dashboard genérico que ele
encontrou, adaptado às paletas já estabelecidas do sistema em vez de copiar as cores do exemplo.
Requer o campo `sexo` em `fn_resumo_rebanho_atual` (migração 035 — precisou `drop function` antes do
`create`, já que Postgres não permite mudar as colunas de um `returns table` existente via `create or
replace`). Interativo: passar o mouse ou clicar em qualquer fatia (dos dois anéis) ou item da legenda
destaca a fatia (`shape` customizado com `Sector` + `isActive`, não o `activeShape`/`activeIndex`
antigo do recharts v2 — removido na v3) e atualiza um texto centralizado na rosca com
quantidade/peso médio daquele sexo ou categoria; sem hover, mostra o total geral. As duas `<Pie>`
precisam de `id` únicos (`anel-sexo`/`anel-categoria`) — recomendação do recharts pra múltiplos Pies
no mesmo chart. `isAnimationActive={false}` nas duas: a animação de entrada padrão do recharts v3
depende de `requestAnimationFrame`, que pode nunca resolver em abas em segundo plano/sem foco real
(foi assim que a rosca apareceu vazia — zero `<path>` no DOM — ao testar via automação de navegador;
o mesmo risco existe em qualquer gráfico de pizza já existente no app, ver nota abaixo).

**Movimentações do período**: ao contrário do resto do painel (que é sempre "hoje"), essa seção usa
o mesmo filtro de período Mês/Ano Safra/Ano Calendário/Personalizado já padronizado no resto do
sistema (`lib/periodo.ts`) — mas aqui **pré-selecionado em "Ano Safra" (safra atual)** por decisão
explícita do usuário, diferente do padrão "Mês" usado em Gestão de Áreas/Relatórios. Mostra só o
componente `FluxoRebanho` (ver seção abaixo) com o saldo agregado do período — decisão do usuário
de não duplicar o feed de lançamentos individuais aqui (isso já existe em `/relatorios`, com link
"Ver relatórios completos" pro detalhe completo); o painel foca só no resumo de alto nível.

## FluxoRebanho (Estoque Inicial → entradas/saídas → Estoque Final)

`components/FluxoRebanho.tsx` é um componente compartilhado que visualiza a reconciliação do
rebanho num período — inspirado num modelo que o usuário já usava em planilha (uma "esteira" com
Estoque Inicial numa ponta, Estoque Final na outra, e os tipos de movimentação encadeados no meio).
Layout escolhido entre duas opções propostas (cascata/waterfall vs. cartões conectados): **cartões
conectados**, por ficar mais parecido com o modelo original do usuário e mais fácil de ler rápido —
caixa de Estoque Inicial à esquerda, chips de entrada em cima/chips de saída embaixo no meio, caixa
de Estoque Final à direita, ligados por uma linha fina. Empilha em coluna no mobile
(`flex-col sm:flex-row`).

**Cor dos chips é neutra (`bg-brand-100`/`text-brand-700`), igual pra entrada e saída** — decisão
explícita do usuário após ver a primeira versão com `success`/`error` (verde/vermelho): saída em
vermelho passava a impressão de algo ruim, o que não é verdade em casos como venda/abate (o
propósito comercial do rebanho). Direção (entrada vs. saída) é comunicada só pelo sinal (+/-) e pela
posição (cima/baixo), nunca por cor — reforça a regra já existente de que `success`/`error` são
reservados pra confirmação/bloqueio, não pra codificar polaridade de evento de negócio.

`somarFluxoRebanho(linhas)` recebe o retorno cru de `fn_relatorio_movimentacao_rebanho` (uma linha
por categoria) e soma em totais do rebanho inteiro. **Desmame e Mudança de Categoria ficam de fora
de propósito**: são reclassificação interna (a saída de uma categoria = a entrada de outra), então
somados em todas as categorias sempre se cancelam matematicamente — não representam animal entrando
ou saindo do rebanho, só valor real no detalhe por categoria (que continua existindo na tabela
completa). Chips com valor 0 não aparecem.

Reaproveitado em dois lugares, cada um buscando `fn_relatorio_movimentacao_rebanho` com seus
próprios filtros: `app/relatorio-movimentacao/page.tsx` (substituiu os cards antigos de
Estoque/Entradas/Saídas em texto puro, mantendo a tabela detalhada por categoria abaixo) e o Painel
(`app/page.tsx`, seção "Movimentações do período").

## Relatório de Lotação

`app/relatorio-lotacao/page.tsx` — evolução mensal do rebanho médio, peso médio, área média e
lotação, considerando a área em Pecuária. Mesmo padrão de filtro (fazendas multi-select + período
Mês/Ano Safra/Ano Calendário/Personalizado, `lib/periodo.ts`) já usado em `app/relatorios/page.tsx`,
com o mesmo capping em "hoje" já usado pro rebanho (não existe previsão aqui — diferente da aba
"Distribuição da Área" em Fazendas, cuja "Ano Safra"/"Ano Calendário" atual vai até o fim do mês
corrente como projeção). Essa escolha é deliberada: como o relatório pareia área com rebanho médio
(que não tem previsão possível), deixar a área projetar pro futuro enquanto o rebanho para em "hoje"
geraria uma Lotação sem sentido — por isso os números de "Área Média" aqui podem divergir dos
mostrados na aba "Distribuição da Área" pro mesmo Ano Safra/Ano Calendário quando o período ainda
não terminou; não é bug, os dois relatórios respondem perguntas diferentes de propósito.

**Cálculo mensal** (migração 036, três funções novas):
- `fn_estoque_rebanho_na_data(fazendas[], data)`: mesma lógica corrigida de `vw_estoque_rebanho`
  (migração 034 — entradas/saidas agregadas antes do join, sem fan-out), só que parametrizada por
  data (em vez de só "hoje") e somando direto as fazendas selecionadas.
- `fn_indicadores_rebanho_dia(fazendas[], data)`: cabeças totais e peso vivo total (quantidade ×
  peso resolvido por categoria, mesma resolução de pesagem mais recente já usada em
  `fn_resumo_rebanho_atual`) das fazendas selecionadas numa data — o "valor do dia".
- `fn_relatorio_lotacao_mensal(fazendas[], data_inicio, data_fim)`: uma linha por mês, integrando
  `fn_indicadores_rebanho_dia` dia a dia (mesmo princípio de `fn_area_media_ponderada`, só que pra
  rebanho/peso em vez de área) — **Rebanho Médio** = média diária de cabeças (não só o saldo final,
  reflete entradas/saídas no meio do mês); **Peso Médio** = ponderado pela cabeça de cada dia (não
  só a última pesagem do mês — pedido explícito do usuário, pra ficar coerente com o resumo do
  período); **Área Média** reaproveita `fn_area_media_ponderada` somada por fazenda. Retorna também
  `dias_no_mes`, pro frontend derivar o resumo do período inteiro ponderando pelos dias de cada mês
  (`soma(valor_mês × dias_mês) / soma(dias_mês)` — mesmo princípio já usado em
  `fn_relatorio_distribuicao_area`, sem precisar reconsultar o banco). **Lotação** não é uma coluna
  própria — é sempre derivada no frontend como `(Rebanho Médio × Peso Médio) / 450 / Área Média`,
  igual a "Lotação atual" do Painel, só que por mês/período em vez de só hoje.

**Resumo do período** (4 KPI cards acima do gráfico, sem o rótulo "média ponderada" — decisão
explícita do usuário, redundante ali) é inteiramente derivado das linhas mensais no frontend, sem
chamada adicional ao banco — mesma lógica de ponderação por dias do parágrafo acima. Cada card ganha
`corDestaque` (`components/relatorios/KpiCard.tsx`, prop nova e opcional) ligando visualmente o
indicador à cor da sua série no gráfico logo abaixo — borda esquerda de 3px + bolinha ao lado do
rótulo, nunca tingindo o card inteiro nem o número (que continua `text-primary`, mesma hierarquia
dos outros KPI cards do sistema). Sem `corDestaque`, o card renderiza exatamente como antes (Painel,
Relatórios) — mudança aditiva, não quebra nenhum uso existente.

**Gráfico combinado** (Rebanho Médio em barra + Lotação/Peso Médio/Área em linha, `recharts`
`ComposedChart`) — pedido do usuário inspirado num modelo de dashboard genérico que ele encontrou.
Cada série tem seu próprio eixo Y escondido (`hide`, domínio calculado em JS a partir dos dados, não
via string mágica do recharts) — decisão deliberada: as 4 séries têm grandezas muito diferentes
(cabeças ~900, UA/ha ~0,4, kg ~300, ha ~1500), então compartilhar um eixo faria a maioria virar uma
linha reta. O eixo da barra (Rebanho Médio) começa em 0 sempre (`dominioBar`) — nunca com folga
embaixo como as linhas (`dominioLinha`), porque uma barra representa magnitude a partir de zero;
recortar a base distorceria a altura visualmente. `isAnimationActive={false}` em todas as
séries — mesmo motivo já documentado na seção do Painel (a animação de entrada do recharts v3
depende de `requestAnimationFrame`, que pode não resolver em certas condições).

Interatividade: **rótulo de valor sempre visível** em cada barra/ponto (`LabelList`, pedido explícito
do usuário — antes só aparecia no hover); **destaque por série** ao passar o mouse ou clicar numa
linha, barra, ou item da legenda (opacidade reduzida nas outras, traço mais grosso na destacada) —
sem interação nenhuma, todas ficam com opacidade normal (não começam apagadas); **legenda clicável**
esconde/mostra a série (`visiveis`, um `Set` de chaves); tooltip por mês no hover sobre a área do
gráfico (`Tooltip` customizado, mostra só as séries visíveis). O estado de destaque (`destaque`) é só
hover/clique momentâneo, nunca "trava" — sair do gráfico sempre limpa (`onMouseLeave` no wrapper como
rede de segurança), decisão explícita do usuário depois de testar uma versão com toggle que travava.

**Lotação atual por pasto** só aparece com `configuracoes.controla_pasto` ligado — é uma **fotografia
de hoje** (não do período filtrado), mesmo princípio de `fn_relatorio_rebanho_por_pasto` (que já é
"onde o rebanho está agora", não uma agregação por intervalo). Chamada uma vez por fazenda
selecionada (a função já existente é de fazenda única) e agregada no frontend por `pasto_id`
(globalmente único, sem risco de colisão entre fazendas). Lotação por pasto = `(peso vivo total do
pasto / 450) / pastos.area_ha` — `null` (exibido como "—") quando o pasto não tem `area_ha`
declarada (ex.: pasto "Geral", que nunca teve área própria atribuída). Escolha deliberada de não
fazer isso como série histórica mensal por pasto: rastrear fazenda×categoria×pasto×mês seria
complexidade desproporcional ao ganho — a pergunta que esse bloco responde é "que pasto está
sobrecarregado agora", não uma tendência.

Link "Relatório de Lotação" no grupo "Rebanho" da sidebar, com ícone próprio (`ICONS.lotacao`, um
medidor/gauge).

## Mapa de fazenda — Fase 1 (fundação: contorno + desenho/import de pastos)

Primeira fase de um recurso maior de mapeamento geoespacial (inspirado em ferramentas como o
Agrohub): desenhar/importar o contorno de cada pasto num mapa real, com área calculada
automaticamente. Decisões estruturais (antes de qualquer código): **sem rota nova nem item de menu
novo** — o mapa vive como um toggle **Lista | Mapa dentro da aba "Módulos e Pastos" já existente**
em Fazendas (mesma fazenda selecionada no card acima, sem seletor próprio). Fase 2 (futura,
não implementada) reaproveitará os mesmos polígonos num toggle Lista | Mapa **somente leitura** no
relatório "Rebanho por pasto", com badges de categoria/quantidade sobre cada pasto (nunca ícones
ilustrativos de animal — fora do alcance de gerar arte própria) e clique/hover mostrando UA e
lotação do pasto. Fase 3 (futura) cobriria tempo de pastejo/descanso, derivado do histórico de
`MUDANCA_PASTO` — ainda sem desenho algum. Talhões de agricultura ficam de fora desta rodada
inteira, tratados como iniciativa separada.

**Sem PostGIS** — decisão deliberada pela escala do projeto. `fazendas.geometria` e
`pastos.geometria` (migração 037) são `jsonb` nullable guardando GeoJSON `Polygon`/`MultiPolygon` em
WGS84 puro, sem tipo geométrico nativo do Postgres nem índice espacial — não há necessidade de
consulta espacial (nenhum "quais pastos estão dentro de X"), só armazenar e desenhar. Nenhuma das
duas colunas é obrigatória em momento algum: `pastos.area_ha` continua podendo ser digitado à mão
sem nunca desenhar nada (mesmo com o mapa ligado), e `fazendas.geometria` é puramente decorativo
(camada de fundo tracejada, `interactive={false}`, nunca entra em cálculo nenhum).

**Stack**: `leaflet` + `react-leaflet` v5 (tiles do OpenStreetMap, sem chave de API — cobre a escala
do projeto sem custo) + `leaflet-draw` (toolbar de desenho, sem wrapper React oficial pra v5 — wireado
imperativamente via `useMap()`) + `@turf/area` (cálculo de área a partir do GeoJSON desenhado/
importado) + `@tmcw/togeojson` (parse de KML → GeoJSON no navegador via `DOMParser`, sem round-trip
ao servidor). `lib/kml.ts` centraliza `calcularAreaHa()` (m² → ha, 2 casas, mesma regra de
`formatArea`) e `parseKml()` (extrai só features `Polygon`/`MultiPolygon`, ignora pontos/linhas que
às vezes vêm juntos num KML exportado de ferramenta de desenho, e o nome do placemark pra casamento
por nome).

**`components/fazendas/MapaPastos.tsx`** é um componente "burro" (recebe `fazendaGeometria`,
`pastos: PastoMapa[]` já resolvidos com cor, e dois callbacks — `onDesenhado`/`onClicarPasto` — sem
acesso a Supabase) carregado via `next/dynamic({ ssr: false })` no componente pai, porque Leaflet
acessa `window`/`document` na importação e quebraria a renderização no servidor do Next.js. Só a
ferramenta de **desenhar polígono** é habilitada na toolbar do leaflet-draw (`edit: false`) — decisão
deliberada pra evitar o conflito entre o `FeatureGroup` que a edição nativa do leaflet-draw exige
(as camadas editáveis precisam pertencer a esse grupo específico, gerenciado imperativamente) e as
camadas `<GeoJSON>` declarativas do react-leaflet usadas pra renderizar os pastos já salvos. Nesta
fase, "editar" um contorno é **desenhar de novo e escolher a quem atribuir** (ver
"Fluxo de desenho" abaixo) — cobre o caso de uso sem a complexidade de edição de vértice nativa;
pode virar Fase 1.5 se algum dia for pedido. `AjustarZoom` centraliza o mapa (`fitBounds`) sempre que
o conjunto de geometrias (contorno + pastos) muda — importante porque sem nenhuma geometria ainda o
mapa abre num zoom de mundo inteiro (centro genérico no Brasil), e cada import/desenho novo precisa
recentralizar sozinho, sem exigir zoom manual do usuário.

**`components/fazendas/ModulosPastosPanel.tsx`** é a extração de todo o CRUD de módulos/pastos que
antes vivia inline em `app/fazendas/page.tsx` (mesmo padrão de `SaldoInicialPanel`/
`DistribuicaoAreaPanel` — recebe só `fazendaId`, carrega seus próprios dados) — necessário pra caber
o toggle Lista | Mapa e toda a lógica nova sem inchar ainda mais a página de Fazendas. O modo
**Lista** é pixel-idêntico ao CRUD antigo (nada mudou de comportamento). O modo **Mapa** tem três
blocos: upload de KML do contorno da fazenda (substitui livremente, é só referência visual), upload
de KML de pastos (ver "Importação em lote" abaixo) e o `MapaPastos` em si.

**Fluxo de desenho → atribuição**: ao terminar um polígono no mapa, `onDesenhado` sobe a geometria +
área calculada (turf) pro painel, que abre um cartão de confirmação (nunca salva direto) com duas
opções mutuamente exclusivas: **"Novo pasto"** (nome + seletor de módulo, pré-preenchido com o
primeiro módulo da lista) ou **"Substituir pasto existente"** (seletor entre os pastos já
cadastrados — grava a geometria+área por cima do pasto escolhido). As duas opções passam pela mesma
validação de banco já existente (`fn_validar_area_pasto` — soma dos pastos não pode ultrapassar a
área alocada em "Pecuária"), sem nenhuma exceção pra geometria desenhada: um contorno grande demais
(ex.: desenhado com o mapa em zoom de mundo por engano) é rejeitado com o mesmo erro que apareceria
digitando a área à mão, confirmando que a reconciliação de área já documentada acima vale igual pros
dois jeitos de declarar `area_ha`.

**Importação em lote de KML de pastos**: sobe um KML com vários placemarks (cada um um polígono) e
tenta casar cada um com um pasto existente **pelo nome** (normalizado — `trim` + minúsculas), listando
tudo numa tela de revisão antes de gravar qualquer coisa — nenhum polígono é salvo sem essa
confirmação explícita. Cada linha da revisão mostra o nome do placemark, a área calculada, e um
`<select>` com todos os pastos da fazenda (auto-selecionado se o nome casou, "Ignorar" por padrão se
não achou correspondência) — o usuário pode corrigir manualmente qualquer casamento errado ou
escolher ignorar antes de confirmar. Confirmar grava geometria + área em lote (um `update` por linha
com pasto selecionado); linhas deixadas em "Ignorar" não tocam em nada.

Verificado no navegador: import de contorno de fazenda (grava `fazendas.geometria`, mapa recentraliza
sozinho via `AjustarZoom`), desenho de um pasto novo com área calculada corretamente e exibida via
`formatArea`, rejeição correta pela trigger de reconciliação de área ao tentar salvar um contorno
maior que a área de Pecuária disponível (mesmo comportamento de digitar a área à mão), e salvamento
bem-sucedido de um pasto novo dentro do limite de área disponível.

## Reorganização de Fazendas, Áreas e Pessoas — Fase A/B/C (nível Retiro, Pessoas e Empresas,
## cadastro completo de fazenda)

Migração 038, primeira de uma leva maior (Fases D/E/F ainda pendentes) que reorganiza como fazenda,
área e pessoas se relacionam, disparada por um sistema de referência que o usuário usa hoje
(prints de "Gestão de Áreas" e "Cadastrar Fazenda" desse sistema, adaptados aos padrões do ORION).

**Nível Retiro (Fazenda → Retiro → Módulo → Pasto) — existe no banco, mas fica oculto na UI por
enquanto.** `retiros` (`fazenda_id`, `nome`, `ativo`, `ordem`, `sistema`) segue exatamente o mesmo
padrão de auto-criação/proteção já usado em módulo/pasto: toda fazenda ganha um retiro **"Geral"**
sozinho (`fn_criar_modulo_pasto_geral`, agora também cria o retiro antes do módulo), com
`sistema = true` protegido contra exclusão (`fn_validar_delete_retiro`). `modulos.retiro_id`
(NOT NULL, aponta pro "Geral" por padrão) foi adicionado **sem remover `modulos.fazenda_id`** —
decisão deliberada pra não precisar reescrever toda a cadeia de triggers que já assume módulo→fazenda
direto (saldo, reconciliação de área, trajetória de edição); retiro é só uma camada de
organização/filtro por cima, ortogonal ao que já existe. Instrução explícita do usuário: **por
enquanto Retiro não aparece em nenhum cadastro, relatório ou seletor** — sempre usa o "Geral" por
baixo dos panos, sem UI nenhuma pra criar/escolher retiro. Existe no schema pronto pra quando fizer
sentido expor (ex.: fazendas que realmente dividem operação por retiro), mas até lá é infraestrutura
morta do ponto de vista do usuário — não confundir com Fase D do plano de reorganização, que
originalmente planejava um CRUD de Retiro na Gestão de Áreas; essa parte foi superada por essa
instrução e deve ser pulada quando a Fase D for implementada.

**`pastos.area_produtiva_ha`**: coluna nova (numeric, nullable), paralela à `area_ha` já existente.
`area_ha` passa a significar "área total" do pasto; `area_produtiva_ha` é a área realmente
aproveitável pra pastagem (descontando brejo/pedra/mata dentro do pasto) — vai virar o denominador da
lotação por pasto na Fase F (ainda não implementada; `app/relatorio-lotacao/page.tsx` continua usando
`area_ha` até lá). Ainda sem campo no formulário de pasto (Fase D).

**Pessoas e Empresas** (`app/pessoas/page.tsx`, substituindo `app/clientes-fornecedores/page.tsx`,
removido): generaliza o antigo cadastro de Cliente/Fornecedor porque a fazenda agora referencia um
"Proprietário", e uma mesma pessoa pode acumular papéis (ex.: Proprietário e também Cliente) — o
enum antigo `tipo` (`CLIENTE`/`FORNECEDOR`/`AMBOS`) só suportava uma combinação fixa, sem
Proprietário. `clientes_fornecedores` foi renomeada pra `pessoas`; a coluna `tipo` foi substituída por
uma tabela de junção `pessoa_papeis` (`pessoa_id`, `papel` enum `CLIENTE`/`FORNECEDOR`/
`PROPRIETARIO`, único por par). Migração de dados: `CLIENTE`→papel CLIENTE, `FORNECEDOR`→papel
FORNECEDOR, `AMBOS`→os dois papéis pra mesma pessoa — histórico preservado, nenhum registro perdido.
A tela nova usa checkbox múltiplo de papéis (em vez do select único de antes) e segue o padrão de
sempre: `<Required />`, `bloquearEnvioPorEnter`, inativar (sem excluir — mesmo motivo de
categoria/pasto: pessoa pode estar referenciada em movimentações históricas). Editar **apaga e
reinsere** todos os `pessoa_papeis` da pessoa (mesmo princípio já usado em `movimentacao_ajustes` e
nos lotes de movimentação) — mais simples que calcular um diff de quais papéis foram
adicionados/removidos. Link na sidebar renomeado de "Clientes/Fornecedores" pra "Pessoas e Empresas".

Os pontos que antes liam/escreviam em `clientes_fornecedores` foram todos varridos pra `pessoas`
sem mudar de comportamento pro usuário: `app/movimentacoes/page.tsx` (select de
cliente/fornecedor + o modal "+ Novo cliente/fornecedor" inline, que agora insere em `pessoas` e
depois em `pessoa_papeis` — a opção "Ambos" da UI vira duas linhas de papel), `app/relatorios/page.tsx`
(join `cliente:pessoas!cliente_fornecedor_id(nome)`). A coluna `cliente_fornecedor_id` em
`movimentacoes_rebanho` manteve o nome (só a tabela referenciada mudou) — não valia a pena renomear a
coluna só por causa do rename da tabela, teria espalhado a mudança por muito mais lugares sem ganho
real.

**Cadastro de Fazenda vira um formulário completo** (`components/fazendas/CadastrarFazendaModal.tsx`,
modal reaproveitado tanto pra criar quanto editar via prop opcional `fazendaId`), substituindo o
formulário mínimo (nome/localização/área) que existia inline em `app/fazendas/page.tsx`. Campos
obrigatórios — únicos confirmados pelo usuário, mesmo o sistema de referência tendo mais campos
obrigatórios: **Nome da Propriedade, Proprietário, Área Total (Ha), Área Útil (Ha)**. Proprietário é
um select de `pessoas` com papel `PROPRIETARIO` (`pessoa_papeis` filtrado), com "+ Novo" inline
(mesmo padrão de item de ajuste financeiro/subtipo de uso — sem modal separado teria sido inviável
aqui já que abriria modal-sobre-modal, então esse "+ Novo" é a exceção que usa um segundo modal,
`z-[60]` sobre o `z-50` do formulário principal, justamente pra empilhar). **Área Útil é um número
único** (não dividida por Pecuária/Agricultura como no sistema de referência) — decisão do usuário
pra simplificar; o detalhamento por tipo de uso continua sendo feito depois, na Distribuição da Área.
Campos opcionais: IE, INCRA, Nº ITR, CAEPF, Sistema Produtivo (`CRIA`/`RECRIA`/`RECRIA_ENGORDA`/
`CICLO_COMPLETO`/`AGRICULTURA`, confirmados verbatim pelo usuário) e um bloco de Endereço (país, CEP,
endereço, número, bairro, cidade, estado, telefone, e latitude/longitude digitados em
graus/minutos/segundos — formato que o usuário já usa pra essas coordenadas — convertidos pra decimal
só no submit via `gmsParaDecimal`/`decimalParaGms`, únicos campos gravados no banco
(`latitude`/`longitude` numeric(10,7)); a aba "Retiros" que originalmente fazia parte deste
formulário (planejada na Fase A/C original) foi removida no meio da implementação por causa da
instrução de manter Retiro oculto — não existe nenhum campo de retiro no formulário, a fazenda nova
sempre fica só com o "Geral" auto-criado. A aba "Parâmetros" do sistema de referência ficou de fora
do escopo por decisão explícita do usuário.

**Lista de fazendas redesenhada** (`app/fazendas/page.tsx`): o grid de cards + formulário sempre
visível virou uma fileira horizontal de chips (fazenda selecionada em `bg-brand-500 text-white`,
inativa com `opacity-50` + sufixo "(inativa)") mais um botão **"+ Nova Fazenda"** que abre o modal.
Clicar num chip seleciona a fazenda e abre o painel de abas já existente (Saldo Inicial | Área
Inicial | Distribuição da Área | Módulos e Pastos) — inalterado nesta fase, só a forma de selecionar
mudou. Dentro do painel da fazenda selecionada, o cabeçalho ganhou controles discretos em texto
(Editar / Inativar-Ativar / Excluir) — em vez de aparecerem no card antes de selecionar, como era
antes. **Excluir tenta a operação e mostra o erro do banco se bloqueada** (sem checagem prévia
duplicada no frontend, mesmo padrão já usado pra excluir pasto/módulo) — `fn_validar_delete_fazenda`
(trigger `before delete`) bloqueia se existir qualquer `movimentacoes_rebanho` (como `fazenda_id`,
`fazenda_origem_id` ou `fazenda_destino_id`), `movimentacoes_area` ou `pesagens` referenciando a
fazenda; passando essa checagem, apaga em cascata os `pastos`/`modulos`/`retiros` "Geral" (que
normalmente são protegidos contra exclusão via `sistema = true`) usando um flag de sessão
(`set_config('orion.excluindo_fazenda', 'true', true)`) que `fn_validar_delete_pasto`/
`fn_validar_delete_modulo`/`fn_validar_delete_retiro` passam a checar antes de bloquear — liberando a
cascata só nesse caminho específico, sem enfraquecer a proteção normal contra excluir o "Geral" à
mão. **Inativar** é um toggle simples de `fazendas.ativo` (coluna que já existia no schema, só nunca
tinha UI pra alterá-la).

**Correção de filtro `ativo` indevido em relatórios**: `app/relatorios/page.tsx`,
`app/relatorio-lotacao/page.tsx`, `app/relatorio-movimentacao/page.tsx` e `app/page.tsx` (Painel)
tinham `.eq('ativo', true)` no select de fazendas usado pra popular o filtro — bug real, já que esses
são relatórios/visões agregadas que precisam continuar mostrando fazendas inativas com histórico
(mesmo princípio já usado pra categoria/pasto inativo: inativar tira do cadastro/lançamento, nunca do
relatório). Removido dos quatro. **Mantido** em `app/relatorio-rebanho-por-pasto/page.tsx` (é uma
fotografia de hoje, não histórico) e nos formulários de lançamento (movimentações, pesagens,
controle de pasto) — esses continuam certos em só oferecer fazenda ativa pra lançar algo novo.

## Pessoas e Empresas — cadastro completo (Física/Jurídica, papel Funcionário, endereço/contato)

Migração 039, redesenho da tela criada na Fase B, disparado por um sistema de referência que o
usuário usa hoje (prints de "Cadastro de Pessoas ou Empresas" e da listagem, adaptados aos padrões
do ORION). **Só o Nome é obrigatório** — todos os demais campos abaixo são opcionais, mesmo em
sistemas de referência que os exigem.

`pessoas` ganha `tipo_pessoa` (enum `tipo_natureza_pessoa`: `FISICA`/`JURIDICA`, default `FISICA`) e
um bloco de colunas novas, todas opcionais: `rg`, `inscricao_estadual`, `inscricao_municipal`,
`nome_contato`, `nacionalidade` (default `'Brasil'`), `cep`/`endereco`/`numero`/`bairro`/`cidade`/
`estado`/`pais` (default `'Brasil'`), `telefone`, `celular`, `email`, `observacoes`. `papel_pessoa`
ganha um quarto valor, `FUNCIONARIO`, ao lado de `CLIENTE`/`FORNECEDOR`/`PROPRIETARIO` já existentes
(múltiplos papéis continuam possíveis pra mesma pessoa, via `pessoa_papeis`). **Duas decisões de
escopo deliberadas**, confirmadas com o usuário antes de implementar: não replicou a aba "Dados
Bancários" do sistema de referência (usuário só pediu os campos de "Dados Básicos") nem o papel
"Proprietário Financeiro" (usuário listou só Cliente/Fornecedor/Proprietário/Funcionário) — podem
virar extensão futura se pedidos.

`components/pessoas/CadastrarPessoaModal.tsx` (modal, mesmo padrão de `CadastrarFazendaModal.tsx`,
prop opcional `pessoaId` pra editar) reúne tudo numa seção só "Dados Básicos" (sem abas, já que só
existe esse bloco de campos) — radio Física/Jurídica, checkboxes de papel, Nome, CPF/CNPJ (rótulo do
campo troca dinamicamente conforme o radio — mesma coluna `documento` armazena os dois, sem campo
separado), RG (só aparece se Física) ou Insc. Estadual/Municipal (só aparece se Jurídica), Nome do
Contato, Nacionalidade, e duas subseções sempre visíveis — Endereço (CEP/Endereço/Número/Bairro/
Cidade/Estado/País) e Contato (Telefone/Celular/E-mail/Observações). Salvar sincroniza `pessoa_papeis`
pelo mesmo padrão "apaga e reinsere" já usado em outros pontos do sistema.

`app/pessoas/page.tsx` vira uma lista com filtro em vez do formulário-sempre-visível da Fase B: um
card de filtro (Nome, Tipo — dropdown dos 4 papéis —, CPF/CNPJ, todos combináveis, com "Limpar
filtros" que só aparece quando algum está ativo) acima de uma tabela (Nome+documento, Tipo=papéis
concatenados, Contato, Telefone, Ações). Botão **"+ Nova Pessoa/Empresa"** no topo abre o modal (só
entra na tela de cadastro por essa ação, nunca por padrão ao entrar na aba — pedido explícito do
usuário). **Ações viram ícones** (editar/inativar-ativar/excluir, SVGs inline no mesmo estilo de
traço da Sidebar — `viewBox 0 0 24 24`, `strokeWidth 1.75`) em vez dos links de texto da Fase B,
com confirmação inline pra exclusão (mesmo padrão `error`/"Sim"/"Cancelar" já usado em módulo/pasto).

**Exclusão trava se a pessoa estiver referenciada** — `fn_validar_delete_pessoa` (trigger `before
delete`) bloqueia se existir `movimentacoes_rebanho.cliente_fornecedor_id` ou
`fazendas.proprietario_id` apontando pra ela ("Inative-a em vez disso"); passando essa checagem,
apaga os `pessoa_papeis` dela junto (mesmo princípio de cascata via trigger já usado em
`fn_validar_delete_fazenda`). Sem checagem duplicada no frontend — mesmo padrão já usado pra excluir
fazenda/pasto/módulo, o erro do banco é só repassado pro usuário.

O fluxo de "+ Novo cliente/fornecedor" inline em `app/movimentacoes/page.tsx` (criado na Fase B)
continua funcionando sem alteração — grava só `nome`/`documento` e o(s) papel(is), deixando todos os
campos novos desta seção em branco; a pessoa criada por ali aparece completa em "Pessoas e Empresas"
depois, pronta pra ser complementada com endereço/contato se o usuário quiser.

## Gestão de Áreas — renomeação de Módulos e Pastos (Fase D)

`components/fazendas/ModulosPastosPanel.tsx` foi renomeado pra `GestaoAreasPanel.tsx`, e o item da
aba na fazenda selecionada acompanhou: "Módulos e Pastos" → "Gestão de Áreas" (a aba "Distribuição
da Área" continua separada, sem fundir — o plano original considerou fundir as duas, mas decisão foi
manter cada uma com seu propósito específico: uma edita o cadastro de módulo/pasto, a outra lança e
visualiza `MUDANCA_USO`). **Nível Retiro continua fora da UI** desta fase também — a versão original
do plano previa um CRUD de Retiro aqui (Retiro → Módulo → Pasto indentado na Lista); essa parte foi
pulada por inteiro, seguindo a mesma instrução explícita do usuário já documentada na seção
"Fase A/B/C" acima (Retiro existe no schema, sempre usa o "Geral", nenhuma tela mostra/cria/edita
retiro).

**`pastos` ganha o campo `area_produtiva_ha`** (já existia na coluna desde a migração 038, só sem UI
até agora) lado a lado com `area_ha` — tanto na tabela de pastos já cadastrados (coluna "Área
produtiva (ha)", com `title` explicando a diferença pro "Área total (ha)") quanto no formulário
inline de "Novo pasto/talhão". Segue o mesmo padrão de todos os campos desse formulário: opcional,
editável no blur do input, sem botão de salvar próprio.

**Lista e mapa lado a lado** (`grid gap-4 md:grid-cols-2` — empilha em mobile, sem toggle) substitui
o antigo botão Lista/Mapa: a Lista fica sempre a esquerda, o Mapa sempre à direita em telas `md:` e
acima. Os controles de upload de KML (contorno da fazenda + importar pastos), a revisão de
importação e o card de "novo contorno desenhado" ficam **acima** da grade lista+mapa, ocupando a
largura toda — só o CRUD de módulo/pasto e o `MapaPastos` propriamente dito entram na grade de duas
colunas.

**Clicar num pasto da lista destaca o polígono no mapa** — cada `<tr>` da tabela de pastos é
clicável (só se `p.geometria` existir; sem contorno não tem o que destacar) e seta
`pastoSelecionadoMapaId`, a mesma variável de estado que já existia pro clique no mapa em si (agora
bidirecional: lista→mapa e mapa→lista). `MapaPastos` ganha um prop novo, `pastoDestacadoId`, que
engorda o traço (`weight` 2→4) e a opacidade do preenchimento (0.25→0.45) do polígono destacado — a
implementação força um remount da camada `<GeoJSON>` correspondente via `key={id}-{destacado}` em
vez de confiar em `setStyle` reativo do react-leaflet, escolha deliberada pra garantir que o
restyle sempre aconteça (o comportamento de atualização de estilo em camadas já montadas varia
entre versões da lib). A linha da tabela também ganha destaque visual (`bg-brand-100`) quando
selecionada, espelhando o destaque no mapa.

**Ações de módulo/pasto viram ícones** (`IconToggle`/`IconExcluir`, SVGs inline no mesmo estilo de
traço da Sidebar — `viewBox 0 0 24 24`, `strokeWidth 1.75`) no lugar dos links de texto
"Inativar"/"Ativar"/"Excluir" — `title` no botão substitui o texto visível, confirmação de exclusão
continua inline (mesmo padrão `error`/"Sim, excluir"/"Cancelar"). Nome e áreas continuam editáveis
inline via blur, sem ícone de "editar" próprio (não existe uma ação de editar separada — o campo já
é o próprio editor).

**Aviso de "pastos sem contorno"**: card `border-dashed` (não `warning` — é informativo, não um
alerta) no topo da aba, abaixo do parágrafo introdutório, listando por nome (separado por vírgula)
os pastos ativos sem `geometria`. Só renderiza quando essa lista tem pelo menos um item — reativo,
soma/subtrai da lista assim que um pasto ganha ou perde contorno (criar um pasto novo sem desenhar
nada, ou desenhar um contorno pra um pasto que não tinha, atualiza o card sem precisar recarregar a
página).

**Criar pasto em lote a partir do KML**: o `<select>` de cada linha da revisão de "Importar pastos
de um KML" ganha uma segunda opção fixa, **"+ Criar novo pasto"** (`NOVO_PASTO`, valor sentinela
`'__novo__'`), ao lado de "Ignorar" e da lista de pastos existentes pra casar pelo nome. Escolher
essa opção revela um segundo `<select>` inline (módulo de destino, pré-selecionado com o primeiro
módulo da fazenda) só naquela linha. `LinhaRevisaoImportacao` ganhou `criarNovo: boolean` e
`moduloIdNovo: string` — `handleConfirmarImportacaoKml` agora processa dois grupos na mesma
confirmação: `paraCasar` (atualiza `geometria`+`area_ha` de pastos existentes, como antes) e
`paraCriar` (insere pastos novos, calculando `ordem` incrementalmente por módulo pra suportar várias
linhas do mesmo lote caindo no mesmo módulo). Pastos criados por essa via não recebem
`area_produtiva_ha` (só a área calculada do KML vai pra `area_ha`) — o usuário completa depois na
lista, mesmo fluxo de qualquer pasto novo.

Verificado no navegador (`FAZENDA TESTE TULIO`): renomeação da aba, layout lista+mapa lado a lado
(confirmado via `getBoundingClientRect` que a lista fica à esquerda do mapa em viewport 1280px),
criar pasto com área total + área produtiva preenchidas (valores persistidos corretamente),
excluir pasto via ícone com confirmação inline, card "pastos sem contorno" atualizando ao
criar/excluir pasto, e o fluxo completo de importação de KML em lote — um KML sintético com dois
placemarks (um casando pelo nome com um pasto existente, outro sem correspondência) confirmou
auto-casamento correto pelo primeiro, "+ Criar novo pasto" com seletor de módulo aparecendo pro
segundo, e a confirmação da importação executando as duas ações na mesma passada (pasto existente
atualizado com geometria/área, pasto novo criado com geometria/área e vinculado ao módulo
escolhido). Dados de teste revertidos ao estado original depois da verificação (pasto de teste
excluído, geometria/área do pasto "Geral" restauradas).

## Área Inicial fundida no cadastro da fazenda (Fase E)

A aba "Área Inicial" foi removida — declarar a área por tipo de uso deixa de ser uma tela permanente
e vira um **passo único logo após criar uma fazenda**, no mesmo espírito do que já acontecia (a
fazenda recém-criada já era auto-selecionada; agora esse momento é usado pra guiar a declaração
antes de mostrar as abas normais). Toda a lógica que antes vivia inline em `app/fazendas/page.tsx`
(nunca tinha sido extraída em componente próprio) foi movida pra
`components/fazendas/AreaInicialForm.tsx`, reutilizado em dois lugares:

1. **`app/fazendas/page.tsx`**: quando `fazendaRecemCriadaId === fazendaSelecionadaId`, a página
   renderiza um card único ("[Nome] cadastrada com sucesso" + o formulário) **no lugar** da barra de
   abas — não existe mais aba "Área Inicial" pra abrir sozinha depois. Um botão "Pular por enquanto"
   deixa esse passo puramente opcional (decisão deliberada: nada no pedido original exigia bloquear o
   fluxo, e forçar a declaração antes de lançar o saldo inicial do rebanho seria uma fricção
   desnecessária). Salvar ou pular chamam o mesmo `handleAreaInicialConcluida` — some o card e abre a
   aba "Saldo Inicial" (`abaSelecionada('saldo')`), que é a única aba visível por padrão daqui pra
   frente (junto de "Distribuição da Área" e "Gestão de Áreas", quando `controla_pasto` estiver
   ligado).
2. **`components/fazendas/DistribuicaoAreaPanel.tsx`**: ganha uma seção nova, **"Corrigir declaração
   inicial"**, colapsável (`+`/`−`, fechada por padrão pra não competir visualmente com "Lançar
   mudança de uso", o fluxo mais usado dessa aba) — é o único lugar pra reabrir e editar a
   declaração depois que o passo inicial foi salvo ou pulado. Sem `onSalvo` bloqueante: como cada
   linha de área inicial já tem `existingId` só quando já existe uma linha `SALDO_INICIAL` gravada
   pra aquele tipo de uso, o mesmo componente serve tanto pra "declarar pela primeira vez" quanto
   "corrigir depois" sem nenhuma bifurcação de código — a diferença entre os dois contextos é só
   coreografia de onde o componente aparece na tela, nunca lógica interna.

**`AreaInicialForm` ganha importação de KML** (novidade desta fase — a aba antiga só aceitava
digitar os números à mão): um botão "Importar KML" abre a mesma tela de revisão já usada em
"Importar pastos de um KML" (Fase D) — cada polígono do arquivo vira uma linha com nome, área
calculada e um `<select>` de tipo de uso (7 opções + "Ignorar", sem tentativa de casar automático
por nome, diferente do import de pasto — "Pecuária tratada igual aos demais", sem vínculo com pasto
nenhum). **Ao confirmar, polígonos do mesmo tipo de uso são somados entre si primeiro, e essa soma é
somada (não substituída) ao valor que já estiver no campo daquele tipo de uso** — permite digitar
uma parte à mão e importar o resto, ou importar em duas levas de KML diferentes, sem perder o que já
tinha sido preenchido. Verificado no navegador com um KML sintético de 2 polígonos: um campo já
preenchido manualmente (Pecuária = 50) recebeu +118,99 de um polígono importado (resultado: 168,99),
e Reserva Legal/APP (campo vazio) recebeu os 118,99 do outro polígono — comportamento de soma
confirmado nos dois casos (campo vazio e campo já preenchido).

**Refresh reativo entre a correção e o gráfico**: como "Corrigir declaração inicial" agora vive
dentro da mesma tela que o gráfico/tabela de "Distribuição de área" (antes eram abas separadas, e
trocar de aba já recarregava tudo sozinho), salvar uma correção precisa avisar o resto do painel pra
não ficar com número desatualizado até o usuário recarregar a página manualmente — bug real
encontrado durante a verificação desta fase (corrigi um valor, o card "Corrigir declaração inicial"
mostrou o total certo, mas o gráfico acima continuou com o número antigo até um F5). Corrigido com
`refreshKey` (contador incrementado no `onSalvo` do formulário), incluído nas dependências dos três
`useEffect` que buscam dado de `DistribuicaoAreaPanel` (distribuição mensal, áreas finais por tipo
de uso, conferência com pastos) — mesmo padrão de "trigger de recarga" já usado em vários outros
pontos do app via callback `onSaved`/`onSalvo`, só que aqui escrevendo pro estado do componente pai
em vez de re-montar um componente filho.

Verificado no navegador: criar fazenda nova → passo de área inicial aparece automaticamente (sem
barra de abas) → digitar um valor manual + importar KML com 2 polígonos (um casando com o tipo já
preenchido, somando; outro pra um tipo vazio) → salvar → transição automática pra aba "Saldo
Inicial" com as abas normais visíveis. Depois, na aba "Distribuição da Área", "Corrigir declaração
inicial" expandido mostrou os valores corretos já carregados (`existingId` preenchido), edição de um
valor + salvar atualizou tanto o próprio formulário quanto o gráfico/tabela acima **sem precisar
recarregar a página** (confirmando o fix do `refreshKey`). Fazenda e pessoa de teste removidas depois
da verificação.

## Relatório de Lotação: área produtiva como denominador (Fase F)

`app/relatorio-lotacao/page.tsx`, seção "Lotação atual por pasto", trocou `pastos.area_ha` (área
total) por `pastos.area_produtiva_ha` (área realmente aproveitável pra pastagem, adicionada na
migração 038 — ver "Fase A/B/C" acima) tanto no cálculo de UA/ha quanto no valor de área exibido ao
lado (`PastoInfo`/`PastoLotacao` renomeados de `area_ha` para `area_produtiva_ha` de ponta a ponta,
pra não sobrar um campo chamado "area_ha" guardando na verdade a área produtiva). Cai pra "—" quando
o pasto não tem área produtiva preenchida — mesmo tratamento que área ausente já tinha antes, só que
agora a ausência é da área produtiva especificamente (a maioria dos pastos hoje não tem esse campo
preenchido ainda, já que é opcional e só ganhou UI na Fase D). O restante do relatório (KPIs do
período, gráfico combinado, lotação agregada da fazenda via `fn_area_por_uso` em Pecuária) não muda
— a troca vale só pra granularidade por pasto, que é a única parte do relatório com acesso à área de
cada pasto individualmente.

Verificado no navegador: com `area_produtiva_ha` nulo (estado padrão de pastos existentes), a linha
de cada pasto mostrou "— UA/ha" sem nenhum valor de área ao lado — confirma que a troca realmente
saiu de `area_ha` (que tinha valor preenchido e teria mostrado uma lotação real antes desta fase).
Preenchendo `area_produtiva_ha` temporariamente num pasto de teste (15 ha), a lotação calculou
corretamente (1,39 UA/ha pra 33 cabeças a ~285 kg — confere: 33×285/450/15 = 1,39) e a área exibida
passou a mostrar os 15 ha da área produtiva, não os 50 ha de área total do mesmo pasto. Valor de
teste revertido pra `null` depois da verificação.

## Gestão de Áreas — revisão pós-uso: largura, campo de área único, lista plana, satélite

Depois de usar a tela na prática (fazendo desenhos reais de pastos), o usuário reportou três
problemas concretos que motivaram essa revisão — nenhum deles fazia parte do plano original de
Fase D, mas todos afetam a mesma tela:

**Largura da página**: `app/fazendas/page.tsx` usava `max-w-4xl` (herdado de quando a página só
tinha um formulário simples de nome/localização) — com a grade lista+mapa da Fase D, isso apertava
as duas colunas numa faixa de ~430px cada, fazendo a tabela de pastos (4 colunas) e o mapa parecerem
sobrepostos por falta de espaço, não por um bug de posicionamento real. Trocado pra `max-w-6xl`
(mesma largura já usada no Painel) — resolve o aperto sem exigir um container dedicado só pra essa
aba, já que as outras abas de Fazendas (Saldo Inicial, Distribuição da Área) também ganham mais
respiro sem quebrar layout.

**Área total vs. área produtiva revertido pra um campo só**: a distinção de dois campos (introduzida
na Fase D, com a Lotação por pasto passando a dividir por área produtiva na Fase F) foi simplificada
de volta pra um único campo **"Área (ha)"**, editando `pastos.area_ha` — decisão do usuário
confirmada explicitamente, priorizando simplicidade sobre a distinção total/produtiva por enquanto.
Como consequência direta, `app/relatorio-lotacao/page.tsx` **reverteu a Fase F**: "Lotação atual por
pasto" volta a dividir por `area_ha`, não mais por `area_produtiva_ha` (que fica sem nenhuma UI pra
preencher — teria deixado a lotação por pasto sempre "—" se a mudança não fosse revertida junto).
A coluna `pastos.area_produtiva_ha` continua existindo no banco (migração 038), só sem uso agora —
mesmo padrão de "campo reservado pro futuro" já usado em outros pontos do sistema (`formatLotacao`/
`formatGmd` em `lib/format.ts` ficaram anos sem uso antes de `fn_relatorio_lotacao_mensal` existir).

**Lista de módulos/pastos vira uma tabela só, não mais um card por módulo**: a Fase D organizava
cada módulo num card separado com sua própria mini-tabela de pastos — inspirado num pedido do
usuário pra parecer mais com a listagem de referência (sistema "Metryx"), isso virou **uma única
tabela pra fazenda inteira**, coluna "Módulo / Pasto" (linha de módulo em negrito/fundo `bg-bg`,
linhas de pasto indentadas com `pl-6` logo abaixo), "Área (ha)" e "Ações". A linha de "+ Pasto"
(nome + área + botão) e a linha final de "+ Módulo" viraram linhas da própria tabela em vez de um
bloco de formulário separado abaixo de cada card — mesmo padrão de "adicionar" inline já usado em
outras listas do sistema, só que dentro da tabela agora. Tecnicamente, cada bloco de módulo (linha
de módulo + suas linhas de pasto + sua linha de "+ Pasto") é agrupado num `<Fragment key={m.id}>` —
`<>` (a forma curta de Fragment) não aceita `key`, então iterar `modulos.map()` retornando fragmentos
curtos gera um warning do React e quebra a reconciliação da lista; precisa do `Fragment` nomeado
importado de `react`.

**Grade lista+mapa vira proporção assimétrica**: trocado de `md:grid-cols-2` (50/50) pra
`lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]` — a lista (agora só 3 colunas, mais estreita)
ganha o espaço flexível `1fr`, o mapa fica numa faixa fixa entre 360-480px, evitando que o mapa
estique demais em telas muito largas. Altura do mapa também subiu de 480px pra 560px, já que agora
tem mais largura disponível — mantendo uma proporção visual melhor.

**Imagem de satélite via Esri World Imagery**: o usuário perguntou explicitamente sobre trocar o
mapa (antes só OpenStreetMap) por imagem de satélite, incluindo "quais as implicações" — resposta
dada antes de implementar (Google Maps exigiria conta Google Cloud + faturamento + chave de API
restrita, e o jeito simples de "URL de tile" viola os termos de uso do Google; Esri World Imagery é
gratuito, sem chave, sem conta, e é só trocar a URL do `<TileLayer>`). `MapaPastos.tsx` trocou
`url`/`attribution` do OpenStreetMap pro serviço `World_Imagery` do ArcGIS REST
(`server.arcgisonline.com`, esquema de tile `{z}/{y}/{x}` — atenção: ordem `y` antes de `x`, diferente
da convenção `{z}/{x}/{y}` do OSM). A cor do contorno da fazenda (linha tracejada) mudou de cinza
(`#5E6E6A`) pra branco (`#FFFFFF`) — a cor antiga tinha baixíssimo contraste sobre fundo de satélite
(verde/marrom), enquanto branco se destaca bem nos dois. As cores dos polígonos de pasto
(`corCategorica`, paleta categórica já existente) não precisaram de ajuste — continuam legíveis sobre
satélite.

Verificado no navegador: `getBoundingClientRect` confirmou a lista e o mapa lado a lado sem
sobreposição (gap de ~18px, largura de conteúdo saltando de ~430px pra ~1025px em viewport 1280px);
criação de pasto com o campo único de área persistindo corretamente; exclusão de pasto de teste;
tiles do Esri carregando com sucesso (`complete: true, naturalWidth: 256` nos elementos
`.leaflet-tile`); Relatório de Lotação recalculando corretamente com `area_ha` usando dados reais já
desenhados pelo usuário na fazenda de teste (ex.: pasto com 0,76 ha e 33 cabeças resultando em
27,49 UA/ha — conferido pela fórmula).

## Retiro removido por completo (migração 040)

Depois de usar o app na prática, o usuário decidiu que não precisa do nível Retiro de jeito nenhum —
diferente da decisão original (Fase A/B/C, "manter oculto pra quando fizer sentido no futuro"), a
infraestrutura toda foi removida: `alter table modulos drop column retiro_id`, `drop table retiros`,
e as funções/triggers que só existiam por causa dele (`fn_validar_delete_retiro`,
`fn_criar_modulo_pasto_geral` volta a criar só módulo+pasto "Geral" sem retiro,
`fn_validar_delete_fazenda` não cascade-deleta mais `retiros`). Como retiro nunca teve UI nenhuma em
nenhum momento do projeto, não havia dado real de usuário nessa tabela — a migração 040 é uma
remoção limpa, sem backfill nem preocupação de perda de dado.

**Como o bug foi descoberto**: `modulos.retiro_id` era `not null`, mas
`GestaoAreasPanel.tsx`/`handleCriarModulo` nunca preenchia esse campo (o formulário de "novo módulo"
não tinha motivo pra saber que esse campo existia, já que retiro era pra ser 100% invisível) — criar
um módulo novo por essa tela sempre dava `null value in column "retiro_id" ... violates not-null
constraint`. Só não foi pego antes porque toda fazenda de teste usada neste projeto até agora já
tinha o módulo "Geral" auto-criado (via trigger, que preenchia `retiro_id` corretamente); a falha só
aparecia ao clicar em "+ Módulo" pra criar um módulo *adicional* — o usuário foi quem primeiro fez
isso. A correção inicial (carregar o retiro "Geral" da fazenda e enviar junto no insert) foi
descartada em favor da remoção completa, já que o usuário deixou claro que não quer manter essa
camada nem oculta.

## Botão de tela cheia no mapa

`MapaPastos.tsx` ganha um botão de tela cheia (ícone de "expandir"/"recolher", SVG inline no mesmo
estilo de traço já usado no resto do app) — implementado como um controle nativo do Leaflet
(`L.Control.extend`, mesmo padrão imperativo já usado em `ControleDesenho`), empilhando
automaticamente abaixo do toolbar de desenho no canto superior direito do mapa, sem precisar de
posicionamento absoluto manual por cima do `MapContainer`. Usa a Fullscreen API nativa do navegador
(`element.requestFullscreen()`/`document.exitFullscreen()`) no `<div>` que envolve o mapa — nenhuma
biblioteca nova, é a mesma API já suportada por todos os navegadores relevantes. Dois detalhes que
precisaram de atenção:

- **`InvalidarTamanho`**: o Leaflet calcula o tamanho dos tiles com base nas dimensões do container
  no momento em que ele é medido: entrar/sair da tela cheia muda o tamanho do container por fora do
  controle do React, então sem chamar `map.invalidateSize()` depois da transição o mapa ficaria
  cortado/desalinhado até o usuário arrastar ou dar zoom manualmente. Componente auxiliar novo,
  mesmo padrão de `AjustarZoom`/`ControleDesenho` (usa `useMap()` de dentro do `MapContainer`),
  disparado num `useEffect` com `setTimeout` curto sempre que o estado de tela cheia muda.
- **Altura do container**: a `<div>` que envolve o mapa tinha `height: 560` fixo inline — em tela
  cheia isso precisa virar `100vh` (senão o navegador limitaria a área "cheia" à altura antiga em vez
  de ocupar a tela toda), então a altura agora é condicional ao estado `telaCheia`.

Um listener em `document.addEventListener('fullscreenchange', ...)` mantém o estado sincronizado
mesmo quando o usuário sai da tela cheia pela tecla Esc (comportamento nativo do navegador, sem
passar pelo botão) — comparando `document.fullscreenElement` com a própria `<div>` do mapa.

Verificado no navegador: o botão renderiza corretamente empilhado no canto certo, com o ícone e o
`title` esperados; a API `requestFullscreen` está disponível e habilitada no elemento
(`document.fullscreenEnabled === true`). **Não foi possível simular a transição completa de tela
cheia neste ambiente de teste automatizado** — a Fullscreen API exige um gesto genuíno do usuário
(um `.click()` disparado via script não conta como "user activation" pros navegadores, e o painel de
preview usado nesta sessão não estava com o viewport visualmente ativo pra permitir um clique por
coordenada de tela) — vale uma conferência visual manual (local ou no deploy) depois de subir.

## Mover pasto de módulo + cor customizada por pasto (migração 041)

Dois pedidos do usuário depois de usar a Gestão de Áreas na prática, implementados juntos por
tocarem na mesma linha da tabela de pastos.

**Mover pasto pra outro módulo**: como módulo é só uma camada organizacional (saldo/movimentações/
pesagens são resolvidos por `pasto_id` direto, nunca por módulo; a validação de área também é por
fazenda inteira via `fn_validar_area_pasto`, não por módulo), reatribuir `pastos.modulo_id` não tem
nenhuma implicação de saldo ou trajetória — só uma reorganização visual. Por isso não precisou de
nenhuma checagem tipo `fn_checar_edicao_movimentacao`: é um `update` direto (`handleMoverPastoModulo`
em `GestaoAreasPanel.tsx`), sem confirmação, já que é reversível a qualquer momento escolhendo o
módulo de volta. Aparece como um `<select>` compacto na própria linha do pasto na lista — só quando
existe mais de um módulo pra escolher — e fica de fora do pasto "Geral" (`sistema = true`), que
continua sempre atrelado ao módulo "Geral", mesmo princípio já usado nos outros campos protegidos
desse pasto.

**Cor customizada por pasto**: antes, todos os pastos de um mesmo módulo compartilhavam a mesma cor
automática no mapa (`corCategorica` indexada pelo módulo) — num módulo com vários pastos (comum
depois que a Fase D transformou a lista em módulo→pasto plano, sem mais limite visual por card),
ficava difícil distinguir um pasto do outro só pela cor. `pastos.cor` (migração 041, `text` nullable)
guarda uma cor customizada em hex; quando nula, o comportamento de sempre continua (cor automática do
módulo) — nenhuma mudança pros pastos que nunca tiverem cor escolhida. UI é um swatch nativo do
navegador (`<input type="color">`) ao lado do nome do pasto na lista — decisão deliberada de não
replicar o popover de paleta fixa + campo hex do sistema de referência (visto num print do usuário):
o input nativo já dá acesso a qualquer cor e a um campo hex embutido, com muito menos código pra
manter. `pastosParaMapa` resolve a cor final como `p.cor || corPorModulo[p.modulo_id] || '#1C8C7C'`
— mesma prioridade (customizada > automática > fallback) usada em qualquer campo opcional do
sistema.

Verificado no navegador e direto no banco: trocar a cor de um pasto de teste persistiu corretamente
(`pastos.cor` = `#ff00ff`) e sumiu ao reverter (`null`); mover um pasto de "Geral" pra um módulo
criado pelo usuário ("Sítio Túlio") atualizou `modulo_id` corretamente e a lista reagrupou o pasto
sob o novo módulo automaticamente, sem precisar recarregar a página. Os dois testes foram revertidos
ao estado original depois da verificação.

## Revisão de UI baseada em mockup externo (dropdown, sidebar, tabelas, Painel, filtro global)

Sequência de melhorias sugeridas por um mockup gerado por outra ferramenta ("claude cowork"),
filtradas e adaptadas ao design system real do ORION (a paleta/tipografia inventada do mockup **não**
foi adotada — só a estrutura de algumas ideias). Ordem de implementação confirmada com o usuário,
que deliberadamente excluiu duas propostas do mockup: trocar o gráfico de Lotação de rótulo
sempre-visível pra hover-only (contradiria uma decisão anterior já documentada acima) e a paleta de
cores nova (o sistema já tem uma paleta própria e consistente).

**Dropdown de tipo de movimentação humanizado**: `app/movimentacoes/page.tsx` tinha um bug real —
os dois `<select>` de tipo (formulário de lançamento e filtro da listagem) e os dois pontos de
exibição na listagem (`m.tipo`/`primeira.tipo`) mostravam o enum cru do banco (`VENDA_PE`,
`CONSUMO_DOACAO`) em vez de um rótulo legível. Corrigido com um dicionário `LABEL_TIPO: Record<TipoMovimentacao, string>`
local ao arquivo, aplicado nos 4 pontos.

**Sidebar colapsável**: `components/Sidebar.tsx` ganhou um botão de recolher/expandir (ícone de seta,
no topo da sidebar desktop, ao lado do nome "ORION AGRO") — colapsada, vira uma faixa de 64px
(`w-16`) só com ícones (com `title` nativo como tooltip); expandida, os 240px (`w-60`) de sempre. O
estado do menu mobile (drawer) não muda — o toggle só existe na versão desktop. Como o espaço
reservado pro conteúdo (`md:pl-60`) vivia em `app/layout.tsx`, fora do componente `Sidebar`, o estado
`collapsed` precisou subir pra um componente novo, `components/AppShell.tsx` — client component que
envolve `Sidebar` + o `<div>` de conteúdo, repassando `collapsed`/`onToggleCollapsed` como props pro
`Sidebar` e trocando `md:pl-60`/`md:pl-16` no wrapper de conteúdo em uníssono. Estado persistido em
`localStorage` (`orion.sidebarColapsada`), lido só depois de montar (evita mismatch de hidratação
entre servidor e cliente). `AppShell` também passou a ser o lugar natural pra hospedar os providers de
contexto compartilhados entre páginas (`AuthProvider`, `FiltroGlobalProvider` — ver abaixo).

**Tabela → card no mobile**: abaixo de 768px, tabelas largas viram uma lista de cards empilhados em
vez de rolagem horizontal. Aplicado nas duas tabelas mais largas do app: `app/relatorio-rebanho-por-pasto/page.tsx`
(pasto + linhas de categoria/quantidade/peso, cada `<table>`/lista de cards renderizada com
`hidden md:block`/`md:hidden` a partir dos mesmos dados já calculados, sem chamada nova ao banco) e a
tabela cruzada (tipo de uso × mês) de `components/fazendas/DistribuicaoAreaPanel.tsx` — nesse caso o
card do mobile **não** repete o detalhe mês a mês (empilhar 12 colunas como linhas seria só uma
tabela disfarçada, não mais legível); mostra só o resumo que importa pra decisão rápida — Área média
e Área final por tipo de uso —, com o detalhe mensal completo ficando reservado pra tela `md:` acima.

**Destaque cruzado lista ↔ rosca no Painel**: a lista "Distribuição do rebanho atual" e a rosca
"Distribuição sexo × categoria" (`app/page.tsx`) já existiam lado a lado, mas isoladas uma da outra.
Passar o mouse numa linha da lista agora encontra o índice correspondente em `porCategoriaPorSexo`
(as duas listas têm ordens diferentes — a lista é só por quantidade desc, a rosca agrupa por sexo
primeiro —, então o casamento é por **nome da categoria**, não por índice) e chama o mesmo
`setHoverCategoriaIndex` que a rosca e a legenda já usavam, destacando a linha (`bg-brand-100`), a
fatia da rosca (crescimento nativo do recharts) e o item da legenda (`bg-brand-100` também, novo) ao
mesmo tempo, com o rótulo central da rosca atualizando pra mostrar a categoria em foco.

**Filtro de período global sincronizado**: Painel, Relatório de Lotação, Relatórios de Movimentações
e Resumo de Movimentação de Rebanho reimplementavam cada um seu próprio estado de fazenda(s) +
período (mesmas ~8 variáveis: `fazendaIds`, `modoFiltro`, `mes`, `safraAnoInicio`,
`anoCalendarioSelecionado`, `dataInicioCustom`, `dataFimCustom`, mais os cálculos derivados de
`dataInicio`/`dataFim`/`periodoInvalido`) — escolher uma fazenda específica + um período numa tela e
navegar pra outra resetava tudo. Extraído pra `contexts/FiltroGlobalContext.tsx` (`FiltroGlobalProvider`,
montado em `AppShell`, então sobrevive à navegação entre páginas sem precisar de `localStorage` —
mas persiste em `localStorage` também, `orion.filtroGlobal`, pra sobreviver a um F5), com um hook
`useFiltroGlobal()` que devolve exatamente as mesmas variáveis que cada página já tinha localmente —
a migração de cada página foi só trocar a declaração local por essa chamada de hook, sem tocar no
resto do arquivo (JSX, queries). Fazenda(s): começa com todas marcadas na primeira visita (sem nada
salvo ainda); depois disso, a seleção sempre vem do `localStorage`, filtrando ids que não existem
mais. Período: default `'safra'` (Ano Safra atual) — o Painel já usava esse default antes de existir
sincronização; as outras 3 páginas usavam `'mes'` como default próprio, então esse é um efeito
colateral consciente da unificação (documentado aqui, não um bug): a primeira visão de qualquer uma
delas agora abre em "Safra atual" em vez de "Mês atual", exceto se o usuário já tiver escolhido outra
coisa antes (aí o valor salvo vale). Verificado no navegador: selecionar 1 fazenda + "Período
personalizado" (fev/2026) no Painel e navegar pra Relatório de Lotação e Relatórios de Movimentações
mostrou a mesma fazenda e o mesmo período nos dois, sem precisar reconfigurar.

## Modelo de acesso e login (Supabase Auth, migração 042)

Decisão já registrada em memória de projeto antes desta implementação (`permission_model_design`):
sem perfis/papéis nomeados — permissão **direta por usuário → módulo**. Um usuário "dono" (rebatizado
"Administrador" em todo texto visível — ver nota de nomenclatura abaixo) tem acesso total sem passar
por nenhuma checagem; os demais usuários (funcionários) têm uma lista própria de módulos liberados.
Single-tenant (um grupo só) — não há isolamento entre "contas" diferentes, só entre pessoas dentro do
mesmo grupo. RLS **continua desligado** propositalmente (decisão já registrada em
`deployment_roadmap`: reativar RLS é um passo futuro separado, só depois deste modelo estar pronto e
testado) — o enforcement de módulo nesta fase é feito inteiramente no app (Proxy + client-side), não
no banco.

**`usuarios_app`** (id referencia `auth.users(id)`, nome, email, `dono` boolean, `ativo` boolean,
`modo` — 'CAMPO'/'GESTAO', preparado agora pra não exigir migração nova quando a Fase 7 do roadmap de
melhorias, PWA "Modo Campo/Modo Gestão", for implementada; hoje nenhuma tela lê essa coluna) +
**`usuario_modulos`** (usuario_id, modulo — um módulo liberado por linha, catálogo de strings livre
que espelha os ids de rota já usados na Sidebar, sem tabela de módulos própria — mesmo espírito de
"sem tabela de perfis" já decidido). **Nome deliberadamente `usuarios_app`, não `usuarios`**: o schema
já tinha uma tabela `usuarios`/`usuario_fazenda`/enum `papel_usuario` de um rascunho anterior à
decisão de usar Supabase Auth — nunca teve nenhuma linha nem foi referenciada por código nenhum do
app (só colunas `created_by`/`usuario_id` nullable e nunca escritas em `categorias_animal`/
`movimentacoes_rebanho`/`pesagens`/`lancamentos_financeiros`). Deixado como está (dead schema
inofensivo) — mexer numa tabela de produção fora do escopo desta migração não valia o risco só por
causa de um nome. `fn_existe_dono()` (`select exists(...)`) é chamada pela tela de login com a chave
anônima, antes de qualquer sessão existir, pra decidir entre mostrar o formulário normal de entrar ou
o formulário único de "criar conta de administrador" — só retorna um boolean, nunca expõe dado.

**Catálogo de módulos** (`lib/modulos.ts`, `ModuloId`): um id por rota gateável — `fazendas`,
`categorias`, `pessoas`, `movimentacoes`, `pesagens`, `resumo_movimentacao`,
`relatorios_movimentacoes`, `relatorio_lotacao`, `mudanca_pasto`, `rebanho_por_pasto`. **O Painel
(`/`) fica de propósito fora do catálogo** — é só uma visão geral somente-leitura, sempre acessível a
qualquer usuário logado (administrador ou funcionário), porque sem isso um funcionário sem nenhum
módulo liberado não teria pra onde ir depois de entrar.

**Infra de sessão** (Next.js 16 renomeou Middleware pra Proxy — mesmo arquivo/convenção, nome novo;
`proxy.ts` na raiz do projeto): `lib/supabase/server.ts` (cliente SSR lendo/escrevendo sessão via
cookies, usado no proxy e nas Route Handlers) e `lib/supabase/admin.ts` (cliente com a
`service_role` key, `import 'server-only'` no topo — faz o build falhar se algum componente client
tentar importar esse arquivo, garantindo que a chave nunca alcança o navegador). `proxy.ts` roda em
toda rota (exceto `/api`, assets estáticos e os ícones/manifest do PWA), renova a sessão via
`supabase.auth.getUser()` e redireciona quem não está logado pro `/login` — é uma checagem
"otimista" (só lê o cookie, sem tocar o banco); qual módulo cada um pode ver continua sendo checado
no app, não aqui.

**`/login`**: formulário normal de entrar (e-mail+senha) quando `fn_existe_dono()` é `true`; quando
`false`, um formulário único de "criar conta de administrador" (nome+e-mail+senha,
`supabase.auth.signUp()` seguido de um insert em `usuarios_app` com `dono: true` — funciona mesmo com
RLS desligado, e mesmo se a confirmação por e-mail estiver ligada no projeto Supabase, porque o insert
usa o `id` já retornado pelo `signUp()` antes da confirmação). Se o projeto tiver confirmação de
e-mail ativada, mostra um aviso "verifique seu e-mail" em vez de redirecionar direto — cai pro fluxo
normal de entrar depois que a pessoa confirmar.

**`contexts/AuthContext.tsx`** (`AuthProvider`, montado em `AppShell` — sobre `/login`, uma versão
mínima sem `FiltroGlobalProvider`/`Sidebar`, já que essa rota não precisa de nenhum dos dois):
carrega `usuarios_app` + `usuario_modulos` do usuário logado (via `supabase.auth.onAuthStateChange`,
tanto no carregamento inicial quanto em login/logout subsequentes) e expõe `isDono`,
`podeAcessar(modulo)` (`isDono || modulosPermitidos.has(modulo)`) e `signOut()`. **Usuário inativado
(`ativo = false`) é deslogado automaticamente** — inativar só desliga uma flag no banco, não revoga a
sessão já existente no Supabase Auth, então sem essa checagem no `AuthContext` a pessoa continuaria
acessando os módulos que tinha antes de ser desligada. Ao detectar `ativo = false`,
`carregarDadosApp` chama `signOut()` e redireciona pra `/login?inativo=1` (que mostra um aviso) — via
`window.location.href`, não `router.push()`: um bug real foi descoberto durante o teste (o cache de
rota do Next.js reaproveitava a instância já montada de `/login`, que não relia o parâmetro da URL no
efeito de montagem), então esse redirecionamento específico usa navegação completa de propósito, pra
garantir uma montagem nova.

**Sidebar filtrada por permissão**: `components/Sidebar.tsx` filtra os itens de cada grupo por
`podeAcessar(item.modulo)` (grupo inteiro some se nenhum item sobrar), mostra uma seção
"Administração → Usuários" só pra `isDono`, e o rodapé ganha o nome do usuário logado + botão "Sair"
(some quando colapsada, vira só o ícone).

**`components/ModuloGate.tsx`**: aplicado em volta do JSX de retorno das 10 páginas gateáveis (uma
por módulo do catálogo) — se `podeAcessar(modulo)` for falso, renderiza um card "Acesso restrito" no
lugar do conteúdo real, no mesmo estilo `border-dashed` já usado em outros estados vazios do app.
Client-side, então não é a linha de defesa final (RLS desligado ainda permite ler os dados via
`anon key` se alguém inspecionar a rede) — é suficiente pra impedir acesso casual via UI/URL direta
enquanto RLS não volta a ser reativado (próximo passo do roadmap, fora do escopo desta migração).

**`/usuarios`** (só `isDono`, checagem própria — não usa `ModuloGate`, já que não é um módulo
liberável, é exclusivo do administrador): lista usuários com seus módulos, um botão "+ Novo usuário"
(`components/usuarios/CadastrarUsuarioModal.tsx`) e checkboxes de módulo editáveis inline por
usuário (toggle imediato via `PATCH`, sem botão de salvar próprio). Radio de Modo Gestão/Campo já
presente no formulário de criação (grava a coluna, mas ainda não muda nenhum comportamento — nota
explícita no formulário avisando disso). Ações de servidor em `app/api/usuarios/route.ts` (`GET`
lista, `POST` cria) e `app/api/usuarios/[id]/route.ts` (`PATCH` — nome/ativo/modo/módulos, módulos
sempre substituídos por completo, apaga-e-reinsere, mesmo princípio já usado noutros pontos do
sistema pra listas filhas). Toda rota começa com `exigirDono()` (sessão válida + `usuarios_app.dono`
via o cliente de servidor) antes de qualquer coisa — Route Handlers são tratadas com a mesma
seriedade de um endpoint público, mesmo protegido atrás de `/api`. `POST` usa
`admin.auth.admin.createUser({ email, password, email_confirm: true })` — confirmado na hora, porque
quem está criando a conta é o próprio administrador, não faz sentido exigir que o funcionário
confirme por e-mail uma senha que o administrador acabou de definir; se o insert em `usuarios_app`
falhar depois, o usuário de auth recém-criado é apagado (`deleteUser`) pra não sobrar uma conta órfã
sem perfil. Não existe rota de exclusão — "Inativar" (toggle de `ativo`) é a única forma de desligar
alguém, mesmo princípio de "inativar, nunca excluir" já usado em categoria/pasto/pessoa/fazenda.

**Nomenclatura "Dono" → "Administrador"**: pedido do usuário depois de ver a implementação — a coluna
interna `usuarios_app.dono` e a variável `isDono`/`exigirDono()` continuam com esse nome (mudar teria
significado mexer em toda a lógica de banco/API só por causa de rótulo, sem ganho real), mas todo
texto **visível** foi trocado pra "Administrador": título e botão de "Criar conta de administrador" em
`/login`, badge "Administrador" ao lado do nome na lista de `/usuarios`, e as duas mensagens de erro
"Só o administrador pode gerenciar usuários." nas Route Handlers.

**Variável de ambiente nova**: `SUPABASE_SERVICE_ROLE_KEY` em `.env.local` (Project Settings → API →
`service_role`/secret key no painel do Supabase) — necessária só pro `lib/supabase/admin.ts`
(criação/edição de usuário funcionário). Nunca commitada (`.env*` já estava no `.gitignore`); precisa
ser adicionada também nas variáveis de ambiente da Vercel antes do próximo deploy pra produção, senão
a criação de usuário funciona local mas quebra em produção.

Verificado de ponta a ponta no navegador: bootstrap da conta de administrador (`fn_existe_dono()`
`false` → `true` depois de criada, confirmado também via query direta), login/logout por senha,
Sidebar mostrando todos os grupos + "Administração/Usuários" pro administrador, criação de um usuário
funcionário de teste com todos os módulos marcados (confirmado no banco: linha em `usuarios_app` +
10 linhas em `usuario_modulos`), reconfiguração pra só 1 módulo direto no banco (simulando o mesmo
efeito do toggle de checkbox), login como esse funcionário mostrando **só** "Painel" + o módulo
liberado na Sidebar, bloqueio de acesso direto por URL tanto a um módulo não liberado quanto a
`/usuarios` (mensagens "Acesso restrito" distintas — uma por `ModuloGate`, outra específica de
`/usuarios`), redirecionamento de sessão não autenticada pro `/login` (proxy), e o fluxo de
inativação: toggle "Inativar" na UI do administrador → próxima tentativa de login do funcionário
inativado é bloqueada com aviso, confirmado só depois de corrigir o bug real encontrado nesse teste
(inativar não deslogava quem já tinha sessão ativa). Usuário de teste inativado ao final (não
excluído — sem rota de exclusão, por design).

## PWA Modo Campo / Modo Gestão

Última peça do roadmap de melhorias derivado do mockup externo — desbloqueada só depois do modelo de
acesso e login existir (`usuarios_app.modo`, preparado desde a migração 042, mas sem nenhum
comportamento até agora). Modo Gestão continua sendo a sidebar clássica de sempre, sem nenhuma
mudança; Modo Campo troca a navegação inteira por um layout simplificado pensado pra uso no celular
com uma mão só, no meio do trabalho de campo — mas **reaproveita as mesmas páginas/formulários** do
Modo Gestão, sem versão simplificada própria de cada tela (escopo deliberadamente contido: o que
muda é só a navegação ao redor, não o conteúdo de cada módulo).

**`lib/nav-icons.tsx`**: `Icon`/`ICONS` extraídos de `components/Sidebar.tsx` (que agora importa de
lá) pra serem reaproveitados também pelo Modo Campo, sem duplicar ~15 `<svg>`. `lib/modulos.ts` ganhou
um campo `icon` por módulo (referenciando `ICONS`), então tanto a Sidebar quanto os componentes novos
do Modo Campo desenham o mesmo ícone por módulo a partir de uma fonte só.

**`components/campo/InicioCampo.tsx`**: substitui o Painel completo (KPIs, gráficos) quando
`usuarioApp.modo === 'CAMPO'` — em vez disso, mostra uma saudação ("Olá, [nome]") e um botão grande
por módulo liberado (ícone + rótulo, num card `bg-brand-100`/`text-brand-700`), sem nenhum dado
agregado pra carregar. Ordem dos botões prioriza os módulos de lançamento mais comuns em campo
(`movimentacoes`, `pesagens`, `mudanca_pasto` primeiro, via `ORDEM_PRIORIDADE`); os demais módulos
liberados (caso a pessoa tenha) aparecem depois, na ordem do catálogo. `app/page.tsx` foi dividido em
dois componentes — `PainelPage` (só chama `useAuth()` e decide qual dos dois renderizar) e
`PainelDashboard` (todo o conteúdo antigo do Painel, movido pra dentro de um componente próprio) —
de propósito: como React não permite pular hooks condicionalmente, decidir isso *dentro* do mesmo
componente exigiria chamar todos os hooks de busca de dados do dashboard mesmo pra quem nunca vai
ver esse conteúdo (Modo Campo). Com a decisão sendo "qual componente montar" em vez de "quais hooks
pular", os hooks do `PainelDashboard` (e as buscas que eles disparam) só rodam quando ele é
efetivamente renderizado.

**`components/campo/ModoCampoShell.tsx`**: layout alternativo ao par Sidebar+conteúdo — barra
superior fina (marca + nome do usuário + "Sair") e uma barra de abas fixa embaixo (`fixed inset-x-0
bottom-0`, com `overflow-x-auto` caso a pessoa tenha muitos módulos) contendo "Início" + um item por
módulo liberado, ambos usando os mesmos ícones de `lib/nav-icons.tsx`. `<main>` recebe `pb-20` pra o
conteúdo não ficar escondido atrás da barra fixa. As páginas em si (formulários, listas) renderizam
sem nenhuma adaptação — a mesma página que aparece dentro da Sidebar no Modo Gestão aparece aqui
dentro desse shell, incluindo o `ModuloGate`: acessar uma URL de um módulo não liberado continua
mostrando "Acesso restrito" normalmente, mesmo em Modo Campo.

**`components/AppShell.tsx`** ganhou um componente interno novo, `LayoutPorModo` — só ele fica
*dentro* do `AuthProvider` (por isso não pode viver direto em `AppShell`, que precisa decidir *antes*
de montar `AuthProvider` se a rota é `/login`) e escolhe entre `Sidebar` (Modo Gestão, ou enquanto
`usuarioApp` ainda não carregou) e `ModoCampoShell` (Modo Campo) via `useAuth().usuarioApp?.modo`.

**Modo editável depois da criação**: até agora o campo `modo` só podia ser escolhido no momento de
criar o usuário (`CadastrarUsuarioModal`, sem UI pra mudar depois). `app/usuarios/page.tsx` ganhou um
`<select>` por usuário (não-administrador) — mesmo padrão dos módulos, `PATCH` imediato sem botão de
salvar próprio — usando a mesma Route Handler que já existia (`app/api/usuarios/[id]/route.ts` já
aceitava `modo` no corpo desde a Fase 6, só não tinha UI que enviasse esse campo depois da criação).

Verificado no navegador: usuário de teste reconfigurado pra `modo = 'CAMPO'` com 2 módulos
(Lançamento de Movimentações, Pesagens) — login mostrou `InicioCampo` com os 2 botões na ordem certa
e a barra de abas inferior com Início + os 2 módulos; clicar num item da barra abriu a página real
(formulário de Lançamento de Movimentações) dentro do shell simplificado, com o `ModuloGate` normal
por trás; navegar direto pra uma URL de módulo não liberado (`/fazendas`) mostrou "Acesso restrito"
com a mesma barra de navegação do Modo Campo ao redor (chrome mantido, conteúdo bloqueado). Usuário
de teste revertido a `ativo = false`/`modo = 'GESTAO'` ao final.

## Modo Consulta (migração 043) + módulos recolhíveis em Usuários

Terceiro valor de `usuarios_app.modo`, pedido pelo usuário pra gente que só precisa acompanhar
relatórios sem lançar ou editar nada. **Decisão deliberada de escopo**: em vez de criar um mecanismo
novo de "somente leitura" (desabilitar botão de salvar/criar/excluir dentro de cada tela), Consulta
reaproveita o mesmo sistema de permissão por módulo já existente — 4 dos 10 módulos
(`resumo_movimentacao`, `relatorios_movimentacoes`, `relatorio_lotacao`, `rebanho_por_pasto`) já são
100% somente-leitura hoje (nenhum tem ação de escrita), e Consulta simplesmente só pode ter esses 4
liberados. A alternativa (bloquear edição campo a campo dentro de Fazendas/Categorias/Pessoas/etc.)
foi descartada por ser um trabalho bem maior — mexeria em mais de 10 telas — sem pedido claro de que
alguém precise *ver* essas telas de cadastro sem poder editá-las.

`lib/modulos.ts` ganhou `somenteLeitura?: boolean` por módulo e `MODULOS_CONSULTA` (a lista derivada
dos módulos com essa flag). Consulta usa a mesma sidebar completa de Gestão (não a barra de abas do
Modo Campo) — só o Painel dela mesmo, uma pessoa de escritório acompanhando números, não alguém no
campo. `components/usuarios/CadastrarUsuarioModal.tsx` filtra a lista de checkboxes mostrada pra só
os 4 módulos quando "Consulta" está selecionado, e poda (`handleMudarModo`) qualquer módulo de
escrita que já estivesse marcado se o rádio for trocado de volta pra Consulta depois de já ter
marcado outra coisa. `app/usuarios/page.tsx` espelha a mesma poda ao trocar o modo de um usuário já
existente — `handleAlterarModo` manda `modo` e `modulos` (já filtrados) na mesma chamada `PATCH`,
pra não deixar um módulo de escrita "esquecido" preso num usuário que acabou de virar Consulta.

**Módulos recolhíveis em `/usuarios`**: pedido separado do usuário, pra "otimizar espaço e ficar mais
limpo" — a lista de checkboxes de módulo por usuário (que cresce conforme mais módulos existem)
virou uma seção com cabeçalho clicável "Módulos (N selecionados)" + `+`/`−`, fechada por padrão,
mesmo padrão de accordion já usado em outros pontos do app (ex.: "Corrigir declaração inicial" em
Distribuição da Área). O `<select>` de modo (compacto, uma linha só) não precisou desse tratamento,
só a grade de checkboxes.

Verificado: migração aplicada (constraint aceita `CONSULTA`); usuário de teste reconfigurado direto
no banco pra `modo = 'CONSULTA'` com 2 módulos de relatório — login mostrou a sidebar completa (não
a barra de abas do Modo Campo) só com Painel + os 2 relatórios liberados, e acesso direto por URL a
`/movimentacoes` continuou bloqueado com "Acesso restrito", confirmando que Consulta não abre
nenhuma tela de escrita mesmo sem nenhum bloqueio novo dentro delas. Accordion recolhido por padrão
e opção "Consulta (só relatórios)" no `<select>` confirmados visualmente pelo usuário na sua própria
sessão de administrador. Usuário de teste revertido a `ativo = false`/`modo = 'GESTAO'` ao final.

## Redefinir senha, excluir usuário e alterar minha senha (self-service)

Pedido do usuário: funcionário que esquece a senha precisa de uma forma de recuperar acesso, e
funcionário que sai da fazenda precisa poder ser removido de vez (em vez de só acumular como
"Inativo" pra sempre). Três peças, já que "senha padrão, depois o usuário troca" só funciona de
verdade se existir uma tela pra trocar depois de logado — não existia nenhuma até agora.

**Redefinir senha (administrador → funcionário)**: botão "Redefinir senha" por usuário não-dono em
`app/usuarios/page.tsx`, ao lado de "Inativar"/"Excluir". `PATCH /api/usuarios/[id]` ganhou um campo
novo no corpo, `resetSenha: true` — quando presente, chama só
`admin.auth.admin.updateUserById(id, { password: SENHA_PADRAO })` (constante `'123456'`, mesmo
cliente admin/service-role já usado pra criar usuário) e retorna, sem tocar nos outros campos do
PATCH (nome/ativo/modo/módulos continuam como uma chamada separada, sem se misturar com essa). Uma
mensagem inline (`bg-success-bg`, mesmo padrão de confirmação já usado no resto do app) confirma
"Senha redefinida para 123456 — avise a pessoa pra trocar depois de entrar", some sozinha depois de
alguns segundos.

**Excluir usuário (hard delete)**: botão "Excluir" com confirmação inline (`error`/"Sim,
excluir"/"Cancelar", nunca `window.confirm()` — mesmo padrão já usado em módulo/pasto/pessoa/
fazenda). `DELETE /api/usuarios/[id]` bloqueia se o alvo for o dono (`usuarios_app.dono`, checado
antes de qualquer coisa) e, se não for, chama só `admin.auth.admin.deleteUser(id)` — **sem** nenhuma
limpeza manual de `usuarios_app`/`usuario_modulos`: as duas FKs (`usuarios_app.id → auth.users`,
`usuario_modulos.usuario_id → usuarios_app`) já são `on delete cascade` desde a migração 042, então
apagar o login em `auth.users` já apaga o resto sozinho. Diferente de fazenda/pessoa/pasto/módulo,
não existe checagem de "está referenciado em outra tabela" — nenhuma tabela real do sistema
referencia `usuarios_app` como FK (as colunas `created_by`/`usuario_id` do rascunho antigo de
`usuarios`/`usuario_fazenda`, documentado em "Modelo de acesso e login" acima, nunca foram escritas
por código nenhum), então excluir é sempre seguro e imediato — sem a mensagem de erro-do-banco que
os outros "excluir" repassam quando bloqueados.

**Alterar minha senha (self-service, qualquer usuário logado)**: modal novo,
`components/AlterarSenhaModal.tsx` — dois campos (nova senha + confirmar), valida coincidência no
cliente antes de chamar `supabase.auth.updateUser({ password })` (client-side, sessão do próprio
usuário — não precisa do cliente admin nem de nenhuma Route Handler, já que a pessoa só pode alterar
a própria senha). Acionado por um botão novo (ícone de chave, `ICONS.senha` em
`lib/nav-icons.tsx`) ao lado do "Sair" — presente nos **dois** layouts de navegação
(`components/Sidebar.tsx` e `components/campo/ModoCampoShell.tsx`), já que um usuário pode estar em
Modo Campo ou Modo Gestão/Consulta e precisa da mesma opção nos dois. Sem essa peça, "senha padrão,
depois troca" seria só metade implementado — o administrador reseta, mas o funcionário nunca teria
como trocar de fato.

Verificado: com o navegador local logado como o funcionário de teste "Teste 1"
(`tuliovilar3@hotmail.com`), "Alterar minha senha" rejeitou senhas diferentes ("As senhas não
coincidem"), aceitou uma troca válida (confirmado com `supabase.auth.updateUser` retornando sucesso)
e a senha foi revertida pra `123456` ao final via chamada direta ao Admin API (mesmo mecanismo do
botão "Redefinir senha", usado aqui só pra restaurar o estado de teste). Pra testar "Redefinir
senha"/"Excluir" — que só aparecem pra quem é administrador — o usuário autorizou marcar
temporariamente `usuarios_app.dono = true` no "Teste 1" (revertido pra `false` ao final); com esse
acesso, criei um usuário descartável "Teste Delete", cliquei "Redefinir senha" nele (confirmado por
login bem-sucedido com `123456` logo em seguida) e depois "Excluir" com confirmação inline
(confirmado por query direta: zero linhas em `usuarios_app` e `auth.users` retornando "User not
found" pro mesmo id — cascade funcionou sem nenhuma linha órfã). Estado final do banco conferido
idêntico ao inicial (dono/ativo/modo de Túlio Vilar, Teste 1 e Teste 2 sem alteração líquida).

## Mapa de distribuição do rebanho por pasto (Painel + Rebanho por pasto) + edição de contorno por vértice

Pedido do usuário depois de ver um mockup revisado em várias rodadas (ícones reais de Nelore, cores
extraídas dos PNGs, mapeamento categoria→ícone confirmado, escala de tamanho ajustada por
legibilidade em vez de proporção anatômica estrita). Três entregas: mapa com ícones no Painel, o
mesmo mapa + métricas novas em "Rebanho por pasto", e edição de contorno vértice a vértice em Gestão
de Áreas (antes só dava pra "desenhar de novo e substituir").

**Ícones reais**: os 7 PNGs (fundo transparente, silhueta realista) ficam em
`public/icones-categoria/` (`touro.png`, `vaca.png`, `boi.png`, `garrote.png`, `novilha.png`,
`bezerro.png`, `bezerra.png`) — vieram de uma pasta local do usuário, copiados uma vez, sem processo
de geração (diferente dos ícones do PWA, que foram rasterizados de um SVG). `lib/categoria-icones.ts`
centraliza o mapeamento:

- **Por papel** (a maioria das categorias): `Bezerras Mamando`→bezerra, `Bezerros Mamando`→bezerro,
  `Novilhas`→novilha (todas as eras, inclusive `Novilha Descarte`), `Touros`→touro,
  `Matrizes em Reprodução`/`Matrizes Descarte`→vaca.
- **`Garrotes e Bois`** é o único papel que muda de ícone internamente: garrote quando a era é
  `08-12`/`12-24`, boi quando é `24-36`/`36+` — é a mesma linhagem (macho castrado), só que "Boi" é a
  categoria adulta dela, sem nenhuma relação com "Touro" (que é um papel próprio, reprodutor).
- **`Outros`** (sexo livre, sem ícone dedicado) cai num fallback só por sexo + era, ignorando o papel
  (que nesse caso não diz nada sozinho): `00-08`→bezerro/bezerra, `08-12`/`12-24`→garrote/novilha,
  `24-36`/`36+`→boi/vaca. Touro fica de fora desse fallback de propósito — só quem está de fato no
  papel `Touros` vira ícone de touro.

`TIER_SIZE_PX` (adulto 40px, jovem 37px, bezerro 33px) foi ajustado várias vezes com o usuário — a
diferença entre os três acabou bem mais sutil do que uma proporção anatômica real sugeriria (uma
proporção estrita por altura de cernelha deixava jovem/bezerro pequenos demais pra reconhecer a
forma num marcador de mapa), decisão explícita de legibilidade sobre fidelidade.

**`components/fazendas/MapaDistribuicaoRebanho.tsx`**: componente novo, somente leitura (sem
`onDesenhado`, diferente de `MapaPastos.tsx`) — satélite Esri, contorno de fazenda(s) tracejado,
polígonos de pasto coloridos (clicáveis, com `<Tooltip>` nativo do react-leaflet), e um `<Marker>`
por categoria presente em cada pasto usando `L.icon` com o PNG real. Posição de cada ícone dentro do
pasto é calculada sem nenhuma lib nova: centróide = média aritmética dos vértices do anel externo do
polígono (não é o centróide de área verdadeiro, só uma aproximação suficiente pra um pasto pequeno),
e quando há mais de uma categoria elas se distribuem num pequeno anel ao redor do centróide
(`raioIcones` = 16% da menor dimensão do bounding box), com uma correção simples de `cos(latitude)`
pra compensar a distorção de longitude em latitudes distantes do equador. `<Tooltip>` em cada ícone
mostra a categoria em destaque + quantidade + peso médio no hover, sem precisar de tooltip customizado
com mouse-tracking.

**`lib/distribuicao-pasto.ts`**: função pura `montarDistribuicaoPorPasto(linhas, pastosBase,
categoriasInfo)` que agrupa o retorno cru de `fn_relatorio_rebanho_por_pasto` (mesma função já usada
pelo relatório) por pasto e por ícone — duas categorias do sistema que caem no mesmo ícone (ex.:
Garrote 08-12 e Garrote 12-24) somam quantidade e recalculam peso médio ponderado no mesmo marcador,
em vez de duplicar ícone. Reaproveitada pelas duas telas (Painel e Rebanho por pasto) sem duplicar a
lógica de agrupamento — só a busca dos dados (`pastosBase`/`categoriasInfo`/linhas) é feita
separadamente em cada página, seguindo o padrão já estabelecido (ex.: "Lotação atual por pasto" em
Relatório de Lotação já buscava pastos+`fn_relatorio_rebanho_por_pasto` por fazenda do mesmo jeito).

**Painel** (`app/page.tsx`): seção nova "Mapa do rebanho por pasto", condicional a
`configuracoes.controla_pasto` (mesmo princípio de todo o resto do controle por pasto — sem isso só
existe o pasto "Geral", que também pode ter contorno e aparecer no mapa, mas a seção não teria
propósito). Busca `pastos` (com `geometria`/`area_ha`/`cor`) + `categorias_animal` (papel/sexo/era) +
`fazendas.geometria` das fazendas selecionadas + `fn_relatorio_rebanho_por_pasto` uma vez por fazenda
selecionada (fotografia de **hoje**, igual ao resto do Painel, não do período filtrado — a mesma
distinção já documentada pra "Lotação atual" vs. os gráficos do período). Painel de detalhe ao lado
do mapa (`DetalhePastoDistribuicao`) mostra área útil/rebanho/lotação + lista de categorias com ícone,
nome, peso médio e quantidade — clicar num pasto ou ícone do mapa seleciona o pasto que aparece nesse
painel; sem seleção, mostra o primeiro pasto com contorno.

**Rebanho por pasto** (`app/relatorio-rebanho-por-pasto/page.tsx`): o mesmo mapa aparece acima da
tabela (só quando algum pasto tem contorno — `temPastoComContorno`), reaproveitando exatamente os
mesmos `linhas` que a tabela já usa (sem chamada adicional ao banco pro mapa). Cada card de pasto no
`rowSpan` da coluna "Pasto" ganhou três linhas novas abaixo da quantidade — peso médio (ponderado,
mesmo cálculo que já existia pro total geral, agora também por pasto), área e lotação (UA/ha,
`(peso vivo total / 450) / área_ha`) — tanto na tabela (`md:` acima) quanto nos cards (mobile).
Clicar numa linha de pasto na tabela ou no mapa sincroniza a seleção nos dois sentidos
(`pastoSelecionadoMapaId`), com destaque `bg-brand-100` na linha correspondente.

**Edição de contorno por vértice** (`components/fazendas/MapaPastos.tsx`): descoberta de
implementação — o `leaflet-draw` já anexa um `editing` (`L.Edit.Poly`) a **qualquer** `L.Polygon`
assim que o pacote é importado, sem precisar do `FeatureGroup`/toolbar completo que a limitação
anterior (documentada na Fase 1 do mapa) tentava evitar. Um componente novo,
`EdicaoVerticesPasto`, monta o pasto em edição como um `L.Polygon` **imperativo** (via `L.geoJSON(...).getLayers()[0]`,
fora do fluxo declarativo de `<GeoJSON>`) e chama `layer.editing.enable()` — isso sozinho já dá os
vértices arrastáveis nativos do Leaflet, sem tocar em nenhum outro pasto. O pasto em edição
(`pastoEmEdicaoId`, prop nova) é excluído da lista de `<GeoJSON>` declarativas enquanto dura a
edição, e a ferramenta de "desenhar novo pasto" (`ControleDesenho`) some da toolbar nesse período —
as duas formas de alterar geometria nunca ficam disponíveis ao mesmo tempo.

`MapaPastos` virou um `forwardRef` (`MapaPastosHandle` exportado) — `obterGeometriaEditada()` lê a
camada em edição (guardada num ref compartilhado, `layerEmEdicaoRef`, passado pro componente filho) e
devolve `{ geometria, areaHa }` já recalculado via `calcularAreaHa` (mesma função de sempre, de
`lib/kml.ts`), sem o componente precisar saber nada de Supabase — mantém o princípio já documentado
de "componente burro" (Fase 1 do mapa). `GestaoAreasPanel.tsx` ganha o estado (`pastoEmEdicaoId`,
`salvandoEdicaoVertices`) e os botões: um ícone de lápis ("Editar contorno") por pasto na lista, só
habilitado se o pasto tiver `geometria` e nenhum outro pasto já estiver em edição; ao clicar, o
mesmo card de detalhe que já mostrava "Área: X ha" abaixo do mapa vira um card de edição
(`Salvar contorno`/`Cancelar`), reaproveitando a mesma posição na tela. Salvar chama
`obterGeometriaEditada()` via ref e faz um `update` simples em `pastos` (mesmo formato de
`geometria`/`area_ha` já usado no fluxo de "substituir pasto existente" via desenho) — a
reconciliação de área (`fn_validar_area_pasto`) roda igual, sem nenhuma exceção pro caminho de
edição por vértice.

Verificado no navegador (`FAZENDA TESTE`, pasto "Piquete 1"): Painel mostrando o mapa com os números
reais de hoje (924 cabeças totais, pasto "Piquete 1" com 33 cabeças/3 categorias batendo com o banco);
"Rebanho por pasto" com o mesmo mapa e as 3 métricas novas por pasto (peso médio/área/lotação
conferidos manualmente pela fórmula); ícones carregando de verdade (`naturalWidth: 2000`,
`complete: true`) nos dois lugares. Edição de vértice: entrar em modo de edição escondeu a
ferramenta "Desenhar polígono" e mostrou 30 marcadores `leaflet-editing-icon` (vértices + pontos
médios) arrastáveis sobre o contorno real; "Salvar contorno" gravou a geometria de volta no banco
(área recalculada bateu com o valor original, 0,76 ha, confirmando o round-trip
Leaflet→GeoJSON→`calcularAreaHa`→Supabase sem perda de precisão); "Cancelar" saiu do modo de edição
sem gravar nada. Arrastar um vértice de verdade via clique-e-arraste não foi possível simular neste
ambiente de teste automatizado (a ferramenta de screenshot não funciona sem o painel de preview
visível), mas o mecanismo de drag em si é código nativo do `leaflet-draw`, não deste projeto — só a
leitura/gravação ao salvar (código novo) foi validada ponta a ponta.

## Proprietário do lote de gado (migração 044)

Em algumas fazendas mais de um proprietário tem animais na mesma fazenda (parceria, arrendamento,
sociedade entre parentes) — diferente do proprietário da terra (`fazendas.proprietario_id`, singular,
cadastral, já existente desde a Fase A/C da reorganização de Fazendas). Implementado como mais uma
dimensão ortogonal do ledger de movimentações, seguindo exatamente o mesmo molde já usado duas vezes
antes (pasto, safra de nascimento): coluna própria em `movimentacoes_rebanho`, saldo por
`fn_saldo_categoria_proprietario(fazenda, categoria, proprietario, data)`, trajetória de edição/
exclusão própria (`fn_delta_para_par_proprietario`/`fn_checar_saldo_proprietario_futuro`, mesma
receita de `fn_delta_para_par_lote`/`fn_checar_saldo_lote_futuro`), e checagem de saldo insuficiente
própria dentro de `fn_validar_saldo_categoria` — defesa em profundidade, mesmo princípio já usado pra
pasto e lote de nascimento.

**Decisões fechadas com o usuário antes de implementar** (discutidas como opinião técnica primeiro,
sem implementar até confirmação explícita — pedido do usuário: "me dê sua opinião técnica sincera sem
implementar nada ainda"):
- **Não cruza com pasto** — o gado de um proprietário pode se misturar no mesmo pasto de outro, mesmo
  princípio já usado pra não cruzar pasto×safra (complexidade desproporcional sem necessidade real de
  negócio confirmada).
- **Precisa alimentar separação financeira**, não é só etiqueta informativa — mas isso já cai de graça
  na arquitetura existente: o lançamento em lote já é linha-a-linha (categoria+quantidade+peso+preço
  por linha, com desconto/acréscimo já rateado por linha), então `proprietario_id` como mais um campo
  por linha (igual `safraNascimento` já é hoje) já resolve o valor por proprietário sem nenhuma lógica
  nova de rateio.
- **Totalmente opcional** (nullable, sem exigência condicional como safra tem pra bezerro) — a maioria
  das fazendas continua com 0 ou 1 proprietário vinculado, então o campo nunca aparece pra elas.
- **Filtro nos relatórios, sem aba "Resumo por Proprietário" dedicada** — o usuário avaliou que
  filtrar já cobre "o que esse proprietário fez no período" (caso de uso mais comum); comparação lado
  a lado entre proprietários fica coberta por deixar Proprietário como coluna visível nas listagens
  (não por uma tela nova).

**`fazenda_proprietarios`** (fazenda_id, pessoa_id): quais pessoas (papel PROPRIETARIO) podem ser
atribuídas como dono de um lote de gado numa fazenda específica — separado do
`fazendas.proprietario_id` singular. Gerenciado direto no formulário de Cadastrar/Editar Fazenda
(`CadastrarFazendaModal.tsx`), como uma seção nova "Proprietários do gado nesta fazenda" logo abaixo
do campo Proprietário (dono da terra) — checkboxes sobre a mesma lista de pessoas com papel
PROPRIETARIO já carregada pro seletor de dono da terra, sem chamada nova ao banco. **Se o usuário não
marcar nada, o dono da terra vira o único proprietário de gado por padrão** (`proprietariosFinal =
proprietariosGadoIds.size > 0 ? [...proprietariosGadoIds] : [proprietarioId]`) — decisão deliberada
pra que uma fazenda com um dono só (a maioria) não exija nenhum passo extra: o seletor de proprietário
no lançamento simplesmente não aparece (só aparece com 2+ vinculados). Salvar sincroniza a lista
inteira por "apaga e reinsere" (mesmo princípio já usado em `pessoa_papeis`/`movimentacao_ajustes`).

**`movimentacoes_rebanho.proprietario_id`** (nullable, referencia `pessoas`): campo por linha no
lançamento em lote (`LinhaCategoria.proprietarioId`, ao lado de `safraNascimento`) e campo próprio no
formulário de edição avulsa (`proprietarioId` singular, mesmo padrão de `safraNascimento` singular já
usado pra editar uma movimentação fora de um grupo). Seletor (`<select>` com "Sem proprietário
atribuído" + a lista de `fazenda_proprietarios` da fazenda envolvida) só aparece quando
`proprietariosDisponiveis.length > 1` (mesma fazenda de origem usada pro pasto — `fazendaOrigemParaPasto`,
reaproveitada sem duplicar lógica) — mesma regra de visibilidade condicional já usada pra pasto/safra.
**Fica de fora, de propósito**: Mudança de Categoria (não participa do saldo por proprietário — mesmo
tratamento que já tinha pra safra) e Desmame (estrutura própria, `LinhaDesmame`, sem esse campo nesta
rodada — decisão de escopo, não limitação técnica). `fn_validar_proprietario_pertence_fazenda`
(trigger, mesmo princípio de `fn_validar_pasto_pertence_fazenda`) garante que o proprietário
selecionado está de fato vinculado à fazenda do lançamento antes de aceitar o insert/update.

**Exibição**: `detalhesMovimentacao()` em `app/movimentacoes/page.tsx` acrescenta `propriet.: Nome`
no fim da linha de detalhe (mesmo lugar onde safra/pasto já aparecem) — cobre tanto o card avulso
quanto cada linha dentro de um card agrupado, sem duplicar lógica de exibição.

**Filtro global sincronizado**: `FiltroGlobalContext` ganha `proprietarios`/`proprietarioIds`/
`alternarProprietario`, seguindo o mesmo padrão já usado pra fazenda/período — mas com semântica
diferente de fazenda: `proprietarioIds` vazio significa **"todos" (sem filtro)**, não "nenhum",
porque proprietário é sempre opcional numa movimentação (a maioria não tem nenhum atribuído) e
esconder esses lançamentos por padrão seria o comportamento errado. `proprietarios` é a união dos
proprietários vinculados às fazendas atualmente selecionadas (`fazendaProprietarios` cru, cruzado com
`fazendaIds` via `useMemo`), recalculada reativamente; uma seleção que deixa de existir (ex.: usuário
desmarca a fazenda cujo proprietário estava selecionado) é podada automaticamente. O filtro só
aparece na UI quando há 2+ proprietários no conjunto selecionado.

**Onde o filtro foi aplicado — e onde não foi, por decisão técnica**:
- **Relatórios de Movimentações** (`app/relatorios/page.tsx`): filtro direto (`.in('proprietario_id',
  proprietarioIds)` quando não vazio) — a query já busca linhas cruas de `movimentacoes_rebanho`, sem
  RPC agregada, então o filtro é imediato.
- **Resumo de Movimentação de Rebanho** e a seção "Movimentações do período" do **Painel**: as duas
  telas consomem a mesma RPC, `fn_relatorio_movimentacao_rebanho`, que ganhou um parâmetro novo
  opcional `p_proprietario_ids uuid[] default null` (precisou de `drop function` antes do `create`,
  já que mudou de assinatura — mesmo princípio já usado quando `fn_saldo_categoria_safra_mes` virou
  `fn_saldo_categoria_safra` na migração 031). Quando o filtro está ativo, `estoque_inicial`/
  `estoque_final` somam `fn_saldo_categoria_proprietario` sobre o produto cartesiano fazendas×
  proprietários selecionados (em vez de `fn_saldo_categoria` por fazenda inteira), e cada
  entrada/saída por tipo ganha `and (p_proprietario_ids is null or m.proprietario_id =
  any(p_proprietario_ids))`.
- **Relatório de Lotação**: **deliberadamente fora do filtro** — lotação cruza rebanho com área
  (`(peso vivo / 450) / área em Pecuária`), e área não tem dimensão de proprietário nenhuma; filtrar
  o rebanho por um dono só enquanto a área continua sendo a da fazenda inteira produziria um número
  de lotação matematicamente enganoso (numerador de um proprietário, denominador de todos). Mesmo
  raciocínio vale pros KPIs "Distribuição atual do rebanho"/"Lotação atual" do Painel (usam
  `fn_resumo_rebanho_atual`, fotografia de hoje sem período) — não filtrados por proprietário; só a
  seção "Movimentações do período" do Painel (que já é period-based e não mistura com área) recebeu o
  filtro.

**Gap encontrado e corrigido durante o teste**: `fn_validar_delete_pessoa` (já existente desde a Fase
B/C) checava `movimentacoes_rebanho.cliente_fornecedor_id` e `fazendas.proprietario_id`, mas não as
duas referências novas (`movimentacoes_rebanho.proprietario_id`, `fazenda_proprietarios.pessoa_id`) —
sem o ajuste, excluir uma pessoa vinculada como proprietário de gado bateria numa violação de FK crua
em vez da mensagem amigável já usada pros outros vínculos. Corrigido na mesma migração 044, mesmo
princípio de "inative-a em vez disso" já usado em todo o resto do sistema.

**Segundo gap, encontrado depois do deploy**: o "dono da terra vira o único proprietário de gado por
padrão" só roda no submit do formulário de Fazenda — fazendas que já existiam antes da migração 044 e
não foram reabertas/salvas desde então ficaram com `fazenda_proprietarios` **vazia**, nem o dono da
terra vinculado. Como o seletor exige 2+, isso não quebrava nada visivelmente (0 e 1 se comportam
igual — seletor escondido), mas deixava a lista "Proprietários do gado nesta fazenda" com nenhum
nome marcado, inconsistente com o que o usuário via no cadastro. Corrigido com um backfill idempotente
(popula `fazenda_proprietarios` com `fazendas.proprietario_id` pra toda fazenda ainda sem nenhum
vínculo, sem sobrescrever quem já tinha algo configurado manualmente) — incluído tanto no arquivo da
migração 044 (pra quem rodar do zero) quanto no addendum enviado separadamente pra quem já tinha
rodado a versão original.

Verificado no navegador (`FAZENDA TESTE`): vincular um segundo proprietário de gado a uma fazenda de
teste ("Sócio Teste", criado via "+ Novo" no cadastro de fazenda) fez o seletor de proprietário
aparecer no lançamento — confirmado que fica escondido com só 1 vinculado (comportamento padrão de
qualquer fazenda) e aparece com 2+; lançar um Nascimento atribuído a "Sócio Teste" mostrou
`propriet.: Sócio Teste` na listagem; editar essa movimentação confirmou o valor pré-selecionado
corretamente no formulário avulso; o filtro em Relatórios de Movimentações (raw query) reduziu "Total
nascido" de 13 para 1 ao marcar só "Sócio Teste"; o mesmo filtro persistido via `localStorage`
reduziu "Movimentações do período" pra `+1 Nascimentos` tanto no Resumo de Movimentação quanto no
Painel (RPC compartilhada funcionando nos dois lugares), enquanto os KPIs de hoje do Painel (Total de
cabeças, Lotação atual) permaneceram no valor cheio, sem filtro, confirmando a decisão de escopo.
Dados de teste totalmente revertidos ao final: proprietário do lote limpo da movimentação de teste,
vínculo em `fazenda_proprietarios` removido, `fazendas.proprietario_id` restaurado pro dono original
("Túlio" — alterado sem querer durante o teste, já que criar um proprietário novo via "+ Novo"
auto-seleciona ele no campo de dono da terra também), e a pessoa "Sócio Teste" excluída.

## Cascata Módulo → Pasto nos formulários de lançamento

Antes, os 4 formulários que lançam num pasto (`app/movimentacoes/page.tsx`,
`app/controle-pasto/page.tsx`, `app/pesagens/page.tsx`, `components/fazendas/SaldoInicialPanel.tsx`)
listavam **todos** os pastos da fazenda inteira num seletor só, sem passar pelo módulo — em fazendas
com muitos pastos espalhados por vários módulos, essa lista ficava longa e sem organização, difícil
de achar o pasto certo. Adicionada uma camada intermediária de seleção: **módulo → pasto**, mesmo
princípio de cascata de dois níveis já usado nos outros pares do sistema (tipo de uso → subtipo de
uso, fazenda → pasto original) — o pasto agora é sempre filtrado pelo módulo escolhido, não mais pela
fazenda inteira de uma vez.

`modulos` passa a ser carregada como consulta própria (`supabase.from('modulos').select('id,
fazenda_id, nome, ativo, ordem')`) nos 4 arquivos, igual ao padrão que `GestaoAreasPanel.tsx` já usava
— um módulo pode existir sem nenhum pasto, então não dá pra derivar a lista de módulos só a partir dos
pastos já carregados. Cada arquivo tem seu próprio `type Modulo` local (mesmo padrão de duplicação
deliberada já usado pra `type Pasto` nesses arquivos — sem hook compartilhado, cada tela é dona da sua
cópia).

**Mesma regra de "some sozinho" já usada pro pasto se aplica ao módulo**: o seletor de módulo só
aparece quando a fazenda tem 2+ módulos ativos (`mostrarSeletorModulo`/`mostrarSeletorModuloOrigem`/
`mostrarSeletorModuloDestino`, conforme o arquivo) — com um módulo só, ele é preenchido sozinho sem UI
(mesmo módulo "Geral" auto-criado de sempre). O seletor de pasto, por sua vez, passa a ser filtrado
pelo módulo escolhido (`pastos.filter(p => p.modulo_id === moduloId)`) em vez da fazenda inteira, e
continua com a mesma regra de "some sozinho com 1 pasto só" que já tinha — só que agora dentro do
módulo, não da fazenda. Trocar de módulo sempre invalida o pasto escolhido (reseta pra vazio,
recalculado pela cascata).

**Onde a cascata é dupla (dois pares módulo→pasto independentes)**: `TRANSFERENCIA` em Movimentações
(módulo/pasto de origem e módulo/pasto de destino podem estar em fazendas — e módulos — diferentes) e
o lançamento inteiro de Mudança de Pasto em `controle-pasto/page.tsx` (origem e destino sempre na
mesma fazenda, mas podem estar em módulos diferentes — é inclusive o caso mais comum de uso dessa
tela). Os dois pares são independentes: escolher o módulo de origem não afeta as opções do módulo de
destino, e vice-versa.

**Pesagens** só usa a cascata no modo "Por pasto" (o modo "Por categoria" nunca lida com pasto
diretamente — grava em todos os pastos onde a categoria tem saldo, sem seletor de pasto nenhum). Nesse
arquivo, diferente dos outros três, o pasto sempre foi um seletor obrigatório sem a regra de "some
sozinho" (mesmo com só 1 pasto no módulo, o campo continua aparecendo) — só o módulo ganhou a regra de
auto-esconder com 1 módulo só, mantendo a exigência de escolha explícita do pasto como já era antes.

**`SaldoInicialPanel.tsx` tem uma corrida de carregamento que os outros 3 não têm**: `carregarLinhas`
(que define o `pastoId` a partir da linha `SALDO_INICIAL` já existente) roda em paralelo com o efeito
de montagem que carrega `pastos`/`módulos`/`configuracoes`, ambos disparados já na primeira
renderização — diferente dos outros 3 arquivos, onde reabrir uma edição (`iniciarEdicao`) só acontece
bem depois da montagem, por clique explícito do usuário, quando `pastos` já com certeza carregou.
Por causa dessa corrida, derivar o módulo a partir do pasto salvo direto dentro de `carregarLinhas`
(`pastos.find(...)`) seria frágil — poderia rodar antes de `pastos` estar populado. Resolvido com um
efeito reativo separado (`useEffect(() => {...}, [pastoId, pastos])`) que deriva `moduloId` sempre que
`pastoId` ou `pastos` mudarem, convergindo pro valor certo em qualquer ordem de carregamento. Os
outros 3 arquivos resolvem o módulo direto no momento de reabrir a edição
(`pastos.find(p => p.id === m.pasto_id)?.modulo_id`), sem precisar desse efeito extra, porque não têm
o mesmo risco de corrida.

Payload de submit não muda em nenhum dos 4 arquivos — módulo é só um filtro de UI pra achar o pasto
mais rápido, nunca persistido em `movimentacoes_rebanho`/`movimentacoes_area`. Verificado no navegador
com `FAZENDA TESTE` (2 módulos reais, "Vilar" e "Sítio Túlio", com pastos diferentes em cada um): nos
4 arquivos, trocar de módulo mudou a lista de pastos corretamente (módulos diferentes mostrando
conjuntos de pasto diferentes, sem vazamento entre eles); em Movimentações, reabrir a edição de um
lançamento existente (Venda Abate) restaurou módulo e pasto corretos automaticamente; em Controle de
Pasto, os seletores de módulo origem/destino funcionaram de forma independente (origem em "Vilar",
destino em "Sítio Túlio", cada um com sua própria lista de pastos); em Pesagens, o modo "Por pasto"
mostrou módulo depois pasto corretamente escopados; na aba "Saldo Inicial" de Fazendas, o módulo e
pasto já salvos foram restaurados certos ao abrir a fazenda (confirmando que o efeito reativo resolve
a corrida de carregamento), e trocar de módulo recalculou a lista de pasto e limpou a seleção
corretamente.

## Proprietário do lote de gado vira lista global (migração 045)

Uso real revelou dois problemas com o vínculo por fazenda da migração 044: (1) fazendas cadastradas
antes da migração ficavam com `fazenda_proprietarios` vazia até serem reabertas/salvas, então o
seletor não aparecia em nenhum lançamento até um passo manual de configuração; e (2) mais fundamental
— **o usuário observou que o gado de um proprietário pode ser transferido de uma fazenda para
outra**, então amarrar "quais proprietários valem nesta fazenda" cria fricção justamente no caso mais
comum (Transferência), sem nenhum ganho real, já que `fn_saldo_categoria_proprietario` (mantida sem
alteração) sempre rastreou o saldo por fazenda+categoria+proprietário independente de qualquer vínculo
prévio — o vínculo só existia pra filtrar a lista do seletor, não pro cálculo de saldo em si.

Decisão: **proprietário vira uma lista global**, igual o cadastro de dono da terra já funcionava —
qualquer pessoa com papel PROPRIETARIO (Pessoas e Empresas) fica selecionável em qualquer lançamento,
em qualquer fazenda, sem nenhum passo de vínculo antes. Reverteu por completo a Fase 1:

- **Removidos** (migração 045): tabela `fazenda_proprietarios`, trigger/função
  `fn_validar_proprietario_pertence_fazenda` (não faz mais sentido checar "pertence à fazenda"),
  função `fn_proprietarios_disponiveis_fazenda`, e a checagem de `fazenda_proprietarios` dentro de
  `fn_validar_delete_pessoa` (a checagem de `movimentacoes_rebanho.proprietario_id` continua).
- **Removida** a seção "Proprietários do gado nesta fazenda" do cadastro de Fazenda
  (`CadastrarFazendaModal.tsx`) — o formulário volta a ser exatamente como antes da migração 044,
  com um único campo de Proprietário (dono da terra).
- **`app/movimentacoes/page.tsx`**: `proprietarios` passa a ser buscado direto de `pessoa_papeis`
  filtrado por papel PROPRIETARIO (mesma query que o cadastro de Fazenda já usa pro dono da terra),
  sem nenhum filtro por fazenda. `mostrarSeletorProprietario` vira `proprietarios.length > 1` —
  contagem global, não mais por fazenda. O efeito de limpeza que resetava a seleção ao trocar de
  fazenda foi removido inteiramente: como proprietário não depende mais de fazenda, uma seleção feita
  numa linha continua válida se a fazenda do lançamento mudar.
- **`FiltroGlobalContext.tsx`**: mesmo princípio — `proprietarios` vem de uma busca única e global no
  mount do provider (paralela à busca de `fazendas`), sem cruzar com `fazendaIds` selecionado. A
  poda de seleções inválidas continua existindo, mas agora só reage a mudanças na lista global em si
  (ex.: proprietário excluído do sistema), não a troca de fazenda.

Verificado no navegador: com dois proprietários reais já cadastrados (Carlos Cesar Pereira - Tinho e
Túlio, sem nenhum vínculo por fazenda configurado), o seletor apareceu imediatamente em Compra pra
**FAZENDA SÃO JOSÉ** — a mesma fazenda que na migração 044 tinha ficado com `fazenda_proprietarios`
vazia e teria bloqueado esse mesmo lançamento com "O proprietário selecionado não está vinculado a
essa fazenda." Lançar essa Compra com proprietário atribuído funcionou sem nenhum erro (a trigger
antiga que bloqueava isso não existe mais), apareceu corretamente na listagem, e o filtro em
Relatórios de Movimentações mostrou os dois proprietários globalmente, sem depender de qual fazenda
estava selecionada no filtro. Nota de processo: um erro de compilação real apareceu no meio da edição
(`proprietarios` declarado duas vezes em `FiltroGlobalContext.tsx`, de um passo intermediário onde a
`useMemo` antiga e o novo `useState` coexistiam) — confirmado como real (não estático/obsoleto) só
depois de reproduzir numa aba nova do navegador, e corrigido antes de prosseguir. Movimentação de
teste revertida (proprietário limpo) ao final.

## Redesign de Lançamento de Movimentações (duas colunas, Novo Lançamento colapsável, excluir)

`app/movimentacoes/page.tsx` foi redesenhado do zero na camada de apresentação — **toda a lógica de
estado, efeitos e handlers foi preservada verbatim** (saldo por fazenda/pasto, cascata módulo→pasto,
lote de nascimento por safra, proprietário, desconto/acréscimo rateado, lançamento em lote com
`grupo_lancamento_id`, edição com checagem de trajetória) — só o JSX de retorno mudou. Motivação do
usuário: a tela antiga desperdiçava espaço (coluna única estreita, categorias empilhadas em cartões
repetidos) e não dava nenhuma visão do efetivo da fazenda nem do total antes de salvar. Um mockup
interativo (HTML solto, iterado em várias rodadas com o usuário — cores por direção, ícones,
listagem restilizada) foi aprovado antes da implementação real.

**Layout em duas colunas** (`lg:grid-cols-[minmax(0,1fr)_360px]`): à esquerda, o formulário em 4
blocos numerados (`StepBadge`) — 1) Tipo de movimentação, 2) Quando e onde, 3) Categorias e
quantidades, 4) Detalhes adicionais; à direita, um painel fixo (`sticky top-6`) com "Resumo em tempo
real" (tipo/ícone, data, fazenda, total de animais, peso total) e "Efetivo da fazenda" (antes/depois
do lançamento).

**Ícone + cor por direção**: cada um dos 9 `TipoMovimentacao` tem um `Direcao` (`entrada`/`saida`/
`interno`) fixo em `DIRECAO_TIPO` — Nascimento/Compra = entrada (`brand-100`/`brand-500`); Venda em
Pé/Venda Abate/Morte/Consumo-Doação = saída (`warning-bg`/`warning` — **nunca `error`**, mesmo
princípio já documentado em `FluxoRebanho`: saída não é "ruim", é o propósito comercial do rebanho);
Desmame/Mudança de Categoria/Transferência = interno/reclassificação (`bg`/`text-secondary`, nenhum
dos três muda o total de cabeças do grupo). O seletor de tipo (passo 1) agrupa os 9 botões em 3
seções visuais por essa mesma direção. `IconeMovimentacao` é um componente novo com um `<svg>`
traço próprio por tipo (mesmo padrão de `lib/nav-icons.tsx` — `viewBox 24`, `strokeWidth 1.75`,
`fill none`) — não reaproveita nem embute PNG algum; os ícones do mockup (símbolos do usuário,
recoloridos via `mask-image`) só existiram no protótipo HTML descartável, nunca no código real.

**Categorias em tabela** (passo 3, só quando `isLoteCategoria`): substituiu os cartões empilhados por
linha por uma `<table>` de verdade — colunas condicionais (peso morto/rendimento só em Venda Abate,
preço só quando `isComPreco`, safra/lote e proprietário só quando aplicável), com peso total por
linha sempre calculado e visível, e um hint discreto "N disp." abaixo da quantidade quando há saldo
carregado (pedido explícito do usuário: "mostrar a quantidade disponível depois de selecionar a
categoria, de forma discreta"). Fora do modo lote, o formulário de categoria única ganhou o mesmo
hint de saldo (por fazenda e por pasto) diretamente abaixo do campo Quantidade.

**Atalhos de data**: botões "Hoje"/"Ontem" abaixo do campo de data (`definirDataAtalho`, só chama
`setData` com a data calculada — não há lógica nova de validação).

**Efetivo da fazenda**: `fn_resumo_rebanho_atual({ p_fazenda_ids: [fazendaOrigemParaPasto] })` (mesma
RPC já usada no Painel) é buscada num `useEffect` novo sempre que a fazenda em contexto muda, e a
soma de `quantidade` vira o hint "Efetivo atual: N cabeças" ao lado do seletor de fazenda e o valor
"Antes" no resumo lateral. "Depois" é `efetivoFazenda + sinal × totalCabecasFormulario`, onde o sinal
é `+1` pra entrada, `-1` pra saída ou Transferência (sai da fazenda mostrada, que é sempre a origem),
e `0` pra Desmame/Mudança de Categoria (reclassificação interna, não muda o total da fazenda) — é só
uma prévia informativa, nunca participa de validação real de saldo (isso continua sendo
`fn_saldo_categoria`/`fn_saldo_categoria_pasto`, checado como sempre no `handleSubmit`).

**Listagem redesenhada**: os cards de "Últimos lançamentos" (avulsos e agrupados) ganharam ícone por
direção, tokens do design system e a mesma barra de filtros de antes, só reestilizada — nenhuma
mudança de comportamento de busca/filtro.

### "+ Novo Lançamento" — formulário começa fechado

Pedido do usuário depois de ver o redesign: "acima dos filtros de Últimos lançamentos, deve haver um
botão em destaque de Novo Lançamento e, só após clicar nele, abre a parte de preenchimento". Estado
novo, `formularioAberto` (default `false`) — enquanto fechado, a tela mostra só um botão em destaque
(`border-dashed border-brand-500 bg-brand-100/40`, ícone "+" circular) acima da listagem; ao clicar,
abre o grid de formulário+resumo com um cabeçalho "Novo lançamento" (ou "Editar lançamento", quando
`editandoId`/`editandoGrupoId` está setado) e um link "Fechar". `iniciarEdicao`/`iniciarEdicaoGrupo`/
`iniciarEdicaoDesmame` (chamadas pelos botões "Editar" da listagem) setam `formularioAberto = true`,
então clicar em "Editar" sempre abre o formulário automaticamente, mesmo que estivesse fechado.
`handleFecharFormulario` (botão "Fechar", e também o botão "Cancelar edição" já existente dentro do
formulário) decide entre `cancelarEdicao()` (se havia uma edição em andamento — desfaz e recolhe) ou
só `limparFormulario()` + recolher (lançamento novo abandonado) — sem duplicar lógica de limpeza.

### Excluir lançamento

Pedido do usuário: além de editar, precisa dar pra excluir um lançamento já salvo, "porém com as
condições já definidas, não deixar o saldo de qualquer categoria ficar negativo em nenhum momento".
Essa regra **já existia no banco antes desta mudança** — `trg_validar_delete_movimentacao` (trigger
`before delete on movimentacoes_rebanho`, ver `fn_validar_delete_movimentacao` no schema) chama
`fn_checar_edicao_movimentacao(..., p_quantidade: 0)` (delta zero simula a remoção do efeito da
linha) e bloqueia com exceção se o saldo por pasto ficaria negativo em qualquer data futura, e o
mesmo princípio se repete pra saldo por lote de nascimento (`fn_checar_saldo_lote_futuro`) e por
proprietário (`fn_checar_saldo_proprietario_futuro`) quando esses campos estão preenchidos na linha.
Por isso o frontend não duplica nenhuma dessas contas — `excluirMovimentacao(id)`/`excluirGrupo(rows)`
só tentam o `delete` (linha única ou `.in('id', ids)` pro grupo inteiro) e repassam a mensagem de erro
do banco se a trigger bloquear, mesmo princípio já usado pra excluir fazenda/pasto/módulo/pessoa.

Confirmação é **inline**, nunca `window.confirm()` (mesmo padrão de sempre no app): o botão "Excluir"
ao lado de "Editar" em cada card da listagem (avulso ou agrupado) vira "Excluir este lançamento?" /
"Excluir as N linhas?" com "Sim, excluir"/"Cancelar", controlado por `confirmarExclusaoMovId`/
`confirmarExclusaoGrupoId`. Se o lançamento excluído era o que estava sendo editado no formulário
aberto, `excluirMovimentacao`/`excluirGrupo` chamam `cancelarEdicao()` pra não deixar o formulário
apontando pra um registro que não existe mais.

Verificado no navegador: type-check limpo (`npx tsc --noEmit`); tela abre com o formulário fechado e
só o botão "+ Novo Lançamento" visível acima da listagem; clicar nele abre os 4 blocos + resumo
lateral; "Fechar" recolhe de volta; clicar em "Editar" num lançamento existente abre o formulário
automaticamente com o cabeçalho "Editar lançamento"; clicar em "Excluir" troca os botões da linha
pela confirmação inline "Excluir este lançamento? / Sim, excluir / Cancelar", e "Cancelar" descarta
sem chamar o banco (o caminho de exclusão em si não foi exercido contra dados reais nesta verificação,
já que dependia de escolher uma linha de teste descartável — a garantia de não deixar saldo negativo
vem da trigger já existente e testada em migrações anteriores, não de lógica nova no frontend).

### Revisão pós-uso: ícones trocados, coluna lateral removida, formulário em largura total

Dois ajustes pedidos pelo usuário depois de usar a tela redesenhada na prática:

**Ícones corrigidos**: `IconeMovimentacao` tinha dois desenhos que não batiam com o conjunto de
símbolos já aprovado antes da implementação (ver "Símbolos que você desenhou" na história do mockup)
— Consumo/Doação estava saindo como uma caixa de presente (laço + fita), não o garfo+faca esperado;
Mudança de Categoria estava usando um ícone de ciclo/atualização quase idêntico ao de Transferência
(as duas viravam "setas circulares" indistinguíveis num relance). Corrigidos pra garfo+faca (dois
talheres lado a lado, silhueta clássica de "consumo/restaurante") e barras ascendentes (3 barras de
altura crescente + linha de base, remetendo a "evolução de categoria"), respectivamente — agora os 9
ícones têm silhuetas claramente distintas entre si.

**Coluna lateral "Resumo em tempo real" removida**: o usuário observou, com razão, que ela só repetia
informação já visível no próprio formulário (tipo, data, fazenda) sem agregar nada novo — e reservar
360px pra essa coluna espremia a tabela de categorias do passo 3 a ponto de precisar de rolagem
horizontal mesmo com poucas colunas. `app/movimentacoes/page.tsx` teve o grid de duas colunas
(`lg:grid-cols-[minmax(0,1fr)_360px]`) trocado por uma única coluna de largura total — o `<form>`
sozinho, sem `<div className="sticky top-6">` ao lado. O bloco "Efetivo da fazenda" (antes/depois),
que era a única informação daquela coluna que não duplicava nada, não foi descartado: virou um hint
compacto (`renderEfetivoHint()`, função auxiliar reaproveitada nos dois seletores de fazenda —
comum e o de origem em Transferência) logo abaixo do `<select>` de fazenda no passo 2 — mostra
"Efetivo atual: N cabeças" sempre, e acrescenta "→ M após salvar" só quando já há alguma quantidade
preenchida no formulário (evita um "N → N" vazio antes do usuário digitar qualquer coisa). Variáveis
que só existiam pra alimentar a coluna removida (`totalPesoFormulario`, `DIRECAO_LABEL`) foram
removidas junto — sem sobrar código morto.

Verificado no navegador: type-check limpo; com a fazenda "FAZENDA TESTE" selecionada em Compra, o
hint mostrou "Efetivo atual: 327 cabeças" corretamente posicionado; medição via `getBoundingClientRect`
confirmou que o wrapper `overflow-x-auto` da tabela de categorias não tem mais rolagem horizontal em
viewport 1280px (`scrollWidth === clientWidth`, tabela ocupando 901px, contra os ~700px que sobravam
antes com a coluna lateral presente).

### Segunda rodada pós-uso: cálculo automático dos 4 preços, colunas mais largas, Safra/Lote condicional, proprietário no passo 2

Quatro ajustes pedidos depois de um teste real de lançamento em lote (Compra, 40 cabeças, R$/@):

**Cálculo automático dos 4 campos de preço equivalentes**: o formulário de categoria única já
mostrava os outros 3 valores calculados assim que um campo de preço era preenchido
(`valoresCalculados`), mas a tabela de lote (passo 3) só mostrava "Bruto: R$ X" — faltava o mesmo
auto-cálculo por linha. Nova função `calcularValoresLinha(linha)` espelha exatamente a mesma conta
de `valoresCalculados`, mas a partir do `valorTotal` já calculado por `calcularLinha(linha)` — cada
linha da tabela agora mostra os 3 campos que **não** foram digitados (`CAMPOS_PRECO.filter(c => c.key
!== linha.campoPreco)`), num texto compacto abaixo do input de valor.

**Rótulos curtos no `<select>` de campo de preço da tabela**: o rótulo completo ("Valor por arroba
(R$/@)") cortava dentro da coluna estreita da tabela. `CAMPOS_PRECO_CURTO` (novo, ao lado de
`CAMPOS_PRECO`) mapeia os mesmos 4 `CampoPreco` pra rótulos de 1-2 palavras (`R$/@`, `R$/cab.`,
`R$/kg`, `R$ total`) — usado só nesse `<select>` compacto e nos labels dos valores calculados; o
formulário de categoria única continua com os rótulos completos nos radio buttons (mais espaço
disponível ali).

**Colunas Preço e Proprietário mais largas**: `min-w-[170px]` → `min-w-[240px]` (Preço, agora
precisa caber o `<select>` de 96px + input + os 3 valores calculados embaixo) e `min-w-[140px]` →
`min-w-[180px]` (Proprietário, pra não cortar nomes como "Carlos Cesar Pereira - Tinho").

**Coluna Safra/Lote vira condicional**: antes aparecia sempre em qualquer tipo com lote, mostrando
"—" em toda linha cuja categoria não fosse bezerro (ex.: Compra de Novilha). Confirmado com o
usuário que isso só faz sentido pra bezerro — `mostrarColunaSafra` (novo derived value: `isNascimento
|| linhas.some(l => categoriaEhBezerro(...))`) esconde a coluna inteira (cabeçalho e células) quando
nenhuma linha atual envolve bezerro, reavaliado a cada mudança de categoria nas linhas — mesmo
princípio já usado pras colunas de peso morto/rendimento (`isVendaAbate`) e preço (`isComPreco`), que
também são condicionais ao tipo/conteúdo em vez de sempre visíveis com "—".

**Proprietário sobe pro passo 2, só no formulário de categoria única**: avaliado como pergunta de
design antes de implementar — mover o campo pra junto da fazenda faria sentido só quando há uma
única categoria no lançamento (nesse caso o campo já é, na prática, do lançamento inteiro); na
tabela de lote ele continua por linha, decisão de arquitetura já documentada acima ("Proprietário do
lote de gado") que permite atribuir categorias diferentes do mesmo lançamento a donos diferentes
(ex.: vender garrotes do Tulio e novilhas do Carlos pro mesmo comprador no mesmo dia) — mover pra um
campo único no passo 2 quebraria esse caso de uso já testado. Na prática, como todo tipo de
`TIPOS_COM_LOTE` abre em modo lote por padrão pra lançamento novo, esse campo no passo 2 só aparece
ao **editar** um lançamento avulso já existente (`editandoId` setado, `isLoteCategoria === false`) —
o bloco antigo (dentro do passo 3, logo depois do seletor de safra) foi removido e um novo bloco
(condicionado também a `!isLoteCategoria`) foi inserido no passo 2, logo abaixo do grid de
fazenda(s).

Verificado no navegador: type-check limpo; lançamento de teste (Compra, Novilha, 40 cab., 220 kg,
R$/@ 2.500) mostrou "R$/cab.: 18.333,33 · R$/kg: 83,33 · R$ total: 733.333,33" automaticamente
abaixo do campo de valor (conferido manualmente: 40×220=8.800 kg → 8.800/30=293,33@ → 2.500×293,33=
733.333,33 — bate); medição via `getBoundingClientRect` confirmou coluna Preço em 309px e
Proprietário em 180px (ambas maiores que antes), sem rolagem horizontal (901px de tabela, viewport
1280px); coluna Safra/Lote ausente do cabeçalho nesse mesmo teste (Novilha não é bezerro) e presente
ao trocar pro tipo Nascimento; abrir a edição de uma Compra avulsa existente mostrou "Proprietário do
lote" corretamente posicionado no passo 2, logo abaixo do hint "Efetivo atual: 600 cabeças → 601
após salvar". Edição de teste fechada sem salvar ao final.

### Terceira rodada: campo de valor quase invisível, passo 1 colapsável, tipo escolhido fica sticky

**Campo de valor da tabela de lote quase invisível**: bug real encontrado pelo usuário —
`w-24 flex-none` (largura fixa pretendida pro `<select>` de tipo de preço) foi combinado com
`inputSmClass`, que já embute `w-full`. Duas classes de largura no mesmo elemento é um conflito
Tailwind clássico: o navegador aplicou `w-full` (não o `w-24` pretendido), o select tomou quase toda
a largura da coluna, e o campo de valor ao lado ficou espremido a poucos pixels. Corrigido
empilhando select e input (cada um em largura cheia da coluna, um embaixo do outro) em vez de lado a
lado — elimina o conflito de raiz e, como bônus, sobra espaço pro rótulo completo do select (voltou
a usar `c.label` em vez de `CAMPOS_PRECO_CURTO`, que continua usado só nos valores calculados
abaixo). Verificado via `getBoundingClientRect`: campo de valor foi de alguns pixels pra 224px de
largura (igual ao select, coluna de 240px).

**Passo 1 (tipo) colapsa depois de escolhido**: pedido do usuário — a grade de 9 botões (com seções
Entradas/Saídas/Reclassificação) ocupava um espaço vertical grande de forma permanente pra uma
escolha única. Estado novo, `tipoConfirmado` (default `false`) — enquanto a grade completa fica
visível, escolher um tipo (`onClick` de cada botão) chama `setTipo(t)` **e** `setTipoConfirmado(true)`
juntos, colapsando o passo 1 numa barra compacta de uma linha (ícone + nome do tipo + link "Trocar",
que volta `tipoConfirmado` pra `false` e reabre a grade). `iniciarEdicao`/`iniciarEdicaoGrupo`/
`iniciarEdicaoDesmame` também setam `tipoConfirmado = true` — reabrir a edição de um lançamento já
existente mostra a barra colapsada direto (o tipo já é conhecido, não precisa forçar reescolha).
`limparFormulario()` reseta pra `false` — um lançamento novo sempre começa com a grade aberta, já
que o tipo default (`NASCIMENTO`, primeiro da lista) nunca foi uma escolha consciente do usuário.

**Barra colapsada fica `sticky` ao rolar**: pedido de acompanhamento — "o tipo escolhido deve
aparecer fixo mesmo rolando pra baixo". A própria barra colapsada (não um elemento duplicado) ganha
`sticky top-14 md:top-0 z-20` — no mobile, `top-14` (56px) gruda logo abaixo da topbar fixa do app
(medida em 45px de altura via `getBoundingClientRect`, sobra ~11px de respiro, sem sobreposição); no
desktop, sem topbar (só a sidebar lateral), `top-0` gruda no topo absoluto. Mostra só ícone + nome do
tipo (cor de fundo já comunica a direção, sem precisar repetir "Entrada/Saída/Interno" por extenso)
— decisão deliberada de não recriar o "Resumo em tempo real" removido na rodada anterior por
duplicar dado; aqui é só uma informação nova (contexto de tipo) que não aparece em nenhum outro
lugar da tela uma vez que o passo 1 colapsa.

Verificado no navegador: type-check limpo; campo de valor confirmado em 224px (era poucos pixels);
"Novo Lançamento" → grade completa aberta por padrão; clicar em "Compra" colapsa pra barra "Compra /
Trocar" com o passo 2 aparecendo logo abaixo; rolar a página com `window.scrollTo` confirmou a barra
saindo de `top: 168px` pra `top: 0px` (grudada) no desktop; em viewport mobile (375×812), a barra
grudou em `top: 56px` sem sobrepor a topbar fixa (`bottom: 45px`); "Trocar" reabre a grade completa
corretamente. Formulário fechado sem salvar ao final.

**Mesmo bug de largura na coluna "Peso morto / Rend." de Venda Abate**: os dois inputs (peso morto e
rendimento) dividiam uma coluna de `w-40` (160px fixos) lado a lado, sobrando ~76px cada — pouco pra
mostrar o placeholder inteiro ("Morto"/"Rend. %" apareciam cortados, tipo "Mc"/"Re"). Mesmo tratamento
já aplicado à coluna Preço: os dois inputs passam a ficar empilhados (`space-y-1`, cada um em largura
cheia da coluna) em vez de lado a lado, e a coluna virou `min-w-[150px]` (era `w-40` fixo). Placeholders
também ficaram mais descritivos agora que sobra espaço: "Peso morto (kg)" e "Rendimento (%)" (antes
"Morto"/"Rend. %", abreviados por causa do espaço apertado). Verificado no navegador: os dois inputs
medem 134px de largura cada (eram ~76px), com os placeholders completos visíveis.

### Resolução definitiva: tabela vira card por categoria (passo 3)

As três correções anteriores (Preço, depois Peso morto/Rend.) eram um sintoma do mesmo problema
estrutural: cada campo extra que um tipo específico exige (Venda Abate sozinho soma 8 colunas —
categoria, qtd., peso, peso morto, rendimento, tipo de preço, valor, safra, proprietário, peso
total) precisa competir por espaço horizontal dentro de uma `<table>`, e corrigir uma coluna só
empurra o aperto pra outra (confirmado pelo usuário via print: alargar Preço/Peso-morto-Rend.
deixou Qtd./Peso médio espremidos de novo, com rolagem horizontal reaparecendo). Pedido do usuário:
"sugira uma resolução definitiva… se precisar, coloque os campos em mais linhas, deixando espaço
com folga para cada campo" — e que a correção valesse pra **todos** os tipos de lançamento em lote,
não só Venda Abate.

`app/movimentacoes/page.tsx`, dentro do branch `isLoteCategoria`, trocou a `<table>` inteira por
**um card por categoria** (`rounded-control border border-border p-3`, mesmo padrão visual já usado
pelas linhas de Desmame — `<span>Linha {i+1}</span>` + botão "Remover" no cabeçalho do card). Dentro
de cada card, os campos ficam numa grade responsiva (`grid grid-cols-2 sm:grid-cols-3
lg:grid-cols-4 gap-3`, Categoria com `col-span-2`) em vez de colunas de tabela fixas — cada campo
sempre ocupa uma célula de grade que tem largura de sobra (confirmado via `getBoundingClientRect`:
270px por campo em desktop 1280px, 124px em mobile 375px, contra os 76-134px que a tabela dava nas
colunas mais cheias), porque o número de campos por linha se ajusta sozinho ao número de colunas do
grid em vez de todos brigarem pela largura total da tabela de uma vez. Cada campo ganha seu próprio
`<label>` (`labelCardClass`, novo — mesma função de `labelClass` já usado no resto do formulário, só
menor pra caber várias linhas empilhadas de campos por card) com `<Required/>` quando aplicável — a
tabela antiga não tinha labels próprios, só o cabeçalho da coluna, então isso também deixou o
formulário mais claro (cada campo dentro do card agora se explica sozinho, sem precisar olhar pro
topo da tabela pra saber o que é).

Os "sub-cálculos" que antes apareciam dentro de cada célula da tabela (peso em @/animal, valor
bruto, os 3 valores de preço equivalentes) viraram uma linha de resumo só, no rodapé de cada card
(`border-t border-border pt-2`, texto pequeno, `flex flex-wrap` — quebra linha sozinho se precisar),
reunindo Peso total + @/animal (Venda Abate) + os campos de preço não escolhidos, tudo num só lugar
em vez de espalhado dentro de cada campo. `calcularValoresLinha`/`CAMPOS_PRECO_CURTO` (criados na
correção anterior) continuam servindo essa linha de resumo sem mudança.

Verificado no navegador (desktop 1280px e mobile 375px, tipos Venda Abate e Compra): todos os
campos de cada card medidos via `getBoundingClientRect` — Venda Abate (8 campos) com 270px cada em
desktop e 124px em mobile, sem nenhum campo abaixo de 120px em nenhuma tela; Compra (6 campos,
sem peso morto/rendimento) com a mesma largura confortável de 270px em desktop; nenhuma rolagem
horizontal em nenhum dos dois casos. Um problema de ambiente foi descoberto durante o teste (não
relacionado ao código): a viewport do navegador de teste ficou em `0×0` depois de um preset
"desktop" mal aplicado, dando leituras de largura sem sentido (18px em todo campo) até ser
redefinida explicitamente pra 1280×800 — vale registrar como pegadinha de metodologia de teste, não
como bug do app.

## Multi-tenant — Fase 1 (migração 046): `conta_id` + RLS reativado

Primeiro passo de uma reestruturação maior pra levar o ORION Agro ao mercado como produto
multi-tenant (várias contas de clientes pagantes, não mais um grupo só) — decisão e desenho
arquitetural completo documentados em memória de projeto (`project_multi_tenant_saas`). Esta fase é
só a fundação: criar o conceito de conta e isolar os dados por conta. Ainda não existem tabelas de
módulo/plano/limite (Fase 2) nem tela de Suporte (Fase 4) — essas dependem desta base.

**`contas`** (id, nome, ativo, created_at) é o tenant. `conta_id` foi adicionado em toda tabela
operacional do sistema — `fazendas`, `configuracoes`, `usuarios_app`/`usuario_modulos`,
`categorias_animal`, `pessoas`/`pessoa_papeis`, `centros_custo`/`subcentros_custo`,
`subtipos_uso_area`, `movimentacoes_area`, `modulos`, `pastos`, `movimentacoes_rebanho`, `pesagens`,
`itens_ajuste_financeiro`, `movimentacao_ajustes`, `lancamentos_financeiros`, `regras_rateio` (18
tabelas) — com os dados existentes migrados pra uma "Conta Principal" única. Catálogos
verdadeiramente globais do domínio (`grupos_categoria`, `grupos_categoria_papel`, `tipos_uso_area`)
continuam **sem** `conta_id`, compartilhados entre todas as contas — nunca customizados por cliente,
diferente de `categorias_animal`/`subtipos_uso_area` (que já eram parcialmente customizáveis por
fazenda antes desta migração, e agora ficam isoladas por conta também).

**Decisão de sequenciamento importante, diferente do esboço inicial da conversa**: RLS (Row Level
Security, originalmente cogitado como uma Fase 3 separada) entrou junto com esta Fase 1, não depois.
Motivo: sem RLS, cada uma das dezenas de queries do app precisaria ganhar um `.eq('conta_id', ...)`
manual — grande superfície pra esquecer um lugar, e um bug de filtro só na aplicação vira vazamento
de dado entre clientes pagantes assim que existir mais de uma conta real. Com RLS ligado usando uma
coluna `conta_id` com **valor padrão automático** (`default fn_conta_atual()`), o banco resolve
sozinho tanto a escrita (nova linha herda a conta do usuário logado, sem o app precisar informar)
quanto a leitura (usuário só enxerga linhas da própria conta) — nenhuma das ~30 funções/triggers já
existentes precisou mudar (nenhuma usa `security definer`, então todas já respeitavam RLS
automaticamente, rodando como SECURITY INVOKER) e **nenhuma tela do app precisou de código novo**.

**`fn_conta_atual()`** (`security definer`, `set search_path = public`, `stable`) resolve
`conta_id` a partir de `usuarios_app` pelo `auth.uid()` da sessão. `security definer` é necessário
pra evitar recursão: a própria policy de `usuarios_app` também chama essa função, e sem
`security definer` a consulta interna a `usuarios_app` disparia a própria RLS de novo, num ciclo —
a função bypassa RLS só nessa consulta interna específica, nunca expõe dado além da conta do próprio
usuário que está chamando. Cada tabela ganhou uma única policy (`for all using (conta_id =
fn_conta_atual()) with check (conta_id = fn_conta_atual())`); `contas` usa a variação `id =
fn_conta_atual()` (compara contra o próprio id da linha, não uma coluna `conta_id`).

**Exceção — os 2 Route Handlers com cliente admin/service-role**: `app/api/usuarios/route.ts` e
`app/api/usuarios/[id]/route.ts` usam `createAdminClient()` (chave `service_role`) pra gerenciar
login via Admin API — esse cliente bypassa RLS de propósito, e por bypassar RLS também não se
beneficia do `default fn_conta_atual()` (não há `auth.uid()` por trás de uma conexão service-role).
`exigirDono()` nos dois arquivos passou a retornar também `contaId` (lido de `usuarios_app.conta_id`
via o cliente de sessão normal, antes de trocar pro cliente admin), repassado explicitamente em todo
insert de `usuarios_app`/`usuario_modulos` feito por esses dois arquivos — únicos 2 pontos do
código que precisaram de ajuste nesta migração inteira.

**`usuarios_app.conta_id` é nullable** (diferente de toda outra tabela, que é `not null`) — usuário
de Suporte (equipe interna do fornecedor, coluna nova `usuarios_app.suporte boolean`, ainda sem
nenhuma tela/comportamento) não pertence a nenhuma conta de cliente. Só a coluna por enquanto: o
seletor de conta e a policy de bypass pra `suporte = true` são Fase 4, ainda não implementada.

**Restrições únicas corrigidas pra "por conta" em vez de globais**: `fazendas.nome` era único
globalmente (`uq_fazendas_conta_nome unique (conta_id, nome)` agora); `configuracoes` tinha um
índice único sobre uma expressão constante forçando **uma linha no sistema inteiro**
(`uq_configuracoes_singleton`) — agora é uma linha por conta (`uq_configuracoes_conta unique
(conta_id)`), auto-criada pra toda conta nova por `fn_criar_configuracoes_conta` (trigger `after
insert on contas`, mesmo princípio já usado pro módulo/pasto "Geral" de toda fazenda nova via
`fn_criar_modulo_pasto_geral`).

**Dificuldades reais no backfill** (migração rodada 3 vezes no Supabase até passar limpa — as duas
primeiras tentativas fizeram rollback completo, confirmado via `select count(*) from contas;`
retornando "relation does not exist" depois de cada uma):
1. Um `UPDATE` em massa preenchendo `conta_id` em cada linha existente re-dispara os gatilhos de
   negócio (ex.: "informe a safra de nascimento do lote de bezerros envolvido") mesmo só mudando uma
   coluna sem relação nenhuma com essas regras — alguns lançamentos legados não passavam nessas
   validações se re-checados hoje. Corrigido com `alter table X disable trigger user` /
   `enable trigger user` ao redor de cada backfill (desliga só os gatilhos de negócio definidos pelo
   usuário, não os gatilhos internos de integridade referencial do Postgres).
2. `ck_peso_medio_obrigatorio` (CHECK constraint, não gatilho — `disable trigger` não a afeta) foi
   adicionada `NOT VALID` na migração 028 de propósito, pra não validar retroativamente 2
   lançamentos legados sem peso médio; o `UPDATE` em massa a re-dispara em cada linha tocada.
   Corrigida descartando e recriando a constraint exatamente como estava (`NOT VALID`) só ao redor
   do backfill de `movimentacoes_rebanho` — comportamento final idêntico ao de antes da migração.

Nenhuma das duas exigiu recorrer à sugestão (rejeitada) de limpar movimentações de rebanho pra
contornar o erro — as duas têm causa raiz estrutural (gatilho/constraint disparando de novo num
UPDATE em massa) resolvida sem tocar em nenhum dado real.

Verificado ponta a ponta no navegador depois da migração rodar limpa: Painel carregando com dados
reais (leitura via RLS funcionando transparentemente pra sessão autenticada), listagem de
Movimentações carregando, e um ciclo completo de escrita — criar um lançamento de Nascimento real
pela UI, confirmar que apareceu na listagem (com safra auto-sugerida correta), e excluí-lo de volta
— confirmando que tanto o `default fn_conta_atual()` quanto o `with check` de INSERT/UPDATE/DELETE
da policy funcionam corretamente, e que os triggers de negócio já existentes (cálculo de peso total,
sugestão de safra) continuam disparando normalmente sob RLS. Dados de teste revertidos ao final.

`orion_agro_schema.sql` sincronizado com a migração inteira (`contas` logo no topo do arquivo,
`conta_id` dobrado em cada `CREATE TABLE` relevante, `fn_conta_atual()`/RLS definidos logo após
`usuarios_app`, seeds de categoria/subtipo do fim do arquivo ajustados pra referenciar a conta única
que o próprio arquivo já semeia). Diferente da migração real (que precisou da dança de
disable-trigger/backfill/enable-trigger por rodar contra dados já existentes), o schema consolidado
representa uma instalação nova do zero — sem dado legado pra reconciliar, então `conta_id` entra
direto como `not null` já na própria `CREATE TABLE`, sem nenhuma ginástica de ALTER TABLE.

## Multi-tenant — Fase 2 (migração 047): módulos e limites vendidos avulsos por conta

Segundo passo do roadmap multi-tenant (ver Fase 1 acima) — introduz o mecanismo de venda de módulo
individual, confirmado com o usuário: "a ideia inicial é vender cada módulo individualmente
(rebanho, multifazendas, controle por pasto, financeiro, agrícola, clima, máquinas...)". Nesta
rodada, dois recursos concretos usam o mecanismo — Multifazendas e Multiproprietário —, ambos
sugeridos pelo próprio usuário durante a conversa como exemplos do que precisa ser opcional/pago.

**`conta_modulos`** (conta_id, modulo, ativo) é a **fonte da verdade** de quais módulos uma conta
contratou — não uma tabela de planos fixos, cada módulo liga/desliga independente (decisão já
registrada em `project_multi_tenant_saas`, "planos" ficam como atalho de marketing opcional, ainda
não implementado por não ter uso real hoje). **`conta_limites`** (conta_id, tipo_limite, valor) é
genérica pra limites numéricos que não são "tela que aparece/some" — hoje cobre `'fazendas'`
(Multifazendas) e `'proprietarios'` (Multiproprietário), mas o desenho comporta qualquer limite
futuro (ex.: nº de usuários) sem migração de schema nova. **Ausência de linha em `conta_limites` pra
um tipo = sem limite (ilimitado)** — decisão deliberada pra não exigir seed nenhum pra contas com uso
irrestrito; é por isso que a "Conta Principal" não ganha nenhuma linha em `conta_limites` nesta
migração, só em `conta_modulos` (grandfather clause com todos os 10 módulos do catálogo atual
liberados, senão a interseção módulo-da-conta ∩ módulo-do-usuário daria vazio e o usuário atual
perderia acesso ao sistema inteiro no mesmo instante em que a migração rodasse).

**Permissão final de módulo** (`contexts/AuthContext.tsx`, `podeAcessar`) passa a exigir
`modulosDaConta.has(modulo) && (isDono || modulosPermitidos.has(modulo))` — antes era só
`isDono || modulosPermitidos.has(modulo)`. Mudança importante: **mesmo o dono da conta não vê um
módulo que a própria conta não contratou** — dono continua bypassando só a checagem de
`usuario_modulos` (é dono *dentro* da conta), nunca a de `conta_modulos` (o que a conta *comprou*).
`modulosDaConta` é carregado em paralelo com `usuarios_app`/`usuario_modulos` no mesmo
`carregarDadosApp`, via `supabase.from('conta_modulos').select('modulo').eq('ativo', true)` — sob
RLS, isso já retorna só as linhas da conta do usuário logado, sem filtro explícito de `conta_id` no
código (mesmo padrão "o banco resolve sozinho" já estabelecido na Fase 1). Resetado junto com
`modulosPermitidos` nos dois pontos onde este já era limpo (usuário inativado, logout).

**Multifazendas e Multiproprietário reaproveitam o mesmo mecanismo genérico** —
`lib/conta-limites.ts` exporta `excedeuLimiteConta(supabase, tipoLimite, contagemAtual)`: busca a
linha de `conta_limites` pro tipo (nenhuma linha = `false`, nunca bloqueia) e compara
`contagemAtual >= valor`. Dois pontos de checagem:
- **Fazenda** (`components/fazendas/CadastrarFazendaModal.tsx`, `handleSubmit`): só ao **criar**
  fazenda nova (nunca ao editar) — conta as fazendas existentes (`count` de `fazendas`) e bloqueia
  com `alert()` antes do insert se o limite `'fazendas'` já foi atingido.
- **Proprietário**: dois pontos criam pessoa com papel PROPRIETARIO — o "+ Novo" inline dentro do
  cadastro de fazenda (`handleCriarProprietario`, sempre atribui PROPRIETARIO) e o checkbox de papéis
  em `components/pessoas/CadastrarPessoaModal.tsx` (`handleSubmit`). Neste último, a checagem só roda
  quando PROPRIETARIO está sendo **adicionado agora** — `papeis.includes('PROPRIETARIO') &&
  !papeisOriginais.includes('PROPRIETARIO')` (novo estado `papeisOriginais`, capturado ao carregar a
  pessoa pra editar) — editar uma pessoa que já tinha esse papel não é barrado de novo pelo mesmo
  limite. Escolha deliberada de reaproveitar o mesmo mecanismo do limite de fazenda em vez de um gate
  de tela novo: o seletor de proprietário em Movimentações já só aparece com 2+ proprietários
  cadastrados (`proprietarios.length > 1`, ver "Proprietário do lote de gado vira lista global"
  acima) — travar o limite em 1 já desativa a funcionalidade inteira sem precisar de nenhuma UI nova.

Verificado no navegador: Painel e todos os 10 links da Sidebar carregando normalmente pro usuário
atual (confirma que o seed de `conta_modulos` da "Conta Principal" preservou o acesso de sempre, sem
regressão); criação de uma fazenda de teste completa (com proprietário existente) através do
formulário real, confirmando que o novo `excedeuLimiteConta` executa sem erro e não bloqueia
indevidamente quando não há linha em `conta_limites` (caminho "ilimitado"); exclusão da fazenda de
teste ao final, sem sobra de dado. O caminho de **bloqueio de fato** (conta que já atingiu o limite)
não foi exercido ao vivo nesta verificação — exigiria inserir uma linha temporária em `conta_limites`
via acesso direto ao banco; a lógica em si é uma comparação numérica simples (`contagemAtual >=
valor`), já coberta pelo type-check.

`orion_agro_schema.sql` sincronizado: `conta_modulos`/`conta_limites` inseridas logo depois de
`usuario_modulos` (mesma vizinhança temática — módulo/permissão), com o mesmo seed de
`conta_modulos` pra "Conta Principal" replicado do arquivo de migração.

## Multi-tenant — Fase 4: home dedicada de Suporte (bloqueio total fora de uma conta)

Reorganização da tela de Suporte (a Fase 4 original, migração 048, já tinha criado o papel
`usuarios_app.suporte` com uma página `/suporte` simples de "escolher conta e entrar") — motivada
pelo uso real: o usuário é ao mesmo tempo dono da própria Conta Principal (sua fazenda de verdade) e
suporte da equipe interna, e percebeu que a tela inicial (`/`, Painel) continuava mostrando os dados
da Conta Principal por padrão, mesmo sem ter clicado "Entrar" em nenhuma conta pelo seletor de
Suporte — o `podeAcessar` de então caía no fallback de `isDono`/`modulosDaConta` da própria conta
mesmo fora do modo suporte. Confirmado explicitamente com o usuário (via pergunta direta): o bloqueio
deve ser total, **mesmo pra própria Conta Principal** — os dois chapéus (dono de fazenda, suporte da
equipe) exigem o mesmo gesto explícito de "Entrar" antes de qualquer dado de conta aparecer, sem
exceção.

**`contexts/AuthContext.tsx`, `podeAcessar`** ganha uma trava checada antes de tudo: se
`usuarioApp.suporte === true` e `emModoSuporte === false` (não entrou em nenhuma conta ainda),
retorna `false` pra **qualquer** módulo, sem cair no fallback de `isDono`/`modulosDaConta` — nem
pra própria conta do usuário. Com `emModoSuporte === true` (já entrou nalguma conta), continua `true`
pra tudo, como antes.

**Tela inicial vira uma home própria de Suporte, não mais uma rota separada `/suporte`** — usa
exatamente o mesmo precedente de bifurcação já usado pro Modo Campo (`app/page.tsx`,
`PainelPage`/`PainelDashboard`, decidido **antes** de qualquer hook de busca de dado do dashboard
rodar, pra não disparar query nenhuma de conta à toa):
```
if (!loadingAuth && usuarioApp?.suporte && !emModoSuporte) return <SuporteHome />
if (!loadingAuth && usuarioApp?.modo === 'CAMPO') return <InicioCampo />
return <PainelDashboard />
```
`components/suporte/SuporteHome.tsx` (novo) é o conteúdo que antes vivia em `app/suporte/page.tsx`
(removido, junto da rota `/suporte` — redundante agora que `/` já mostra a mesma coisa) —
reestruturado com abas (mesmo padrão visual de botão de aba já usado em `app/relatorios/page.tsx`),
hoje só com uma aba real, **"Contas"**: lista todas as `contas` com botão "Entrar" (`entrarNaConta`,
já existia) por linha, e um **toggle inline Ativar/Inativar** novo (`contas.ativo`, coluna que já
existia sem UI nenhuma até agora) — mesmo padrão de toggle inline já usado em módulo/pasto/pessoa/
fazenda, sem confirmação (ação reversível, sem nenhum efeito de bloqueio de login hoje — é só um
sinalizador de controle administrativo). O array de abas (`const ABAS = [{ id: 'contas', label:
'Contas' }]`) já está pronto pra crescer quando indicadores técnicos por conta forem implementados
(explicitamente fora do escopo desta rodada, conversa futura).

**`components/suporte/SuporteShell.tsx`** (novo) — layout de navegação alternativo pro estado
suporte-em-casa, escolhido em `components/AppShell.tsx`/`LayoutPorModo` (mesmo padrão de bifurcação
de 3 ramos: suporte-em-casa → `SuporteShell`, Modo Campo → `ModoCampoShell`, senão → `Sidebar`
normal, nessa ordem de prioridade). Barra superior simples (mesmo estilo do topo de
`ModoCampoShell.tsx`: marca + nome do usuário + botão Alterar senha + botão Sair, reaproveitando
`AlterarSenhaModal`/`ICONS.senha`/`ICONS.sair`) — sem sidebar, sem grupo de módulo nenhum, porque não
há módulo pra navegar nesse estado. `components/Sidebar.tsx` perdeu o link "Suporte"/grupo "Equipe
interna" que a Fase 4 original tinha adicionado — redundante agora: suporte-em-casa não vê a Sidebar
(vê o `SuporteShell`), e suporte-dentro-de-uma-conta já tem o `SuporteBanner` com "Sair" no topo.

**Consistência de gate em `/usuarios`**: o gate dessa página é próprio (`isDono`, não passa por
`ModuloGate`/`podeAcessar` porque "Usuários" não é um módulo liberável) — sem ajuste, ficaria
inconsistente com a trava nova (dono/suporte gerenciaria os funcionários da própria Conta Principal
mesmo suporte-em-casa). `podeGerenciar = isDono && !(usuarioApp?.suporte && !emModoSuporte)`
substitui as 4 checagens que usavam `isDono` puro, com uma mensagem de "Acesso restrito" própria pra
esse caso ("Entre em uma conta pela tela de Suporte pra gerenciar os usuários dela"). Mesmo
princípio em `components/ModuloGate.tsx`: quando `podeAcessar` barra por causa dessa trava
específica (não por falta de módulo comprado/liberado), a mensagem muda de "Fale com o administrador
do sistema" (sem sentido pro próprio administrador) pra "Entre em uma conta pela tela de Suporte pra
acessar este módulo".

**Banner de suporte (`components/SuporteBanner.tsx`) vira sticky** — reportado pelo usuário depois de
ver o banner "Você está vendo [Conta] como Suporte" rolar junto com o conteúdo da página em vez de
ficar fixo. O componente ganhou um prop `className`, deixando cada shell decidir o `sticky top-*`
certo pra sua própria topbar (a barra superior de cada layout tem altura/presença diferente):
`Sidebar` só tem topbar no mobile (`md:hidden`), então o banner ali usa `sticky top-14 md:top-0`
(gruda logo abaixo da topbar de 56px no mobile, no topo absoluto no desktop, que não tem topbar
nenhuma); `ModoCampoShell` tem topbar fixa em **qualquer** tamanho de tela, então o banner ali usa só
`sticky top-14`, sem variante desktop. Verificado via `getBoundingClientRect` nos dois breakpoints:
desktop com a página rolada 800px manteve o banner em `top: 0`; mobile (375×812) manteve o banner em
`top: 56px`, sem sobrepor a topbar da Sidebar (que termina em `bottom: 45px`, ~11px de folga).

Verificado no navegador de ponta a ponta (usuário suporte + dono da Conta Principal): `/` mostra a
home de Suporte (aba Contas, "Conta Principal" com Entrar/Inativar) sem nenhum dado de fazenda;
digitar `/fazendas` ou `/usuarios` direto na URL sem ter entrado em conta nenhuma mostra "Acesso
restrito" com a mensagem nova, inclusive pra Conta Principal; clicar "Entrar" mostra o Painel normal
+ Sidebar completa + banner sticky no topo; "Sair" no banner volta pra home de Suporte sem dado
nenhum; toggle Ativar/Inativar numa conta real (Conta Principal, revertido ao final — a coluna não
bloqueia login nem tem nenhum outro efeito hoje, então o teste foi seguro) mudou o badge e o texto do
botão corretamente e reverteu limpo.

## Multi-tenant — Fase 4 (migração 048): papel de Suporte

Terceiro passo implementado do roadmap multi-tenant (Fase 3 — RLS — já tinha sido absorvida na Fase
1; ver memória `project_multi_tenant_saas`). Dá pra equipe interna do fornecedor acessar/gerenciar a
conta de qualquer cliente pra dar suporte técnico, via **seletor de conta** (escolhe uma conta numa
lista e passa a navegar o app normal com os dados dela) — não personificação de usuário específico,
não painel administrativo separado. Decisão confirmada com o usuário antes de implementar: o
primeiro usuário de suporte é a própria conta que já existia (dono da "Conta Principal"), não um
login separado — ele continua sendo dono normal da própria conta, e ganha a opção extra de "entrar"
em qualquer outra conta.

**`suporte_conta_ativa`** (usuario_id PK, conta_id) guarda em qual conta um usuário de suporte está
navegando agora — "entrar" faz upsert, "sair" apaga a linha. Preferida a uma variável de sessão do
Postgres porque o Supabase usa pool de conexões — uma session var não sobreviveria de forma confiável
entre requisições. RLS restringe cada usuário a só ver/alterar a própria linha
(`usuario_id = auth.uid()`); uma trigger (`fn_validar_suporte_conta_ativa`) é defesa em profundidade
garantindo que só `usuarios_app.suporte = true` pode ganhar uma linha aqui, mesmo que a policy de RLS
sozinha só garanta "é o próprio usuário".

**`fn_conta_atual()` ganhou um fallback** (era só `select conta_id from usuarios_app where id =
auth.uid()`): agora checa `suporte_conta_ativa` primeiro (só vale pra quem é suporte) e cai pro
`conta_id` próprio se não houver linha ativa lá. Cobre os 3 casos sem nenhuma bifurcação de código no
resto do sistema — usuário comum sempre usa o próprio `conta_id`; suporte "em casa" (sem entrar em
nenhuma conta) se comporta exatamente como um usuário comum; suporte navegando numa conta de cliente
usa a conta selecionada. Como **toda** tabela do sistema já usa `conta_id = fn_conta_atual()` na sua
policy de RLS (Fase 1), essa única mudança faz **cada query do app inteiro** (Painel, Movimentações,
Fazendas, etc.) passar a mostrar os dados da conta selecionada automaticamente — nenhuma tela
precisou de código novo pra respeitar o modo suporte.

**`suporte_auditoria`** é um log append-only (usuario_id, conta_id, acao ENTROU/SAIU, created_at),
populado só por uma trigger (`fn_registrar_auditoria_suporte`, `security definer`) em cima de
`insert/update/delete` em `suporte_conta_ativa` — nunca por código do app diretamente, e sem nenhuma
policy de RLS permissiva pra ninguém autenticado ler/escrever direto (só a trigger, que bypassa RLS
com `security definer`, consegue inserir).

**RLS em `contas` ganhou uma policy adicional de SELECT** (`contas_visivel_suporte`, soma via OR com
a policy original) liberando qualquer usuário `suporte = true` ver **todas** as contas — necessário
pra montar o seletor. Não afeta INSERT/UPDATE/DELETE, que continuam restritos à própria conta
(onboarding de conta nova via UI é fora do escopo desta fase).

**`usuarios_app` precisou de um ajuste sutil na própria policy**: um usuário de suporte precisa
continuar enxergando o **próprio** perfil (nome, dono, modo, suporte) mesmo enquanto está navegando
em outra conta — `fn_conta_atual()` nesse momento aponta pra conta selecionada, não mais pro
`conta_id` do próprio usuário, então a policy antiga (`conta_id = fn_conta_atual()`) bloquearia o
carregamento da própria sessão assim que o modo suporte fosse ativado. Corrigido pra
`id = auth.uid() or conta_id = fn_conta_atual()` — pra um usuário comum isso não muda nada (as duas
metades já apontavam pra mesma linha).

**`contexts/AuthContext.tsx`**: `usuarioApp` ganha o campo `suporte`; novo estado
`contaSuporteAtiva` (join `suporte_conta_ativa` + `contas`, carregado em paralelo no mesmo
`carregarDadosApp`) e `emModoSuporte` derivado (`usuarioApp?.suporte && contaSuporteAtiva !== null`).
`podeAcessar(modulo)` ganha um bypass total no topo: suporte navegando numa conta de cliente enxerga
**tudo**, sem passar pela checagem normal de `conta_modulos`/`usuario_modulos` (que é sobre o que
aquele CLIENTE comprou/liberou, não sobre a equipe interna do fornecedor). `entrarNaConta(contaId)`/
`sairDoSuporte()` fazem upsert/delete em `suporte_conta_ativa` e então **forçam um reload completo**
(`window.location.href = '/'`, não `router.push`) — decisão deliberada: entrar/sair de uma conta muda
o que `fn_conta_atual()` resolve no banco pra toda query do app, e um reload garante que cada tela já
montada refaça sua busca sob o novo escopo, em vez de continuar mostrando dado da conta anterior até
ser remontada por navegação normal.

**`app/suporte/page.tsx`** é o seletor — gate próprio por `usuarioApp?.suporte` (mesmo padrão de
`/usuarios` com `isDono`, não usa `ModuloGate` porque não é um módulo liberável do catálogo). Lista
todas as `contas` (via a policy nova), com "Entrar" por linha e destaque + "Sair" na conta ativa.
Link "Suporte" na Sidebar num grupo próprio "Equipe interna", gated por `usuarioApp?.suporte`
(separado do grupo "Administração", gated por `isDono` — hoje a mesma pessoa tem os dois, mas são
flags independentes).

**`components/SuporteBanner.tsx`** é o indicador visual persistente ("Você está vendo [Conta] como
Suporte" + "Sair") — renderizado como a **primeira coisa dentro de `<main>`**, nos dois layouts
(Sidebar/Modo Gestão e ModoCampoShell/Modo Campo), via `AppShell.tsx`. Decisão deliberada de não usar
um elemento `fixed` próprio: a Sidebar (desktop) já é `fixed inset-y-0`, então um banner fixed
brigaria com esse posicionamento já calculado; injetar como conteúdo normal no topo do fluxo de
`<main>` evita qualquer ajuste de offset/z-index nos layouts existentes.

**Bug pré-existente encontrado durante o teste desta fase, não relacionado ao Suporte em si**
(migração 048b, hotfix): `fn_existe_dono()` — chamada pela tela de `/login` **antes de qualquer
sessão existir**, pra decidir entre mostrar o formulário normal de entrar ou o de "criar conta de
administrador" — nunca tinha sido marcada `security definer`. Desde que RLS foi reativado em
`usuarios_app` (Fase 1, migração 046), essa função (rodando como SECURITY INVOKER) passou a enxergar
zero linhas de `usuarios_app` pra um visitante anônimo (`auth.uid()` é null, a policy nunca bate), e
`exists(select 1 from usuarios_app where dono = true)` sempre retornava `false` mesmo já existindo um
administrador — a tela de login ficaria presa oferecendo "criar conta de administrador" de novo,
indefinidamente. Nunca foi pego antes porque todo teste no navegador desde a Fase 1 partiu de uma
sessão já autenticada (cookie persistido entre reinícios do servidor de desenvolvimento) — esta foi a
primeira vez que uma aba genuinamente sem sessão bateu em `/login` depois do RLS entrar. Corrigido com
`security definer set search_path = public`, mesmo padrão já usado em `fn_conta_atual()` — a função só
retorna um boolean, nunca expõe dado, então bypassar RLS aqui é seguro.

Verificado no navegador de ponta a ponta: `fn_existe_dono()` confirmada retornando `true` via RPC
anônima direta (REST) antes e depois do hotfix, provando a causa raiz e a correção; login normal
funcionando depois do hotfix; Sidebar mostrando os grupos "Administração" e "Equipe interna" pro
usuário dono+suporte; página `/suporte` listando as contas existentes; criação de uma conta de teste
via acesso direto ao banco (só pra ter uma segunda conta pra testar a troca), "Entrar" nela mostrando
o banner correto e o Painel imediatamente vazio (fazendas/movimentações zeradas — confirma que
`fn_conta_atual()` redirecionou toda query do app pra conta de teste, sem nenhum código novo em
nenhuma tela); log de auditoria registrando `ENTROU` corretamente; "Sair" pelo banner voltando ao
Painel real da Conta Principal (956 cabeças) e registrando `SAIU`; `suporte_conta_ativa` confirmada
vazia depois de sair. Conta de teste e registros de auditoria de teste removidos ao final via acesso
direto ao banco.

`orion_agro_schema.sql` sincronizado: `suporte_conta_ativa`/`suporte_auditoria` + triggers inseridas
logo após `usuarios_app`, antes da definição (atualizada) de `fn_conta_atual()` — ordem necessária já
que a função passa a consultar `suporte_conta_ativa`, que por sua vez precisa existir antes dela.
Policy `contas_visivel_suporte` e a policy atualizada de `usuarios_app` também sincronizadas, e
`fn_existe_dono()` já nasce `security definer` no schema consolidado (reflete o hotfix, não o bug).

## Esqueci minha senha (self-service, via e-mail)

Complementa "Redefinir senha" (dono reseta a senha de um funcionário pra `123456` direto em
`/usuarios`, já existente) com um fluxo pra quando é o próprio administrador (ou qualquer usuário)
que esqueceu a senha e não tem ninguém pra resetar por ele — os dois convivem sem conflito, cobrindo
casos diferentes. Usa o fluxo padrão do Supabase Auth (`resetPasswordForEmail`/`updateUser`), sem
tabela nem lógica de negócio nova.

**Fluxo**: `/login` ganha um link "Esqueci minha senha" (só na tela normal de entrar, não na de
bootstrap do primeiro administrador) que abre um formulário de e-mail inline (mesmo card, sem
navegar pra outra rota) — `supabase.auth.resetPasswordForEmail(email, { redirectTo:
".../api/auth/confirmar?next=/redefinir-senha" })`. Mensagem de confirmação é genérica ("se esse
e-mail tiver conta, enviamos um link") — não revela se o e-mail existe ou não no sistema.

**`app/api/auth/confirmar/route.ts`** (Route Handler, fora do proxy de autenticação — a rota `/api`
já é excluída pelo matcher) troca o `code` do link recebido por e-mail por uma sessão de verdade via
`exchangeCodeForSession`, depois redireciona pro `next` (`/redefinir-senha`). Precisa ser um Route
Handler, não uma página client-side, porque a troca de code por sessão é feita no cliente Supabase de
servidor (`lib/supabase/server.ts`, cookies) — a mesma peça que o proxy já usa pra ler sessão em toda
rota.

**`app/redefinir-senha/page.tsx`**: formulário de nova senha + confirmar (mesma validação de
`AlterarSenhaModal.tsx` — mínimo 6 caracteres, as duas senhas precisam bater — mas como página
própria, não modal, já que chega aqui direto de um link de e-mail, fora de qualquer sessão normal de
uso do app). Chama só `supabase.auth.updateUser({ password })` — a sessão de recuperação já
estabelecida pelo Route Handler é suficiente, sem precisar saber quem é o usuário. Excluída do shell
completo (`AppShell.tsx`, mesmo tratamento de `/login`) — não faz sentido montar Sidebar/
`FiltroGlobalProvider` pra alguém que só está aqui pra trocar a senha. Sem sessão nenhuma (visita
direta, sem passar pelo link), o proxy já redireciona pro `/login` sozinho — não está na lista de
rotas públicas.

**Dependência de infraestrutura, fora do código**: o e-mail de recuperação só chega de verdade se o
projeto Supabase tiver um provedor de SMTP configurado (Project Settings → Auth → SMTP Settings) — o
serviço de e-mail padrão do Supabase (compartilhado entre todos os projetos gratuitos) tem limite
baixo de envios e frequentemente cai em spam/é bloqueado por provedores como Gmail. Pra produção,
configurar um SMTP próprio (Resend, SendGrid, Amazon SES, etc.) no painel do Supabase é necessário —
isso não muda nada no código deste fluxo, só a entrega de fato do e-mail.

Verificado no navegador: `resetPasswordForEmail` chamado sem erro (confirma que a chamada em si e o
`redirectTo` estão corretos); mensagem de confirmação genérica exibida; visita direta a
`/redefinir-senha` sem sessão corretamente redirecionada pro `/login` pelo proxy. A entrega real do
e-mail e o fluxo completo do link (troca de code, chegada em `/redefinir-senha` com sessão de
recuperação) não foram exercidos ponta a ponta nesta verificação — dependeria de checar a caixa de
entrada de verdade e do SMTP do projeto já estar configurado.

## Onboarding de conta nova pela UI (Suporte cria conta de cliente, migração 049)

Fecha o maior gargalo prático do multi-tenant: até aqui, criar uma conta de cliente nova só era
possível via SQL direto (inserir em `contas`, rodar manualmente o seed de `categorias_animal`/
`subtipos_uso_area` — que só existia pra "Conta Principal" —, inserir `conta_modulos`/
`conta_limites`, e criar o primeiro usuário via Admin API). Agora um botão **"+ Nova Conta"** na aba
"Contas" de `components/suporte/SuporteHome.tsx` abre `components/suporte/CadastrarContaModal.tsx`
(mesmo molde de `CadastrarUsuarioModal.tsx`) e faz tudo numa passada só: nome da conta, dados do
administrador (nome/e-mail/senha — vira o primeiro `dono` daquela conta, modo `GESTAO` fixo),
checkbox de módulos contratados (`MODULOS` de `lib/modulos.ts`, mesmo componente visual já usado em
`CadastrarUsuarioModal`) e uma seção "Limites (opcional)" colapsável (mesmo padrão accordion já
usado em `/usuarios`) com os dois campos numéricos já existentes em `lib/conta-limites.ts`
(`fazendas`/`proprietarios` — em branco = sem limite).

**`fn_seed_categorias_subtipos_conta()`** (migração 049, trigger `after insert on contas`, mesmo
princípio de `fn_criar_configuracoes_conta` já existente) replica pra `new.id` a mesma lógica de
seed que até então só rodava manualmente pra "Conta Principal" no bloco final de
`orion_agro_schema.sql` — as 11 categorias-sistema (via `grupos_categoria_papel`, catálogo global) e
os subtipos de uso de área ("Geral" + sugestões de Pecuária/Agricultura, via `tipos_uso_area`,
também global). Só grava linhas conta-scoped; não precisa de mudança de RLS porque `contas` só é
inserida pelo cliente admin/service-role (que já bypassa RLS), e os inserts da trigger usam
`conta_id = new.id` explícito. Não dispara retroativamente pra "Conta Principal" (inserida antes
dessa trigger existir no arquivo consolidado) — o bloco de seed manual continua lá, inalterado.

**`app/api/contas/route.ts`** (novo, `POST`) — `exigirSuporte()` (mesmo padrão de `exigirDono()`, mas
checando `usuarios_app.suporte` em vez de `dono`) protege o endpoint. Sequência: cria o usuário de
auth primeiro (`email_confirm: true`, mesmo motivo de `POST /api/usuarios` — quem cria é o próprio
Suporte); insere `contas` (dispara as duas triggers de seed); insere `conta_modulos`/`conta_limites`
se informados; insere `usuarios_app` com `dono: true`. Se o insert de `usuarios_app` falhar, desfaz o
usuário de auth (mesmo padrão de "sem login órfão" já usado em `POST /api/usuarios`); falha nos
passos de módulos/limites não tenta rollback (operação administrativa rara, corrigível manualmente —
editar `conta_modulos`/`conta_limites` de uma conta já existente continua fora do escopo desta
rodada, só via SQL).

**Bug real encontrado e corrigido durante o teste (migração 049b)**: a constraint
`uq_subtipo_nome_tipo_uso` (criada na migração 032, `unique (tipo_uso_id, nome)`) nunca foi
atualizada pra incluir `conta_id` quando `subtipos_uso_area` virou conta-scoped na Fase 1 (migração
046) — diferente de `fazendas.nome`, que recebeu esse tratamento corretamente na própria migração
046 (`uq_fazendas_conta_nome`). Como `tipos_uso_area` é catálogo global (mesmo `tipo_uso_id` em todas
as contas), a segunda conta a inserir um subtipo "Geral" pra qualquer tipo de uso colidia com a linha
"Geral" já existente da primeira — só apareceu agora porque, até a trigger de seed automático
existir, nunca tinha havido uma segunda conta inserindo `subtipos_uso_area`. Corrigido recriando a
constraint como `unique (conta_id, tipo_uso_id, nome)`.

**Segundo bug real encontrado e corrigido**: o toggle Ativar/Inativar de contas em `SuporteHome.tsx`
(criado na rodada anterior, "home dedicada de Suporte") só funcionava pra conta do próprio usuário de
Suporte — a migração 048 só liberou **SELECT** em `contas` pra qualquer `suporte = true`
(`contas_visivel_suporte`), UPDATE continuou restrito a `id = fn_conta_atual()`. Como só existia
"Conta Principal" até esta rodada, o bug nunca tinha sido exercido contra uma conta de verdade
diferente da própria (o teste anterior só validou o caminho "toggle na própria conta", que sempre
bateu com `fn_conta_atual()`). Corrigido roteando a ação por uma Route Handler nova,
**`app/api/contas/[id]/route.ts`** (`PATCH`, `exigirSuporte()` + cliente admin) — mesmo padrão já
usado pra `/api/usuarios/[id]`, em vez de abrir uma policy de UPDATE ampla direto na tabela pra
qualquer sessão de suporte.

Verificado no navegador de ponta a ponta: criação de uma conta de teste completa (nome, administrador
com senha própria, 3 módulos marcados, limite de 1 fazenda) pelo modal; login como o administrador
recém-criado mostrando a Sidebar filtrada só com os 3 módulos escolhidos (confirma
`modulosDaConta`); as 11 categorias-sistema presentes em `/categorias` (seed automático funcionando);
criar a 1ª fazenda funcionou (dentro do limite), tentar criar a 2ª foi bloqueada com a mensagem de
`excedeuLimiteConta` ("contrate o módulo Multifazendas..."); toggle Ativar/Inativar (após o hotfix)
persistindo corretamente pra uma conta que não a do próprio Suporte. Dados de teste (conta, fazenda,
pessoa proprietária, usuário administrador) removidos por completo ao final via SQL direto — exigiu
respeitar a ordem de FK (fazendas antes de pessoas, por causa de `proprietario_id`) e desligar
temporariamente os gatilhos de `categorias_animal`/`subtipos_uso_area` (que bloqueiam excluir linha
`sistema = true`, exatamente o que o seed automático cria) e limpar `suporte_conta_ativa`/
`suporte_auditoria` (referenciam `contas`) antes do delete final.

## Proprietário do lote de gado vira obrigatório (revisão pós-uso)

Depois de usar o proprietário do lote na prática, o usuário observou que o campo continuava
totalmente opcional mesmo com 2+ proprietários já cadastrados — deixando margem pra lançar
movimentação com dono ambíguo, o que compromete justamente a separação financeira que era o motivo
de o campo existir. Três decisões confirmadas com o usuário:

- **Nenhuma movimentação pode ser lançada com 0 proprietários cadastrados na conta** — `app/
  movimentacoes/page.tsx` ganha `bloqueadoPorSemProprietario` (`!editandoId && proprietariosDisponiveis
  .length === 0`), mesmo princípio de `bloqueadoPorSaldoInicial` já existente (banner de erro +
  `disabled` no botão de salvar + guarda no topo de `handleSubmit`, só trava lançamentos **novos**,
  nunca a edição de um já existente). Banner aponta pra "Pessoas e Empresas" pra cadastrar o
  primeiro proprietário.
- **Obrigatório assim que o seletor aparece** (2+ proprietários cadastrados) — ganha `<Required />`
  tanto no formulário avulso ("Proprietário do lote") quanto na tabela de lote (coluna
  "Proprietário"), e é validado com `alert()` antes de salvar (mesmo padrão já usado pra peso morto/
  rendimento em Venda Abate) — tanto em `handleSubmit` (avulso) quanto em `handleSubmitLote`.
- **Com exatamente 1 proprietário cadastrado, nenhum seletor aparece e esse único proprietário é
  atribuído automaticamente** (sem pedir nada ao usuário) — novo helper `resolverProprietarioId(
  escolhidoId)` centraliza essa lógica (usado nos dois formulários), substituindo o antigo
  `mostrarSeletorProprietario && proprietarioId ? proprietarioId : null` que deixava a movimentação
  sem dono mesmo quando só havia um proprietário óbvio no sistema — o que ia contra o objetivo de
  "nenhum animal sem informação de proprietário". Mudança de Categoria continua de fora (nunca usa
  esse campo, por design já documentado acima), Desmame nunca chega a essa checagem (handler
  próprio, retorna mais cedo).

Verificado: type-check limpo; visualmente confirmado no navegador que "Proprietário \*" aparece com
o indicador de obrigatório na tabela de lote (conta atual tem 2 proprietários cadastrados). O
caminho do `alert()` de bloqueio não foi exercitado ponta a ponta via automação nesta rodada — o
formulário de lançamento tem uma cascata de campos dependentes (fazenda → módulo → pasto →
categoria) que se mostrou frágil de simular via eventos sintéticos; a lógica em si segue exatamente
o mesmo padrão já usado (e já testado) pras outras validações condicionais do mesmo formulário
(peso morto/rendimento, saldo insuficiente), então o risco residual é baixo.

## Gráfico de Lotação: barra "Rebanho Médio" sem interação de mouse

Bug relatado pelo usuário: passar o cursor sobre as barras de "Rebanho Médio" no gráfico combinado
(`app/relatorio-lotacao/page.tsx`) apagava todas as linhas (`strokeOpacity` cai pra 0.15 quando
outra série está em destaque) bem na área coberta pela barra — como a barra ficava com
`fillOpacity = 1` (opaca) exatamente nesse estado, uma linha quase invisível por baixo dela
(tecnicamente ainda desenhada por cima, DOM/ordem de pintura nunca mudou) ficava visualmente
indistinguível, lendo como "a linha foi pra trás da barra".

Causa raiz: o `<Bar>` tinha `onMouseEnter`/`onClick` próprios chamando `setDestaque('rebanho_medio')`
— como passar o mouse pelas barras é o movimento mais natural ao explorar esse gráfico, isso disparava
o estado de destaque constantemente, apagando as 3 linhas a cada passada. Corrigido removendo esses
dois handlers do `<Bar>` — a barra deixa de reagir ao cursor (mouse sobre ela não faz mais nada),
mas continua destacável clicando/passando o mouse no item "Rebanho Médio" da legenda (que já tinha
seu próprio `onMouseEnter`/`onMouseLeave` independente, inalterado). `activeBar` ganhou `fill` e
`stroke` explícitos (iguais ao estado normal) pra neutralizar o "active shape" interno do Recharts,
que continua disparando internamente mesmo sem handler nosso.

Verificado via inspeção direta do DOM (não por screenshot): disparei um evento sintético de
`mouseover` numa célula da barra e confirmei que `stroke-opacity` das 3 linhas permaneceu `1`
(antes da correção, isso teria caído pra `0.15`) — a barra deixou de conseguir acionar o estado de
destaque.

## Painel: lista "Distribuição do rebanho atual" perde a porcentagem

Pedido do usuário: a porcentagem de participação já aparece no gráfico de rosca "Distribuição sexo ×
categoria" ao lado — repetir o número na lista de barras horizontais era redundante. Removido só o
texto "· 31,4%" de cada linha em `app/page.tsx`; a barra de proporção horizontal (`width: ${pct}%`)
continua, já que ela é visual, não numérica, e não foi o que o usuário pediu pra tirar.

## Lançamento de Movimentações: nenhum tipo pré-selecionado, passos 2-4 só depois de escolher

Dois problemas relatados pelo usuário ao abrir "Novo lançamento": (1) um dos 9 botões do passo 1
("Compra", no caso) aparecia com a borda de destaque mesmo sem nenhuma escolha ter sido feita — o
`tipo` (state) sempre tem um valor default (`'NASCIMENTO'`, nunca `null`, pra evitar tornar o tipo
opcional em todo o resto do arquivo, que assume um `TipoMovimentacao` real em dezenas de lugares) e
o botão correspondente comparava `tipo === t` sem checar se o usuário já tinha de fato confirmado
uma escolha; (2) os passos 2-4 (Quando e onde, Categorias, Detalhes) sempre apareciam abaixo do
passo 1, mesmo antes de qualquer tipo ser escolhido, competindo visualmente com a decisão que
precisa vir primeiro.

Dois ajustes em `app/movimentacoes/page.tsx`, ambos aproveitando o `tipoConfirmado` que já existia
(controla o colapso do passo 1, ver "Terceira rodada" acima) em vez de mexer no tipo de `tipo`:
- O destaque visual do botão de tipo passa a exigir `tipoConfirmado && tipo === t` (era só
  `tipo === t`) — como a grade só aparece enquanto `!tipoConfirmado`, nenhum botão nunca fica
  destacado enquanto ela está visível, sem precisar tornar `tipo` opcional em lugar nenhum.
- Os passos 2-4 (mais os banners de bloqueio e o botão de salvar) foram envolvidos num
  `{tipoConfirmado && (<>...</>)}` — só renderizam depois que o usuário clica num tipo de verdade.
  Reabrir uma edição já existente (`iniciarEdicao`/`iniciarEdicaoGrupo`/`iniciarEdicaoDesmame`) já
  força `tipoConfirmado = true` desde a rodada anterior, então esse fluxo continua abrindo com tudo
  visível, sem regressão.

Verificado no navegador: abrir "Novo lançamento" agora mostra só o passo 1, sem nenhum botão com
borda de destaque (confirmado via `getBoundingClientRect`/classList, nenhum botão com
`border-brand-500`+`ring-2`) e nenhum conteúdo abaixo dele; clicar em "Compra" colapsa o passo 1 na
barra compacta de sempre e revela os passos 2-4 imediatamente. Formulário fechado sem salvar ao
final.

## Módulos de domínio + recursos (migração 050)

Reestruturação do catálogo de módulos vendidos por conta, discutida e planejada com o usuário logo
depois do onboarding acima: `conta_modulos` (migração 047) era granular por **tela** (Fazendas,
Movimentações, Pesagens... — 8-10 entradas soltas em `lib/modulos.ts`), mas na prática todas as
telas de hoje são sub-partes de um único domínio implícito "Pecuária". Confirmado com o usuário: o
catálogo real de venda é em dois eixos — **módulo de domínio** (Pecuária, Agricultura, Máquinas,
Clima, Financeiro — só Pecuária tem telas reais hoje, os demais ficam reservados) e **recurso**
dentro de um domínio já contratado (flags independentes, combináveis livremente, por cima do básico
— ex.: dentro de Pecuária, "controle por pasto" e um futuro "controle individual" podem coexistir,
cada um vendido à parte). `conta_limites` (Multifazendas/Multiproprietário) continua como terceiro
eixo, transversal, sem mudança.

**`conta_modulos.modulo` foi renomeada pra `conta_modulos.dominio`** — reinterpreta a coluna
existente em vez de criar tabela nova (só muda a granularidade do valor: id de tela → id de domínio).
Migração 050 fez isso direto (sem coluna de transição) porque só existia uma conta real em produção
("Conta Principal") — mesmo raciocínio de risco já aceito nas migrações 046/049: guarda os `conta_id`
que tinham qualquer linha, apaga tudo, renomeia a coluna, reinsere uma linha `dominio = 'pecuaria'`
por `conta_id` guardado (qualquer tela liberada antes implica que a conta "tem" o domínio agora).

**`conta_recursos`** (conta_id, dominio, recurso, ativo) é a tabela nova, mesmo molde de
`conta_limites`/`conta_modulos` (RLS igual). `lib/conta-recursos.ts` só guarda o catálogo
(`RecursoId = 'controle_pasto'`, `RECURSOS: {id, dominio, label}[]`) — **sem nenhum helper de leitura
em runtime**, porque nenhuma tela lê `conta_recursos` diretamente: o único recurso hoje
(`controle_pasto`) só alimenta `configuracoes.controla_pasto` no momento em que é concedido (ver
abaixo), e é essa coluna que todo o resto do app já lia antes desta migração (Movimentações,
Pesagens, Gestão de Áreas, Relatório de Lotação, Painel...) — **nenhuma dessas telas precisou mudar**,
só a origem de quem liga a flag mudou.

**"Controle por pasto" vira recurso pago** — confirmado com o usuário: antes era um toggle grátis
self-service em `app/fazendas/page.tsx` (`handleToggleControlaPasto`, removido); agora só o Suporte
libera, via `app/api/contas/route.ts` (onboarding) marcando `conta_recursos` **e** fazendo
`configuracoes.controla_pasto = true` na mesma chamada. O toggle em Fazendas virou um badge
somente-leitura ("Ativo" em `success`/"Não contratado" em cinza + texto explicativo) — `controlaPasto`
(estado, já lido de `configuracoes`) continua controlando exatamente o que já controlava antes (aba
"Módulos e Pastos" só aparece se ativo). **`controla_subtipo_area` não muda** — fica de fora desta
rodada, continua toggle grátis self-service (só "controle por pasto" foi confirmado como pago). A
migração dá o recurso de graça pra toda conta que já tinha `controla_pasto = true` (backfill em
`conta_recursos`), sem perder a funcionalidade que já usava.

**`contexts/AuthContext.tsx`**: `modulosDaConta` virou `dominiosDaConta: Set<DominioId>` (busca
`conta_modulos.select('dominio')`). `podeAcessar(modulo)` agora resolve o domínio da tela
(`MODULOS.find(m => m.id === modulo)?.dominio`) e checa `dominiosDaConta.has(dominio)` no lugar do
antigo `modulosDaConta.has(modulo)` — `usuario_modulos` (por tela, por usuário, dentro da conta) não
muda em nada.

**`components/suporte/CadastrarContaModal.tsx`**: "Módulos contratados" virou checkbox de
**domínio** (`DOMINIOS`, ~5 opções) em vez de tela (~10 opções antes) — mais simples, já que o dono
de uma conta nova enxerga automaticamente todas as telas do domínio contratado (`isDono` bypassa
`usuario_modulos`, não precisa marcar telas individuais pra ele mesmo). Nova seção "Recursos
adicionais", só aparece quando o domínio dono do recurso está marcado (`RECURSOS.filter(r =>
dominiosSelecionados.has(r.dominio))`) — hoje só "Controle por pasto" some/aparece junto com
"Pecuária". Desmarcar um domínio poda os recursos que dependiam dele.

**Polimento aplicado também em `components/usuarios/CadastrarUsuarioModal.tsx` e
`app/usuarios/page.tsx`** (accordion de módulos por funcionário): os checkboxes de tela agora só
listam `MODULOS` cujo domínio está em `dominiosDaConta` — evita o dono marcar uma tela de um domínio
que a própria conta não comprou (já era bloqueado em runtime por `podeAcessar`, isso é só clareza de
UI).

Verificado no navegador de ponta a ponta: Conta Principal sem regressão (Sidebar completa, badge
"Controle por pasto: Ativo" preservado depois da migração — confirma que o backfill de
`conta_recursos` funcionou); modal de onboarding mostrando os 5 domínios em vez de 10 telas, com
"Recursos adicionais → Controle por pasto" aparecendo/sumindo junto com o checkbox de Pecuária;
conta de teste criada com domínio Pecuária + recurso Controle por pasto — login como o administrador
mostrou a Sidebar completa de Pecuária (confirma `dominiosDaConta`/`podeAcessar` via domínio) e
`/fazendas` já mostrou "Controle por pasto: Ativo" sem nenhum toque manual (confirma que o recurso
alimentou `configuracoes.controla_pasto` direto no onboarding). Dados de teste removidos ao final via
SQL direto (mesmo processo já usado na rodada anterior, adaptado pra `conta_recursos`/`dominio`).

## Proprietário em todos os lançamentos e relatórios do rebanho (migração 051)

Pedido do usuário depois de usar a feature de proprietário do lote (já existente desde a migração
044/045): o campo só cobria Movimentações e 3 dos 4 relatórios/telas que envolvem rebanho — faltava
Saldo Inicial, Mudança de Pasto e "Rebanho por pasto". Extensão completa, seguindo a mesma lógica já
definida (seletor só aparece com 2+ proprietários cadastrados; com exatamente 1, atribuído sozinho;
com 0, bloqueia o lançamento).

**Duas decisões de arquitetura fechadas com o usuário via pergunta direta antes de implementar**
(`AskUserQuestion`, ambas seguindo a opção recomendada):
- **"Rebanho por pasto" ganha o cruzamento pasto × proprietário** — reverte, só pra essa combinação
  específica, o princípio "proprietário não cruza com pasto" que valia desde a migração 044 (mesmo
  motivo que evita cruzar pasto × safra: complexidade desproporcional sem necessidade real). Aqui a
  necessidade é real: sem cruzar, não dava pra filtrar esse relatório por dono.
- **Relatório de Lotação NÃO ganha o filtro** — mantém a exclusão já documentada (lotação cruza
  rebanho com área, e área não tem dimensão de proprietário; filtrar só o rebanho produziria um
  número matematicamente enganoso). Mesmo raciocínio já aplicado aos KPIs "hoje" do Painel.

**Por que cruzar pasto × proprietário é uma questão de integridade, não só de relatório**: as
checagens de saldo já existentes (por pasto, por proprietário, cada uma somando sobre a outra
dimensão) não bastam sozinhas pra impedir que a combinação específica fique negativa. Exemplo: um
pasto com 10 cabeças de uma categoria, sendo 5 do proprietário X e 5 do Y — vender 8 cabeças de X
desse pasto passaria pelas duas checagens antigas (saldo do pasto = 10 ≥ 8; saldo de X somado em
todos os pastos pode ser bem maior que 8), mas deixaria a combinação (pasto, X) negativa (-3) sem
nenhuma das duas perceber. Por isso a migração adiciona uma terceira camada de defesa em
profundidade, no mesmo espírito de pasto/lote/proprietário já existentes.

**Migração 051**:
- `fn_saldo_categoria_pasto_proprietario(fazenda, categoria, pasto, proprietario, data)` — mesma
  receita de `fn_saldo_categoria_pasto`, cruzando com `proprietario_id`. Mesma lista de tipos que
  `fn_saldo_categoria_proprietario` já usa (Mudança de Categoria/Desmame não entram como entrada;
  DESMAME conta só como saída), acrescida de `MUDANCA_PASTO` — que `fn_saldo_categoria_proprietario`
  nunca teve, porque antes proprietário não cruzava com pasto; agora precisa, senão mover só parte
  de um pasto com cabeças de mais de um dono quebraria o saldo cruzado.
- `fn_delta_para_par_pasto_proprietario`/`fn_checar_saldo_pasto_proprietario_futuro` — trajetória de
  edição/exclusão na dimensão cruzada, mesmo padrão "defesa em profundidade silenciosa" já usado pra
  lote/proprietário (sem aviso de confirmação amigável no frontend, só bloqueio direto do banco).
  Wireadas em `fn_validar_saldo_categoria` (insert), `fn_validar_edicao_movimentacao` e
  `fn_validar_delete_movimentacao`.
- `fn_relatorio_rebanho_por_pasto` ganha `p_proprietario_ids uuid[] default null` — quando
  informado, soma `fn_saldo_categoria_pasto_proprietario` por proprietário selecionado em vez de
  `fn_saldo_categoria_pasto` sem filtro. Precisou de `drop function` antes (muda assinatura, mesmo
  princípio já usado em migrações anteriores que trocaram assinatura de função).

**`components/fazendas/SaldoInicialPanel.tsx`**: ganha o mesmo seletor de proprietário já usado em
Movimentações (`mostrarSeletorProprietario`/`resolverProprietarioId`, um único proprietário por
lançamento de saldo inicial, aplicado a todas as categorias — mesmo princípio já usado pro pasto
nessa tela) e o mesmo banner de bloqueio (`bloqueadoPorSemProprietario`) quando 0 proprietários estão
cadastrados.

**`app/controle-pasto/page.tsx`** (Mudança de Pasto): ganha proprietário **por linha** (não um campo
único do lançamento, diferente de Saldo Inicial) — necessário porque um mesmo lote de Mudança de
Pasto pode mover cabeças de donos diferentes do mesmo pasto em linhas separadas, e porque o saldo
cruzado precisa saber de qual dono são as cabeças que estão mudando de pasto quando o pasto de
origem tem mais de um proprietário. Mesmo padrão de bloqueio/auto-preenchimento das outras telas.
Listagem de "Últimas mudanças de pasto" ganha `propriet.: Nome` no detalhe de cada linha, mesmo
formato já usado em Movimentações.

**`app/relatorio-rebanho-por-pasto/page.tsx`**: reaproveita `proprietarios`/`proprietarioIds`/
`alternarProprietario`/`alternarTodosProprietarios`/`todosProprietariosSelecionados` do
`FiltroGlobalContext` (mesmo padrão de checkbox list + "Marcar/Desmarcar todas" que os outros 3
relatórios já tinham antes da revisão de multi-select — ver seção abaixo) — só aparece com 2+
proprietários cadastrados. `todosProprietariosSelecionados` vira `null` no parâmetro da RPC (sem
filtro); uma seleção parcial vira o array de ids.

Verificado no navegador: `fn_relatorio_rebanho_por_pasto` com a assinatura nova funcionando sem
filtro (327 cabeças, idêntico ao valor de antes da migração) e com filtro parcial (desmarcar um
proprietário zerou o resultado pra "Sem rebanho registrado nessa data" — sem erro de SQL, confirma
que a função cruzada executa corretamente; o resultado bater com zero é esperado porque o rebanho de
teste é todo legado, sem `proprietario_id` atribuído em nenhuma linha, então nenhum proprietário
específico "possui" nada ainda). Saldo Inicial e Mudança de Pasto mostrando o campo "Proprietário *"
corretamente com os 2 proprietários cadastrados na conta de teste. O caminho de bloqueio por saldo
cruzado negativo (pasto com 2 donos, tentar mover mais cabeças de um dono específico do que ele tem
ali) não foi exercitado ponta a ponta nesta rodada — o rebanho de teste não tem nenhuma cabeça com
proprietário atribuído em nenhum pasto ainda (tudo é histórico anterior à migração 051), então não
havia um cenário real pra forçar esse bloqueio; a lógica em si segue exatamente o mesmo padrão já
testado (pasto, lote, proprietário) e é coberta pelo type-check.

## Filtros de Relatórios de Movimentações viram multi-select em popover + "Marcar/Desmarcar todas"

Pedido do usuário depois de ver a tela: Fazendas e Proprietário eram listas de checkbox sempre
expandidas (ocupando várias linhas), enquanto Categoria era um `<select>` de escolha única — os 3
ficaram inconsistentes entre si, e nenhum tinha "Marcar/Desmarcar todas" fora de Fazendas.

`app/relatorios/page.tsx` ganha um componente novo, `FiltroMultiSelect` — botão de linha única
mostrando um resumo ("Todas (N)", "N de M selecionadas", "Nenhuma selecionada") que abre um popover
com checkboxes + "Marcar todas"/"Desmarcar todas" ao clicar, fecha ao clicar fora (`mousedown` no
document, comparado contra um `ref` no popover). Os 3 filtros (Fazendas, Categoria, Proprietário)
agora usam o mesmo componente — Categoria vira multi-select pela primeira vez (`categoriaIds: string[]`,
local a essa página, com `alternarCategoria`/`alternarTodasCategorias`, todas selecionadas por padrão
ao carregar a lista).

**Semântica de "todas selecionadas por padrão" exigiu mudar `FiltroGlobalContext.tsx`**: antes,
`proprietarioIds` começava vazio e a query tratava vazio como "sem filtro" (comentário explícito:
"nunca esconder lançamentos sem proprietário por padrão"). Isso funcionava pra lógica de query, mas
fazia os checkboxes renderizarem todos **desmarcados** por padrão — o oposto do que "todas
selecionadas" pede visualmente. Corrigido tornando `proprietarioIds` sempre explícito desde o
início, mesmo princípio já usado em `fazendaIds`: no primeiro carregamento (sem nada salvo no
`localStorage`), popula com todos os ids em vez de ficar vazio. `alternarTodosProprietarios`/
`todosProprietariosSelecionados` novos no contexto espelham `alternarTodas`/`todasSelecionadas` de
fazenda. A lógica de filtro (`length > 0 && length < total` → filtra) não mudou — com o array sempre
explícito agora, "todos marcados" e "vazio" convergem pro mesmo resultado de query de qualquer forma,
então **Painel** e **Resumo de Movimentação** (que reaproveitam esse mesmo estado global sem
mudança nenhuma no próprio código deles) ganharam de graça a correção visual (checkboxes mostrando
todos marcados por padrão), só por causa da mudança no valor inicial do contexto.

**Filtro de proprietário em `app/relatorios/page.tsx` ganha uma regra própria pra seleção parcial**:
diferente de Fazenda (sempre um filtro literal) e Categoria (toda movimentação tem categoria, então
"0 marcadas" só pode significar "mostrar nada"), Proprietário é opcional numa movimentação — a
maioria das linhas nunca teve dono atribuído. Por isso, numa seleção parcial (inclusive "nenhum
marcado"), o filtro sempre inclui `proprietario_id.is.null` além dos ids marcados — lançamentos sem
proprietário nunca desaparecem por causa desse filtro, porque eles não pertencem a nenhum dos
proprietários **desmarcados**, então ficar de fora da lista de exclusão é o comportamento correto,
não uma falha do filtro. Com 0 marcados, a query vira só `proprietario_id.is.null` (mostra só os sem
dono) — comportamento previsível em vez de "ignorar o filtro e mostrar tudo" (que seria surpreendente
já que os checkboxes mostrariam tudo desmarcado). Essa regra fica só nesta página — Painel e Resumo
de Movimentação continuam usando a RPC (`fn_relatorio_movimentacao_rebanho`) com sua lógica mais
simples de sempre (`length > 0 && length < total` → filtra pelos ids, sem o `is.null` explícito),
fora do escopo desta rodada.

Verificado no navegador: os 3 filtros renderizando em linha única com "Todas (N)" por padrão;
popover de Categoria abrindo com os 13 checkboxes, desmarcar uma categoria atualizando o resumo pra
"12 de 13 selecionadas" e filtrando a tabela corretamente (13→5 nascidos ao desmarcar Bezerra);
"Desmarcar todas" em Proprietário mostrando "Nenhuma selecionada" e "Marcar todas" restaurando;
type-check limpo.

## Gestão de Áreas: mover pasto de módulo vira ícone + popover discreto

Pedido do usuário depois de ver a tela: o `<select>` de "Mover pra outro módulo" (migração 041)
ficava sempre visível ao lado do nome de cada pasto, ocupando espaço horizontal à toa na grande
maioria dos casos (pasto já está no módulo certo). Antes de implementar, avaliei opções junto com o
usuário (ícone discreto na coluna Ações vs. arrastar entre módulos) — confirmado o ícone.

`components/fazendas/GestaoAreasPanel.tsx`: o `<select>` sai da linha do nome e vira um ícone novo
(`IconMoverModulo`, mesmo estilo de traço dos outros ícones da coluna Ações) que abre um popover
pequeno (`moduloPickerPastoId`, estado de qual pasto tem o popover aberto — só um por vez) com a
lista de módulos como botões clicáveis (módulo atual destacado em `bg-brand-100`). Fecha ao clicar
fora (mesmo padrão de `mousedown` + `ref` já usado no `FiltroMultiSelect` de Relatórios) ou ao
escolher um módulo. `handleMoverPastoModulo` não mudou de lógica, só passou a ser chamado pelo
clique no botão do popover em vez do `onChange` do select.

Verificado no navegador: ícone aparece na coluna Ações só quando há 2+ módulos (mesma condição de
antes); clicar abre o popover com os 2 módulos da fazenda de teste ("Vilar", "Sítio Túlio"); clicar
fora fecha sem mudar nada; type-check limpo.

## Inativar pasto exige que ele não tenha gado no momento

Pedido do usuário: o toggle Ativar/Inativar de pasto em Gestão de Áreas só bloqueava se fosse o
único pasto ativo do módulo — não checava se o pasto ainda tinha cabeças de gado. Inativar um pasto
ocupado tiraria ele dos seletores de lançamento (Movimentações, Mudança de Pasto, Pesagens) sem
nenhum aviso, dificultando mover esse rebanho depois.

`handleAlternarAtivoPasto` em `GestaoAreasPanel.tsx` ganha uma checagem só no caminho de inativar
(nunca ao ativar): busca `fn_relatorio_rebanho_por_pasto(fazenda, hoje)` (mesma RPC já usada no
relatório "Rebanho por pasto" — fotografia de hoje, sem função SQL nova) e bloqueia com `alert()` se
alguma linha do pasto em questão tiver `quantidade > 0`. Puramente client-side (sem trigger no
banco) — mesmo raciocínio já usado pra outros guards informativos desta tela (`bloqueadoPorPastoInsuficiente`
em Mudança de Pasto, por exemplo): inativar não é uma operação destrutiva de dado, só tira o pasto
dos seletores de lançamento, então uma checagem de UI é suficiente.

Verificado no navegador: tentar inativar "Piquete 1" (33 cabeças) bloqueou com o alerta correto e o
pasto continuou ativo; inativar "Pasto 2" (sem gado) funcionou normalmente; revertido ao final.
