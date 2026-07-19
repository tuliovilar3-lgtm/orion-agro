export type SubtipoConsumoDoacao = 'CONSUMO_INTERNO' | 'DOACAO'

// linha bruta de movimentacoes_rebanho já com os relacionamentos
// necessários pros 8 relatórios por tipo — cada relatório usa só o
// subconjunto de campos que faz sentido pro seu tipo
export type MovimentacaoRelatorio = {
  id: string
  data: string
  tipo: string
  quantidade: number
  peso_medio_kg: number | null
  peso_total_kg: number | null
  peso_morto_kg: number | null
  rendimento_carcaca_pct: number | null
  valor_arroba: number | null
  valor_cabeca: number | null
  valor_kg: number | null
  valor_total: number | null
  causa_morte: string | null
  subtipo_consumo_doacao: SubtipoConsumoDoacao | null
  safra_nascimento_ano_inicio: number | null
  observacao: string | null
  fazenda_id: string | null
  fazenda_origem_id: string | null
  fazenda_destino_id: string | null
  categoria_id: string | null
  categoria_destino_id: string | null
  cliente_fornecedor_id: string | null
  fazenda: { nome: string } | null
  fazenda_origem: { nome: string } | null
  fazenda_destino: { nome: string } | null
  categoria: { nome: string; sexo: string; grupo: { nome: string } | null } | null
  categoria_destino: { nome: string } | null
  cliente: { nome: string } | null
  movimentacao_ajustes: { valor: number; item: { tipo: 'DESCONTO' | 'ACRESCIMO' } | null }[]
}

// valor líquido = bruto - descontos + acréscimos, igual usado em
// Movimentações — nunca persistido, sempre calculado na hora
export function valorLiquido(m: MovimentacaoRelatorio): number | null {
  if (m.valor_total == null) return null
  const ajustes = m.movimentacao_ajustes || []
  const desconto = ajustes.filter((a) => a.item?.tipo === 'DESCONTO').reduce((s, a) => s + a.valor, 0)
  const acrescimo = ajustes.filter((a) => a.item?.tipo === 'ACRESCIMO').reduce((s, a) => s + a.valor, 0)
  return m.valor_total - desconto + acrescimo
}

export function formatSafraNasc(ano: number | null) {
  if (ano == null) return '—'
  return `${ano}/${ano + 1}`
}

export function formatarDataBr(iso: string) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

export function nomeMes(anoMes: string) {
  const [ano, mesNum] = anoMes.split('-').map(Number)
  const data = new Date(ano, mesNum - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
}

export function mesDaLinha(iso: string) {
  return iso.slice(0, 7)
}

// agrupamento genérico — cada componente decide qual agregado extrair de
// cada grupo (soma de quantidade, média ponderada de peso, etc.)
export function agruparPorChave<T>(linhas: T[], chave: (linha: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const l of linhas) {
    const k = chave(l)
    if (!mapa.has(k)) mapa.set(k, [])
    mapa.get(k)!.push(l)
  }
  return mapa
}

// média ponderada pela quantidade (ou outro peso) — nunca média simples das
// médias por linha, seguindo a regra já estabelecida no resto do sistema
export function mediaPonderada(pares: { valor: number | null; peso: number }[]): number | null {
  let somaValor = 0
  let somaPeso = 0
  for (const p of pares) {
    if (p.valor == null || p.peso <= 0) continue
    somaValor += p.valor * p.peso
    somaPeso += p.peso
  }
  return somaPeso > 0 ? somaValor / somaPeso : null
}
