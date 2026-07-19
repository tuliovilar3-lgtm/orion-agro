// paleta categórica pros gráficos de relatório de movimentação (ranking
// de fornecedor/cliente, causa mortis, categoria etc.) — deriva dos
// tokens de marca + alguns tons complementares já usados na paleta de
// área (lib/area-cores.ts), mantendo a mesma identidade visual
const PALETA_CATEGORICA = [
  '#1C8C7C', // brand-500
  '#DB9A1F', // warning
  '#3b7cb0',
  '#c1662f',
  '#2E9E5B', // success
  '#6b7785',
  '#a9762c',
  '#8a5fb0',
]

export function corCategorica(indice: number) {
  return PALETA_CATEGORICA[indice % PALETA_CATEGORICA.length]
}

// par de cores pra divisões binárias (ex.: macho/fêmea, consumo/doação)
// — brand-500 + warning, nunca success puro (reservado pra "confirmação"
// em outras telas do sistema)
export const CORES_BINARIAS: [string, string] = ['#1C8C7C', '#DB9A1F']
