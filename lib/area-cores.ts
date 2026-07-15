export const COR_TIPO_USO_AREA: Record<string, string> = {
  'Reserva Legal/APP': '#2f6b3a',
  'Pecuária': '#1c8c7c',
  'Agricultura': '#a9762c',
  'Área em Reforma': '#c1662f',
  'Área Alagada': '#3b7cb0',
  'Infraestrutura': '#6b7785',
  'Outros': '#9a9a93',
}

export function corTipoUsoArea(nome: string) {
  return COR_TIPO_USO_AREA[nome] ?? '#9a9a93'
}
