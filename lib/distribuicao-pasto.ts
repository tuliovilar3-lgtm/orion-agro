// monta os dados do mapa de distribuição do rebanho por pasto (Painel e
// Rebanho por pasto) a partir do retorno cru de fn_relatorio_rebanho_por_pasto
// + a geometria/cor de cada pasto + o papel/sexo/era de cada categoria —
// puro, sem chamada ao Supabase, pra ser reaproveitado pelas duas telas
import type { Geometry } from 'geojson'
import type { Era } from '@/lib/faixa-etaria'
import { iconeParaCategoria, type CodigoIconeCategoria } from '@/lib/categoria-icones'
import { corCategorica } from '@/lib/relatorio-cores'
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
  nome: string
  areaHa: number | null
  cor: string
  geometria: Geometry | null
  fazendaNome: string
}

export type CategoriaAnimalInfo = { papel: string; sexo: 'MACHO' | 'FEMEA'; era: Era }

// mesma regra de cor automática já usada em GestaoAreasPanel (pasto sem
// cor customizada usa a cor categórica do módulo, pela posição do módulo
// na fazenda) — reaproveitada aqui pro mapa de distribuição não pintar
// todo pasto sem cor própria da mesma cor. Índice reinicia por fazenda
// (cada fazenda tem sua própria sequência de módulos, igual à aba
// Gestão de Áreas, que só vê os módulos de uma fazenda por vez).
export function corPorModuloId(modulos: { id: string; fazendaId: string; ordem: number }[]): Map<string, string> {
  const porFazenda = new Map<string, { id: string; ordem: number }[]>()
  for (const m of modulos) {
    const lista = porFazenda.get(m.fazendaId) ?? []
    lista.push({ id: m.id, ordem: m.ordem })
    porFazenda.set(m.fazendaId, lista)
  }
  const resultado = new Map<string, string>()
  for (const lista of porFazenda.values()) {
    lista.sort((a, b) => a.ordem - b.ordem)
    lista.forEach((m, i) => resultado.set(m.id, corCategorica(i)))
  }
  return resultado
}

export function montarDistribuicaoPorPasto(
  linhas: LinhaPastoRaw[],
  pastosBase: Map<string, PastoBaseInfo>,
  categoriasInfo: Map<string, CategoriaAnimalInfo>
): PastoDistribuicao[] {
  const porPasto = new Map<string, PastoDistribuicao>()

  // semeia todos os pastos conhecidos primeiro (mesmo sem nenhum animal
  // hoje) — sem isso o mapa só desenhava o contorno de quem tem rebanho,
  // escondendo os pastos vazios em vez de mostrar que estão livres
  for (const [id, base] of pastosBase) {
    porPasto.set(id, {
      id,
      nome: base.nome,
      fazendaNome: base.fazendaNome,
      areaHa: base.areaHa,
      geometria: base.geometria,
      cor: base.cor,
      categorias: [],
    })
  }

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
