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
  fazendaId: string
  fazendaNome: string
  moduloNome: string
}

export type CategoriaAnimalInfo = { papel: string; sexo: 'MACHO' | 'FEMEA'; era: Era }

// saldo de um proprietário específico pro mesmo (pasto, categoria) das linhas "totais" acima —
// mesma forma de LinhaPastoRaw, um array por proprietário cadastrado (na mesma ordem de
// `proprietarios`), pra decompor cada lote por dono. Só faz sentido buscar/passar quando a conta
// tem 2+ proprietários — ver "Selos do Rebanho: nome do proprietário junto ao lote" no CLAUDE.md
export type ProprietarioLinhas = { id: string; nome: string; linhas: LinhaPastoRaw[] }
export type ProprietarioQuantidade = { nome: string; quantidade: number }

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

// decompõe a linha (pasto+categoria) por proprietário — array vazio de partes com "Sem
// proprietário" cobrindo o resto quando nenhum dono conhecido explica a quantidade toda. Só
// calcula de fato com 2+ proprietários cadastrados (com 0 ou 1 nunca há o que distinguir).
function decomporProprietarios(
  l: LinhaPastoRaw,
  porProprietario: ProprietarioLinhas[] | undefined
): ProprietarioQuantidade[] | undefined {
  if (!porProprietario || porProprietario.length < 2) return undefined
  const partes: ProprietarioQuantidade[] = []
  let restante = l.quantidade
  for (const p of porProprietario) {
    const qtd =
      p.linhas.find((x) => x.pasto_id === l.pasto_id && x.categoria_id === l.categoria_id)?.quantidade ?? 0
    if (qtd > 0) {
      partes.push({ nome: p.nome, quantidade: qtd })
      restante -= qtd
    }
  }
  if (restante > 0) partes.push({ nome: 'Sem proprietário', quantidade: restante })
  return partes
}

// soma duas decomposições por nome — necessário porque 2+ categorias reais (ex.: Garrote 08-12
// e 12-24 meses) podem cair no mesmo ícone/marcador, cada uma com sua própria decomposição
function mesclarProprietarios(
  a: ProprietarioQuantidade[] | undefined,
  b: ProprietarioQuantidade[] | undefined
): ProprietarioQuantidade[] | undefined {
  if (!a) return b
  if (!b) return a
  const porNome = new Map(a.map((p) => [p.nome, p.quantidade]))
  for (const p of b) porNome.set(p.nome, (porNome.get(p.nome) ?? 0) + p.quantidade)
  return [...porNome.entries()].map(([nome, quantidade]) => ({ nome, quantidade }))
}

export function montarDistribuicaoPorPasto(
  linhas: LinhaPastoRaw[],
  pastosBase: Map<string, PastoBaseInfo>,
  categoriasInfo: Map<string, CategoriaAnimalInfo>,
  // só passado quando a conta tem 2+ proprietários — decompõe cada linha (pasto+categoria) por
  // dono, mesclando no mesmo marcador quando 2+ categorias reais caem no mesmo ícone
  porProprietario?: ProprietarioLinhas[]
): PastoDistribuicao[] {
  const porPasto = new Map<string, PastoDistribuicao>()

  // semeia todos os pastos conhecidos primeiro (mesmo sem nenhum animal
  // hoje) — sem isso o mapa só desenhava o contorno de quem tem rebanho,
  // escondendo os pastos vazios em vez de mostrar que estão livres
  for (const [id, base] of pastosBase) {
    porPasto.set(id, {
      id,
      nome: base.nome,
      fazendaId: base.fazendaId,
      fazendaNome: base.fazendaNome,
      moduloNome: base.moduloNome,
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
        fazendaId: base?.fazendaId ?? '',
        fazendaNome: base?.fazendaNome ?? '',
        moduloNome: base?.moduloNome ?? '',
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

    const decomposicao = decomporProprietarios(l, porProprietario)

    const existente = pasto.categorias.find((c) => c.codigo === codigo)
    if (existente) {
      // duas categorias do sistema podem cair no mesmo ícone (ex.: Garrote
      // 08-12 e 12-24 meses) — soma no mesmo marcador em vez de duplicar
      const pesoTotalAntigo = (existente.pesoMedio ?? 0) * existente.quantidade
      const pesoTotalNovo = (l.peso_medio_kg ?? 0) * l.quantidade
      existente.quantidade += l.quantidade
      existente.pesoMedio = existente.quantidade ? (pesoTotalAntigo + pesoTotalNovo) / existente.quantidade : null
      existente.porProprietario = mesclarProprietarios(existente.porProprietario, decomposicao)
    } else {
      const cat: CategoriaDistribuicao = {
        codigo,
        nome: l.categoria_nome,
        quantidade: l.quantidade,
        pesoMedio: l.peso_medio_kg,
        porProprietario: decomposicao,
      }
      pasto.categorias.push(cat)
    }
  }

  return [...porPasto.values()]
}
