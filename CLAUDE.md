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
filtrado. **A distribuição de área vive dentro de `app/gestao-areas/page.tsx`** (não numa página de
relatório separada) — a mesma fazenda selecionada no topo alimenta tanto essa seção quanto a de
"Lançar mudança de uso" logo abaixo, decisão explícita pra não repetir o seletor de fazenda em duas
telas. O frontend pivota o resultado num gráfico de barras empilhadas (uma barra por mês, cor por
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

**Área inicial por tipo de uso é cadastrada em `app/fazendas/page.tsx`** (seção expansível por
fazenda, mostrada automaticamente ao cadastrar uma fazenda nova), não em Gestão de Áreas —
`app/gestao-areas/page.tsx` só mostra a distribuição e lança/edita `MUDANCA_USO` (mudanças de uso ao
longo do tempo). Ao cadastrar uma fazenda nova, o fluxo é: declarar área inicial (inline, na própria
página Fazendas) → link manual "Continuar para o saldo inicial do rebanho" → `/saldo-inicial`.

## Filtros de período (Mês / Ano Safra / Ano Calendário / Período personalizado)

Todo relatório com filtro de período (`app/gestao-areas/page.tsx` e
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
`app/gestao-areas/page.tsx` já usa pra editar `MUDANCA_USO`) pra cada linha com `existingId`, e:
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

Em `app/gestao-areas/page.tsx`, o formulário de "Lançar mudança de uso" ganha dois seletores de
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

## Renomeações de navegação

Ajuste puramente de rótulo/organização, sem mudança de rota nem de comportamento (exceto onde
indicado). Grupos da sidebar: "Gestão" → "Gerenciamento"; "Movimentação" → "Rebanho"; "Pastejo" →
"Controle de Pasto"; "Áreas" → "Gestão de Áreas". Itens: "Movimentações" → "Lançamento de
Movimentações"; "Relatório" (singular, `/relatorio-movimentacao`) → "Resumo de Movimentação de
Rebanho"; "Relatórios por tipo" (`/relatorios`) → "Relatórios de Movimentações"; "Saldo inicial"
removido (absorvido pela fazenda, ver acima); "Controle de Pasto" (`/controle-pasto`) → "Mudança de
Pasto"; "Gestão de áreas" (`/gestao-areas`) → "Distribuição da Área". O `<h1>` de cada página
renomeada foi atualizado junto pro mesmo texto do novo rótulo do item (convenção já seguida antes),
com uma exceção deliberada: `app/gestao-areas/page.tsx` mantém o `<h1>` "Gestão de Áreas" mesmo com
o item de menu renomeado pra "Distribuição da Área", porque essa página também é onde se lança
`MUDANCA_USO` — chamar o `<h1>` de "Distribuição da Área" (só metade do conteúdo da página, a outra
metade é o formulário de lançamento) seria menos preciso que manter o nome mais abrangente ali;
"Distribuição da Área" descreve bem o que se acha *pelo menu*, mas não precisa ser também o título
da página em si.

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
com o mesmo capping em "hoje" já usado pro rebanho (não existe previsão aqui — diferente de
`app/gestao-areas/page.tsx`, cuja "Ano Safra"/"Ano Calendário" atual vai até o fim do mês corrente
como projeção). Essa escolha é deliberada: como o relatório pareia área com rebanho médio (que não
tem previsão possível), deixar a área projetar pro futuro enquanto o rebanho para em "hoje" geraria
uma Lotação sem sentido — por isso os números de "Área Média" aqui podem divergir dos mostrados em
Gestão de Áreas pro mesmo Ano Safra/Ano Calendário quando o período ainda não terminou; não é bug,
os dois relatórios respondem perguntas diferentes de propósito.

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
chamada adicional ao banco — mesma lógica de ponderação por dias do parágrafo acima.

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
