export const FAIXA_ETARIA_GRUPO: Record<string, string> = {
  BEZERRO: 'lactente — do nascimento ao desmame',
  JOVEM: 'do desmame aos 24 meses',
  ADULTO: 'acima de 24 meses',
}

export const ERAS = ['00-08', '08-12', '12-24', '24-36', '36+'] as const
export type Era = (typeof ERAS)[number]

export const GRUPO_FAIXA_ETARIA_POR_ERA: Record<Era, string> = {
  '00-08': 'BEZERRO',
  '08-12': 'JOVEM',
  '12-24': 'JOVEM',
  '24-36': 'ADULTO',
  '36+': 'ADULTO',
}

export const PAPEIS_BEZERRO_MAMANDO = ['Bezerras Mamando', 'Bezerros Mamando']
