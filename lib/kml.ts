// parsing de KML pro mapa de fazenda (Fase 1) — usado tanto pro contorno
// da propriedade (um polígono só) quanto pro import de pastos/talhões já
// divididos no arquivo (um polígono por placemark, casado pelo nome)
import { kml } from '@tmcw/togeojson'
import area from '@turf/area'
import type { Geometry } from 'geojson'

export type FeatureNomeada = { nome: string; geometria: Geometry; areaHa: number }

// área calculada a partir da geometria — mesma regra de casas decimais
// já usada em toda área do sistema (formatArea, lib/format.ts)
export function calcularAreaHa(geometria: Geometry): number {
  const m2 = area(geometria)
  return Math.round((m2 / 10000) * 100) / 100
}

// extrai só os polígonos (ignora pontos/linhas que às vezes aparecem
// juntos num KML exportado de ferramentas de desenho) — cada um com o
// nome do placemark (pode vir vazio se o KML não nomeou)
export function parseKml(texto: string): FeatureNomeada[] {
  const doc = new DOMParser().parseFromString(texto, 'text/xml')
  const featureCollection = kml(doc)
  const resultado: FeatureNomeada[] = []
  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue
    const nome = String((feature.properties as Record<string, unknown> | null)?.name ?? '').trim()
    resultado.push({ nome, geometria: feature.geometry, areaHa: calcularAreaHa(feature.geometry) })
  }
  return resultado
}
