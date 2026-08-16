// mapeamento categoria de animal -> ícone realista (fotos de Nelore em
// public/icones-categoria/) usado no mapa de distribuição do rebanho por
// pasto (Painel e Rebanho por pasto). Decidido com o usuário a partir de
// um mockup revisado — ver CLAUDE.md ("Mapa de distribuição do rebanho").
import type { Era } from '@/lib/faixa-etaria'

export type CodigoIconeCategoria = 'TOURO' | 'VACA' | 'BOI' | 'GARROTE' | 'NOVILHA' | 'BEZERRO' | 'BEZERRA'

export type TierIcone = 'adulto' | 'jovem' | 'bezerro'

export const ICONE_SRC: Record<CodigoIconeCategoria, string> = {
  TOURO: '/icones-categoria/touro.png',
  VACA: '/icones-categoria/vaca.png',
  BOI: '/icones-categoria/boi.png',
  GARROTE: '/icones-categoria/garrote.png',
  NOVILHA: '/icones-categoria/novilha.png',
  BEZERRO: '/icones-categoria/bezerro.png',
  BEZERRA: '/icones-categoria/bezerra.png',
}

export const ICONE_TIER: Record<CodigoIconeCategoria, TierIcone> = {
  TOURO: 'adulto',
  VACA: 'adulto',
  BOI: 'adulto',
  GARROTE: 'jovem',
  NOVILHA: 'jovem',
  BEZERRO: 'bezerro',
  BEZERRA: 'bezerro',
}

// tamanho em pixels do ícone no mapa — jovem/bezerro deliberadamente mais
// perto do adulto do que uma proporção anatômica estrita sugeriria, pra
// não virarem uma mancha ilegível num marcador pequeno (ajustado com o
// usuário a partir do mockup, não é a proporção real de altura/peso)
export const TIER_SIZE_PX: Record<TierIcone, number> = { adulto: 40, jovem: 37, bezerro: 33 }

// papéis com ícone fixo, independente de sexo/era — cobre a maioria das
// categorias. "Garrotes e Bois" é o único papel que muda de ícone dentro
// dele mesmo (Garrote quando jovem, Boi quando adulto), tratado à parte
// em iconeParaCategoria.
const ICONE_POR_PAPEL: Record<string, CodigoIconeCategoria> = {
  'Bezerras Mamando': 'BEZERRA',
  'Bezerros Mamando': 'BEZERRO',
  Novilhas: 'NOVILHA',
  Touros: 'TOURO',
  'Matrizes em Reprodução': 'VACA',
  'Matrizes Descarte': 'VACA',
}

// fallback pro papel "Outros" (sexo livre, sem ícone próprio) — usa sexo +
// era em vez do papel, que nesse caso não diz nada sozinho. Touro fica de
// fora de propósito: só quem está de fato no papel "Touros" vira touro.
function iconePorSexoEEra(sexo: 'MACHO' | 'FEMEA', era: Era): CodigoIconeCategoria {
  if (era === '00-08') return sexo === 'FEMEA' ? 'BEZERRA' : 'BEZERRO'
  if (era === '08-12' || era === '12-24') return sexo === 'FEMEA' ? 'NOVILHA' : 'GARROTE'
  return sexo === 'FEMEA' ? 'VACA' : 'BOI'
}

export function iconeParaCategoria(papel: string, sexo: 'MACHO' | 'FEMEA', era: Era): CodigoIconeCategoria {
  if (papel === 'Garrotes e Bois') {
    return era === '24-36' || era === '36+' ? 'BOI' : 'GARROTE'
  }
  return ICONE_POR_PAPEL[papel] ?? iconePorSexoEEra(sexo, era)
}
