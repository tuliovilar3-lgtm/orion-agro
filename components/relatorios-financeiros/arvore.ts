// árvore de classificação compartilhada pelas 3 abas de Relatórios
// Financeiros (Balancete, Desembolso R$/cab., Desembolso R$/@) — cada
// aba busca seus próprios dados (lancamentos_financeiros direto pro
// Balancete; lancamento_baixas joined até lancamentos_financeiros pras
// outras duas) e mapeia pra essa forma comum antes de montar a árvore,
// mesmo princípio de "cada tela busca seus dados, a lógica de
// agregação é compartilhada" já usado em lib/distribuicao-pasto.ts.

export type LinhaClassificada = {
  tipo: 'CREDITO' | 'DEBITO'
  classeNumero: number
  classeNome: string
  centroNumero: number
  centroNome: string
  subcentroNumero: number
  subcentroNome: string
  produtoNome: string
  valor: number
  // 'YYYY-MM', pra agrupamento mensal — sempre presente mesmo no modo
  // acumulado (o nó soma todos os meses, mas guarda o detalhe também)
  mes: string
}

export type NoArvore = {
  chave: string
  label: string
  nivel: 'tipo' | 'classe' | 'centro' | 'subcentro' | 'produto'
  valor: number
  valoresPorMes: Record<string, number>
  filhos: NoArvore[]
}

function novoNo(chave: string, label: string, nivel: NoArvore['nivel']): NoArvore {
  return { chave, label, nivel, valor: 0, valoresPorMes: {}, filhos: [] }
}

function acumular(no: NoArvore, valor: number, mes: string) {
  no.valor += valor
  no.valoresPorMes[mes] = (no.valoresPorMes[mes] || 0) + valor
}

// monta a árvore Tipo → Classe → Centro → Subcentro → Produto a partir
// de linhas já classificadas — só cria nó pra combinação que de fato
// teve lançamento no período filtrado (nunca lista os ~150 nós do
// plano de contas inteiro vazios)
export function construirArvore(linhas: LinhaClassificada[]): NoArvore[] {
  const porTipo = new Map<string, NoArvore>()

  for (const l of linhas) {
    const tipoChave = l.tipo
    const tipoLabel = l.tipo === 'CREDITO' ? 'Crédito' : 'Débito'
    let noTipo = porTipo.get(tipoChave)
    if (!noTipo) {
      noTipo = novoNo(tipoChave, tipoLabel, 'tipo')
      porTipo.set(tipoChave, noTipo)
    }
    acumular(noTipo, l.valor, l.mes)

    const classeChave = `${tipoChave}.${l.classeNumero}`
    let noClasse = noTipo.filhos.find((f) => f.chave === classeChave)
    if (!noClasse) {
      noClasse = novoNo(classeChave, `${l.classeNumero} — ${l.classeNome}`, 'classe')
      noTipo.filhos.push(noClasse)
    }
    acumular(noClasse, l.valor, l.mes)

    const centroChave = `${classeChave}.${l.centroNumero}`
    let noCentro = noClasse.filhos.find((f) => f.chave === centroChave)
    if (!noCentro) {
      noCentro = novoNo(centroChave, `${l.classeNumero}.${l.centroNumero} — ${l.centroNome}`, 'centro')
      noClasse.filhos.push(noCentro)
    }
    acumular(noCentro, l.valor, l.mes)

    const subcentroChave = `${centroChave}.${l.subcentroNumero}`
    let noSubcentro = noCentro.filhos.find((f) => f.chave === subcentroChave)
    if (!noSubcentro) {
      noSubcentro = novoNo(
        subcentroChave,
        `${l.classeNumero}.${l.centroNumero}.${l.subcentroNumero} — ${l.subcentroNome}`,
        'subcentro'
      )
      noCentro.filhos.push(noSubcentro)
    }
    acumular(noSubcentro, l.valor, l.mes)

    const produtoChave = `${subcentroChave}.${l.produtoNome}`
    let noProduto = noSubcentro.filhos.find((f) => f.chave === produtoChave)
    if (!noProduto) {
      noProduto = novoNo(produtoChave, l.produtoNome, 'produto')
      noSubcentro.filhos.push(noProduto)
    }
    acumular(noProduto, l.valor, l.mes)
  }

  // ordena por numero em cada nível (classe/centro/subcentro já vêm
  // com o numero no início do label — ordenar pelo próprio numero
  // extraído da chave evita depender de parsear o label)
  function ordenar(nos: NoArvore[]) {
    nos.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))
    for (const n of nos) ordenar(n.filhos)
  }
  const raiz = [...porTipo.values()]
  ordenar(raiz)
  return raiz
}

// lista de 'YYYY-MM' entre duas datas ISO (inclusive), pra montar as
// colunas do modo mensal
export function mesesDoIntervalo(dataInicio: string, dataFim: string): string[] {
  const meses: string[] = []
  let [ano, mes] = dataInicio.slice(0, 7).split('-').map(Number)
  const [anoFim, mesFim] = dataFim.slice(0, 7).split('-').map(Number)
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`)
    mes += 1
    if (mes > 12) {
      mes = 1
      ano += 1
    }
  }
  return meses
}

export function nomeMesCurto(anoMes: string) {
  const [ano, mesNum] = anoMes.split('-').map(Number)
  const data = new Date(ano, mesNum - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
}
