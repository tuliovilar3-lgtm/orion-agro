// monta os dados do mapa de distribuição do rebanho por pasto (Painel e
// Rebanho por pasto) a partir do retorno cru de fn_relatorio_rebanho_por_pasto
// + a geometria/cor de cada pasto + o papel/sexo/era de cada categoria —
// puro, sem chamada ao Supabase, pra ser reaproveitado pelas duas telas
import type { Geometry } from 'geojson'
import type { Era } from '@/lib/faixa-etaria'
import { iconeParaCategoria, type CodigoIconeCategoria } from '@/lib/categoria-icones'
import type { CategoriaDistribuicao, PastoDistribuicao } from '@/components/fazendas/MapaDistribuicaoRebanho'

export type LinhaPastoRaw = {
  pasto_id: string
  pasto_nome: string
  categoria_id: string
  categoria_nome: string
  quantidade: number
  peso_medio_kg: number | null
}

export type PastoBaseInfo = {
  areaHa: number | null
  cor: string
  geometria: Geometry | null
  fazendaNome: string
}

export type CategoriaAnimalInfo = { papel: string; sexo: 'MACHO' | 'FEMEA'; era: Era }

export function montarDistribuicaoPorPasto(
  linhas: LinhaPastoRaw[],
  pastosBase: Map<string, PastoBaseInfo>,
  categoriasInfo: Map<string, CategoriaAnimalInfo>
): PastoDistribuicao[] {
  const porPasto = new Map<string, PastoDistribuicao>()

  for (const l of linhas) {
    const base = pastosBase.get(l.pasto_id)
    let pasto = porPasto.get(l.pasto_id)
    if (!pasto) {
      pasto = {
        id: l.pasto_id,
        nome: l.pasto_nome,
        fazendaNome: base?.fazendaNome ?? '',
        areaHa: base?.areaHa ?? null,
        geometria: base?.geometria ?? null,
        cor: base?.cor ?? '#1C8C7C',
        categorias: [],
      }
      porPasto.set(l.pasto_id, pasto)
    }

    const info = categoriasInfo.get(l.categoria_id)
    const codigo: CodigoIconeCategoria = info
      ? iconeParaCategoria(info.papel, info.sexo, info.era)
      : 'BOI' // fallback improvável — categoria sem info carregada ainda

    const existente = pasto.categorias.find((c) => c.codigo === codigo)
    if (existente) {
      // duas categorias do sistema podem cair no mesmo ícone (ex.: Garrote
      // 08-12 e 12-24 meses) — soma no mesmo marcador em vez de duplicar
      const pesoTotalAntigo = (existente.pesoMedio ?? 0) * existente.quantidade
      const pesoTotalNovo = (l.peso_medio_kg ?? 0) * l.quantidade
      existente.quantidade += l.quantidade
      existente.pesoMedio = existente.quantidade ? (pesoTotalAntigo + pesoTotalNovo) / existente.quantidade : null
    } else {
      const cat: CategoriaDistribuicao = {
        codigo,
        nome: l.categoria_nome,
        quantidade: l.quantidade,
        pesoMedio: l.peso_medio_kg,
      }
      pasto.categorias.push(cat)
    }
  }

  return [...porPasto.values()]
}
