// formatação padrão de números em todo o app (pt-BR: ponto separando
// milhar, vírgula separando decimal) — nunca usar toFixed()/interpolação
// crua de número em texto exibido ao usuário, sempre passar por uma
// dessas funções.

const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatadorQuantidade = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

const formatadorLotacao = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatadorGmd = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

// valores monetários — sempre "R$" + 2 casas decimais (ex.: "R$ 1.234,56")
export function formatMoeda(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return `R$ ${formatadorMoeda.format(n)}`
}

// quantidades (cabeças, itens) — sempre sem casas decimais (ex.: "1.234")
export function formatQuantidade(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return formatadorQuantidade.format(n)
}

// lotação (UA/ha) — sempre 2 casas decimais (ex.: "1,85")
export function formatLotacao(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return formatadorLotacao.format(n)
}

// GMD, ganho médio diário (kg) — sempre 3 casas decimais (ex.: "0,850")
export function formatGmd(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return formatadorGmd.format(n)
}

// área (ha) — mantém as 2 casas decimais fixas já usadas em Gestão de
// Áreas, agora também com separador de milhar
export function formatArea(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return formatadorLotacao.format(n)
}

// peso (kg), valor por arroba, percentuais etc. — grandezas contínuas
// que não são nem dinheiro nem contagem de cabeça; mesmo formato de
// 2 casas decimais + separador de milhar usado em área/lotação
export function formatPeso(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return formatadorLotacao.format(n)
}

export function formatDecimal(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  return formatadorLotacao.format(n)
}
