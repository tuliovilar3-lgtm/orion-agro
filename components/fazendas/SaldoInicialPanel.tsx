'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ERAS, Era, FAIXA_ETARIA_GRUPO, GRUPO_FAIXA_ETARIA_POR_ERA, PAPEIS_BEZERRO_MAMANDO } from '@/lib/faixa-etaria'
import { safraSugeridaParaData } from '@/lib/periodo'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatQuantidade, formatPeso } from '@/lib/format'
import DetalheSafraBezerro, { type SafraDetalhe, safraDetalheInicial, safraRepresentativa } from '@/components/fazendas/DetalheSafraBezerro'

type Fazenda = {
  id: string
  nome: string
  saldo_inicial_confirmado: boolean
  saldo_inicial_confirmado_em: string | null
}

type LinhaSaldo = {
  categoriaId: string
  categoriaNome: string
  categoriaEhBezerro: boolean
  existingId: string | null
  quantidade: string
  pesoMedio: string
  safraNascimento: string
  // true quando essa categoria já tem o saldo dividido em 2+ pastos (só
  // possível vindo do modo "Saldo por Pasto") — a linha vira somatório
  // somente-leitura aqui, editável de verdade só na aba "Saldo por Pasto"
  multiPasto?: boolean
  // detalhamento por safra (migração 066) — sempre populado com pelo
  // menos 1 entrada quando categoriaEhBezerro; length > 1 = dividido de
  // verdade entre safras (ver DetalheSafraBezerro)
  detalheSafras: SafraDetalhe[]
}

type Sexo = 'MACHO' | 'FEMEA'
type GrupoCategoriaPapel = { id: string; nome: string; sexo: Sexo | null }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }
type Modulo = { id: string; fazenda_id: string; nome: string; ativo: boolean; ordem: number }
type Proprietario = { id: string; nome: string }

type Modo = 'categorias' | 'pasto'

type LinhaPastoCategoria = {
  id: string
  existingId: string | null
  categoriaId: string
  categoriaNome: string
  categoriaEhBezerro: boolean
  quantidade: string
  pesoMedio: string
  safraNascimento: string
  detalheSafras: SafraDetalhe[]
}

type BlocoPasto = {
  id: string
  pastoId: string
  linhas: LinhaPastoCategoria[]
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export default function SaldoInicialPanel({ fazendaId }: { fazendaId: string }) {
  const [fazendaSelecionada, setFazendaSelecionada] = useState<Fazenda | null>(null)
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhas, setLinhas] = useState<LinhaSaldo[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false)
  const [mostrarAvisoEdicao, setMostrarAvisoEdicao] = useState(false)

  const [papeis, setPapeis] = useState<GrupoCategoriaPapel[]>([])
  const [modalCategoriaAberto, setModalCategoriaAberto] = useState(false)
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('')
  const [novaCategoriaPapelId, setNovaCategoriaPapelId] = useState('')
  const [novaCategoriaSexo, setNovaCategoriaSexo] = useState<Sexo | ''>('')
  const [novaCategoriaEra, setNovaCategoriaEra] = useState<Era | ''>('')
  const [novaCategoriaPesoReferencia, setNovaCategoriaPesoReferencia] = useState('')
  const [salvandoCategoria, setSalvandoCategoria] = useState(false)

  const [pastos, setPastos] = useState<Pasto[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [controlaPasto, setControlaPasto] = useState(false)
  const [moduloId, setModuloId] = useState('')
  const [pastoId, setPastoId] = useState('')

  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
  const [proprietarioId, setProprietarioId] = useState('')

  // "Saldo por Pasto" — modo alternativo ao tradicional (uma linha por
  // categoria, um único pasto pra fazenda inteira): pasto vem primeiro,
  // depois categoria+quantidade+peso dentro de cada bloco de pasto. Só
  // aparece pra quem usa controle por pasto e tem 2+ pastos cadastrados
  // (com 0/1 pasto não há o que dividir).
  const [modo, setModo] = useState<Modo>('categorias')
  const [blocosPasto, setBlocosPasto] = useState<BlocoPasto[]>([])
  const [mostrarResumoPasto, setMostrarResumoPasto] = useState(false)
  const idsOriginaisPastoRef = useRef<Set<string>>(new Set())

  const supabase = createClient()

  // módulo → pasto é uma cascata de dois níveis — mesmo princípio já
  // usado em Movimentações/Mudança de Pasto/Pesagens
  const modulosDisponiveis = modulos.filter((m) => m.fazenda_id === fazendaId)
  const mostrarSeletorModulo = controlaPasto && modulosDisponiveis.length > 1
  const pastosDoModulo = pastos.filter((p) => p.modulo_id === moduloId)
  const mostrarSeletorPasto = controlaPasto && pastosDoModulo.length > 1

  const idsModulosDaFazenda = new Set(modulosDisponiveis.map((m) => m.id))
  const pastosDaFazenda = pastos.filter((p) => idsModulosDaFazenda.has(p.modulo_id))
  const mostrarModoPasto = controlaPasto && pastosDaFazenda.length > 1
  const modulosComPastos = modulosDisponiveis
    .map((m) => ({ modulo: m, pastos: pastosDaFazenda.filter((p) => p.modulo_id === m.id) }))
    .filter((g) => g.pastos.length > 0)

  // proprietário: lista global (lib de todo o sistema — ver movimentacoes/page.tsx),
  // um único proprietário por lançamento de saldo inicial, aplicado a todas as
  // categorias da fazenda (mesmo princípio já usado pro pasto acima). Com 0
  // cadastrado, salvar fica bloqueado (bloqueadoPorSemProprietario); com 1, some
  // sozinho e é atribuído automaticamente; só com 2+ o seletor aparece.
  const mostrarSeletorProprietario = proprietarios.length > 1
  const bloqueadoPorSemProprietario = proprietarios.length === 0

  function resolverProprietarioId(escolhidoId: string) {
    if (proprietarios.length === 1) return proprietarios[0].id
    return escolhidoId || null
  }

  const papelSelecionado = papeis.find((p) => p.id === novaCategoriaPapelId)
  const sexoEhLivre = !!papelSelecionado && papelSelecionado.sexo === null
  const isBezerroPapel = !!papelSelecionado && PAPEIS_BEZERRO_MAMANDO.includes(papelSelecionado.nome)
  const eraEfetiva: Era | '' = isBezerroPapel ? '00-08' : novaCategoriaEra

  useEffect(() => {
    supabase
      .from('grupos_categoria_papel')
      .select('id, nome, sexo')
      .order('ordem')
      .then(({ data }) => setPapeis(data || []))
    supabase
      .from('pastos')
      .select('id, modulo_id, nome, ativo, modulo:modulos!modulo_id(fazenda_id)')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => setPastos((data as unknown as Pasto[]) || []))
    supabase
      .from('modulos')
      .select('id, fazenda_id, nome, ativo, ordem')
      .eq('ativo', true)
      .order('ordem')
      .then(({ data }) => setModulos(data || []))
    supabase
      .from('configuracoes')
      .select('controla_pasto')
      .single()
      .then(({ data }) => setControlaPasto(data?.controla_pasto ?? false))
    supabase
      .from('pessoa_papeis')
      .select('pessoa:pessoas!pessoa_id(id, nome)')
      .eq('papel', 'PROPRIETARIO')
      .then(({ data }) =>
        setProprietarios(
          ((data || []) as any[])
            .map((r) => r.pessoa)
            .filter(Boolean)
            .sort((a: Proprietario, b: Proprietario) => a.nome.localeCompare(b.nome))
        )
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setNovaCategoriaSexo('')
    setNovaCategoriaEra('')
  }, [novaCategoriaPapelId])

  // módulo: some sozinho quando o seletor está escondido (grupo sem
  // controla_pasto, ou só um módulo ativo) — mesmo princípio já usado
  // em Movimentações e Controle de Pasto
  useEffect(() => {
    if (!mostrarSeletorModulo) {
      const geral = modulosDisponiveis.find((m) => m.nome === 'Geral') || modulosDisponiveis[0]
      setModuloId(geral ? geral.id : '')
    } else if (!modulosDisponiveis.some((m) => m.id === moduloId)) {
      setModuloId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarSeletorModulo, modulos, fazendaId])

  // pasto: some pro "Geral" sozinho quando o seletor está escondido —
  // depende do módulo selecionado acima
  useEffect(() => {
    if (!mostrarSeletorPasto) {
      const geral = pastosDoModulo.find((p) => p.nome === 'Geral') || pastosDoModulo[0]
      setPastoId(geral ? geral.id : '')
    } else if (!pastosDoModulo.some((p) => p.id === pastoId)) {
      setPastoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarSeletorPasto, pastos, moduloId])

  // proprietário: some sozinho quando só há 1 cadastrado — mesmo princípio do pasto
  useEffect(() => {
    if (!mostrarSeletorProprietario && proprietarios.length === 1) {
      setProprietarioId(proprietarios[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarSeletorProprietario, proprietarios])

  // deriva o módulo do pasto já salvo (carregarLinhas define pastoId a
  // partir da linha SALDO_INICIAL existente) sempre que pastos carrega —
  // evita uma corrida entre o carregamento de pastos/módulos (efeito de
  // montagem, sem depender de fazendaId) e o de linhas (depende de
  // fazendaId, roda em paralelo já na primeira montagem)
  useEffect(() => {
    if (!pastoId) return
    const pastoAtual = pastos.find((p) => p.id === pastoId)
    if (pastoAtual && pastoAtual.modulo_id !== moduloId) setModuloId(pastoAtual.modulo_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastoId, pastos])

  async function handleCriarCategoria(e: React.FormEvent) {
    e.preventDefault()
    if (!novaCategoriaNome.trim() || !novaCategoriaPapelId) return
    if (sexoEhLivre && !novaCategoriaSexo) return
    if (!isBezerroPapel && !novaCategoriaEra) return

    setSalvandoCategoria(true)
    const { error } = await supabase.from('categorias_animal').insert({
      nome: novaCategoriaNome.trim(),
      grupo_categoria_papel_id: novaCategoriaPapelId,
      sexo: sexoEhLivre ? novaCategoriaSexo : null,
      era: eraEfetiva,
      peso_referencia_kg: novaCategoriaPesoReferencia ? parseFloat(novaCategoriaPesoReferencia) : null,
    })

    if (error) {
      alert('Erro ao salvar categoria: ' + error.message)
    } else {
      setModalCategoriaAberto(false)
      setNovaCategoriaNome('')
      setNovaCategoriaPapelId('')
      setNovaCategoriaSexo('')
      setNovaCategoriaEra('')
      setNovaCategoriaPesoReferencia('')
      await carregarLinhas()
    }
    setSalvandoCategoria(false)
  }

  async function carregarLinhas() {
    setLoading(true)
    const [{ data: categorias }, { data: existentes }, { data: fazenda }] = await Promise.all([
      supabase
        .from('categorias_animal')
        .select('id, nome, ordem_ciclo, papel:grupos_categoria_papel(nome)')
        .eq('ativa', true)
        .order('ordem_ciclo')
        .order('nome'),
      supabase
        .from('movimentacoes_rebanho')
        .select('id, categoria_id, quantidade, peso_medio_kg, pasto_id, proprietario_id, data, safra_nascimento_ano_inicio')
        .eq('fazenda_id', fazendaId)
        .eq('tipo', 'SALDO_INICIAL'),
      supabase
        .from('fazendas')
        .select('id, nome, saldo_inicial_confirmado, saldo_inicial_confirmado_em')
        .eq('id', fazendaId)
        .single(),
    ])

    setFazendaSelecionada(fazenda || null)

    // Detalhamento por safra (migração 066) — uma linha de Saldo Inicial
    // de bezerro pode ter 0 (caso comum, usa a coluna simples da própria
    // linha), 1 (idem, guardado explicitamente) ou 2+ entradas aqui
    // (dividido de verdade entre safras).
    const idsSaldoInicial = (existentes || []).map((e) => e.id)
    const { data: safrasDetalhe } =
      idsSaldoInicial.length > 0
        ? await supabase
            .from('saldo_inicial_safras')
            .select('id, movimentacao_id, safra_nascimento_ano_inicio, quantidade')
            .in('movimentacao_id', idsSaldoInicial)
        : { data: [] as { id: string; movimentacao_id: string; safra_nascimento_ano_inicio: number; quantidade: number }[] }

    const detalhesPorMovimentacao = new Map<string, SafraDetalhe[]>()
    for (const s of safrasDetalhe || []) {
      const arr = detalhesPorMovimentacao.get(s.movimentacao_id) || []
      arr.push({ id: s.id, safra: String(s.safra_nascimento_ano_inicio), quantidade: String(s.quantidade) })
      detalhesPorMovimentacao.set(s.movimentacao_id, arr)
    }

    function detalheParaLinha(existenteRow: { id: string; quantidade: number; safra_nascimento_ano_inicio: number | null } | undefined): SafraDetalhe[] {
      if (!existenteRow) return safraDetalheInicial(null, data)
      const jaDetalhado = detalhesPorMovimentacao.get(existenteRow.id)
      if (jaDetalhado && jaDetalhado.length > 0) return jaDetalhado
      return safraDetalheInicial(
        existenteRow.safra_nascimento_ano_inicio != null ? String(existenteRow.safra_nascimento_ano_inicio) : null,
        data
      ).map((d) => ({ ...d, quantidade: String(existenteRow.quantidade) }))
    }

    // Agrupa por categoria primeiro — uma categoria pode ter mais de uma
    // linha existente (uma por pasto, vindo do modo "Saldo por Pasto"). No
    // modo "por Categorias" isso vira uma linha somatório somente-leitura
    // (multiPasto), pra nunca colapsar/perder a divisão por pasto ao
    // salvar por aqui sem querer.
    const porCategoria = new Map<string, typeof existentes>()
    for (const e of existentes || []) {
      const arr = porCategoria.get(e.categoria_id) || []
      arr.push(e)
      porCategoria.set(e.categoria_id, arr)
    }

    const mapaCategoriaInfo = new Map(
      (categorias || []).map((c) => {
        const papelNome = (c as unknown as { papel: { nome: string } | null }).papel?.nome
        return [c.id, { nome: c.nome, ehBezerro: !!papelNome && PAPEIS_BEZERRO_MAMANDO.includes(papelNome) }]
      })
    )

    const novasLinhas: LinhaSaldo[] = (categorias || []).map((c) => {
      const existentesDaCategoria = porCategoria.get(c.id) || []
      const papelNome = (c as unknown as { papel: { nome: string } | null }).papel?.nome
      const categoriaEhBezerro = !!papelNome && PAPEIS_BEZERRO_MAMANDO.includes(papelNome)

      if (existentesDaCategoria.length > 1) {
        const qtdTotal = existentesDaCategoria.reduce((s, e) => s + e.quantidade, 0)
        const pesoTotalSoma = existentesDaCategoria.reduce((s, e) => s + e.quantidade * (e.peso_medio_kg ?? 0), 0)
        return {
          categoriaId: c.id,
          categoriaNome: c.nome,
          categoriaEhBezerro,
          existingId: null,
          quantidade: String(qtdTotal),
          pesoMedio: qtdTotal > 0 ? String(round2(pesoTotalSoma / qtdTotal)) : '',
          safraNascimento: '',
          multiPasto: true,
          detalheSafras: [],
        }
      }

      const existente = existentesDaCategoria[0]
      return {
        categoriaId: c.id,
        categoriaNome: c.nome,
        categoriaEhBezerro,
        existingId: existente ? existente.id : null,
        quantidade: existente ? String(existente.quantidade) : '',
        pesoMedio: existente && existente.peso_medio_kg != null ? String(existente.peso_medio_kg) : '',
        safraNascimento: existente?.safra_nascimento_ano_inicio != null ? String(existente.safra_nascimento_ano_inicio) : '',
        detalheSafras: detalheParaLinha(existente),
      }
    })
    setLinhas(novasLinhas)

    // Monta os blocos do modo "Saldo por Pasto" a partir das mesmas linhas
    // existentes, agrupadas por pasto_id dessa vez.
    const porPasto = new Map<string, LinhaPastoCategoria[]>()
    for (const e of existentes || []) {
      const info = mapaCategoriaInfo.get(e.categoria_id)
      if (!info) continue
      const arr = porPasto.get(e.pasto_id) || []
      arr.push({
        id: e.id,
        existingId: e.id,
        categoriaId: e.categoria_id,
        categoriaNome: info.nome,
        categoriaEhBezerro: info.ehBezerro,
        quantidade: String(e.quantidade),
        pesoMedio: e.peso_medio_kg != null ? String(e.peso_medio_kg) : '',
        safraNascimento: e.safra_nascimento_ano_inicio != null ? String(e.safra_nascimento_ano_inicio) : '',
        detalheSafras: detalheParaLinha(e),
      })
      porPasto.set(e.pasto_id, arr)
    }
    idsOriginaisPastoRef.current = new Set((existentes || []).map((e) => e.id))
    const novosBlocos: BlocoPasto[] = Array.from(porPasto.entries()).map(([pId, linhasDoBloco]) => ({
      id: pId,
      pastoId: pId,
      linhas: linhasDoBloco,
    }))
    setBlocosPasto(
      novosBlocos.length > 0
        ? novosBlocos
        : [{ id: crypto.randomUUID(), pastoId: '', linhas: [] }]
    )

    const primeiraData = (existentes || [])[0]?.data
    if (primeiraData) setData(primeiraData)
    const primeiroPastoId = (existentes || [])[0]?.pasto_id
    if (primeiroPastoId) setPastoId(primeiroPastoId)
    const primeiroProprietarioId = (existentes || [])[0]?.proprietario_id
    if (primeiroProprietarioId) setProprietarioId(primeiroProprietarioId)

    setLoading(false)
  }

  useEffect(() => {
    carregarLinhas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  function atualizarLinha(categoriaId: string, campo: 'quantidade' | 'pesoMedio' | 'safraNascimento', valor: string) {
    setLinhas((prev) => prev.map((l) => (l.categoriaId === categoriaId ? { ...l, [campo]: valor } : l)))
  }

  function atualizarDetalheSafra(categoriaId: string, novo: SafraDetalhe[]) {
    setLinhas((prev) => prev.map((l) => (l.categoriaId === categoriaId ? { ...l, detalheSafras: novo } : l)))
  }

  // --- modo "Saldo por Pasto" ---------------------------------------

  function mudarPastoBloco(blocoId: string, pastoId: string) {
    setBlocosPasto((prev) => prev.map((b) => (b.id === blocoId ? { ...b, pastoId } : b)))
  }

  function atualizarLinhaPasto(
    blocoId: string,
    linhaId: string,
    campo: 'categoriaId' | 'quantidade' | 'pesoMedio' | 'safraNascimento',
    valor: string
  ) {
    setBlocosPasto((prev) =>
      prev.map((b) => {
        if (b.id !== blocoId) return b
        return {
          ...b,
          linhas: b.linhas.map((l) => {
            if (l.id !== linhaId) return l
            if (campo === 'categoriaId') {
              const info = linhas.find((x) => x.categoriaId === valor)
              return {
                ...l,
                categoriaId: valor,
                categoriaNome: info?.categoriaNome ?? '',
                categoriaEhBezerro: info?.categoriaEhBezerro ?? false,
                // trocar de categoria invalida qualquer detalhamento por
                // safra que já existisse (era de outra categoria)
                detalheSafras: safraDetalheInicial(null, data),
              }
            }
            return { ...l, [campo]: valor }
          }),
        }
      })
    )
  }

  function atualizarDetalheSafraPasto(blocoId: string, linhaId: string, novo: SafraDetalhe[]) {
    setBlocosPasto((prev) =>
      prev.map((b) =>
        b.id === blocoId
          ? { ...b, linhas: b.linhas.map((l) => (l.id === linhaId ? { ...l, detalheSafras: novo } : l)) }
          : b
      )
    )
  }

  function adicionarCategoriaNoBloco(blocoId: string) {
    const primeiraCategoria = linhas[0]
    if (!primeiraCategoria) return
    setBlocosPasto((prev) =>
      prev.map((b) =>
        b.id === blocoId
          ? {
              ...b,
              linhas: [
                ...b.linhas,
                {
                  id: crypto.randomUUID(),
                  existingId: null,
                  categoriaId: primeiraCategoria.categoriaId,
                  categoriaNome: primeiraCategoria.categoriaNome,
                  categoriaEhBezerro: primeiraCategoria.categoriaEhBezerro,
                  quantidade: '',
                  pesoMedio: '',
                  safraNascimento: '',
                  detalheSafras: safraDetalheInicial(null, data),
                },
              ],
            }
          : b
      )
    )
  }

  function removerCategoriaDoBloco(blocoId: string, linhaId: string) {
    setBlocosPasto((prev) =>
      prev.map((b) => (b.id === blocoId ? { ...b, linhas: b.linhas.filter((l) => l.id !== linhaId) } : b))
    )
  }

  function adicionarBlocoPasto() {
    const primeiraCategoria = linhas[0]
    setBlocosPasto((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        pastoId: '',
        linhas: primeiraCategoria
          ? [
              {
                id: crypto.randomUUID(),
                existingId: null,
                categoriaId: primeiraCategoria.categoriaId,
                categoriaNome: primeiraCategoria.categoriaNome,
                categoriaEhBezerro: primeiraCategoria.categoriaEhBezerro,
                quantidade: '',
                pesoMedio: '',
                safraNascimento: '',
                detalheSafras: safraDetalheInicial(null, data),
              },
            ]
          : [],
      },
    ])
  }

  function removerBlocoPasto(blocoId: string) {
    setBlocosPasto((prev) => (prev.length <= 1 ? prev : prev.filter((b) => b.id !== blocoId)))
  }

  const totalGeralPasto = blocosPasto.reduce(
    (s, b) => s + b.linhas.reduce((s2, l) => s2 + (parseInt(l.quantidade, 10) || 0), 0),
    0
  )

  const resumoPorCategoriaPasto = (() => {
    const mapa = new Map<string, { qtd: number; pesoTotal: number }>()
    for (const bloco of blocosPasto) {
      for (const l of bloco.linhas) {
        const qtd = parseInt(l.quantidade, 10) || 0
        const peso = parseFloat(l.pesoMedio) || 0
        const atual = mapa.get(l.categoriaNome) || { qtd: 0, pesoTotal: 0 }
        atual.qtd += qtd
        atual.pesoTotal += qtd * peso
        mapa.set(l.categoriaNome, atual)
      }
    }
    return Array.from(mapa.entries())
      .map(([nome, d]) => ({ nome, qtd: d.qtd, pesoMedio: d.qtd > 0 ? round2(d.pesoTotal / d.qtd) : null }))
      .sort((a, b) => b.qtd - a.qtd)
  })()

  // soma das linhas de detalhamento por safra precisa bater exatamente com
  // a quantidade da categoria — mesma invariante que o banco cobra
  // (fn_validar_soma_saldo_inicial_safra, migração 066), checada aqui
  // antes pra dar um aviso amigável em vez de deixar o erro estourar cru
  function encontrarErroDetalheSafra(itens: { categoriaNome: string; quantidade: string; detalheSafras: SafraDetalhe[] }[]): string | null {
    for (const item of itens) {
      if (item.detalheSafras.length <= 1) continue
      const total = parseInt(item.quantidade, 10) || 0
      const soma = item.detalheSafras.reduce((s, d) => s + (parseInt(d.quantidade, 10) || 0), 0)
      if (soma !== total) {
        return `A soma das safras de "${item.categoriaNome}" (${soma}) precisa bater com a quantidade da categoria (${total}).`
      }
    }
    return null
  }

  // safra gravada na coluna da linha-mãe: quando dividido, a safra
  // "representativa" (maior quantidade); senão, o valor único informado
  function resolverSafraColuna(categoriaEhBezerro: boolean, detalheSafras: SafraDetalhe[]): number | null {
    if (!categoriaEhBezerro) return null
    if (detalheSafras.length > 1) return safraRepresentativa(detalheSafras)
    return detalheSafras[0]?.safra ? parseInt(detalheSafras[0].safra, 10) : safraSugeridaParaData(data)
  }

  // Grava a linha-mãe (insert ou update) + o detalhamento por safra numa
  // única transação via RPC — as triggers de constraint adiáveis
  // (migrações 066/068) só protegem corretamente dentro de UMA transação,
  // e duas chamadas separadas do supabase-js (update da linha-mãe, depois
  // apaga-e-reinsere do detalhamento) cada uma vira sua própria transação
  // com auto-commit, quebrando no meio sempre que a quantidade e o
  // detalhamento mudam juntos. Devolve o id da linha (novo ou existente),
  // ou null se deu erro (já reportado via alert).
  async function salvarLinhaSaldoInicial(params: {
    movimentacaoId: string | null
    categoriaId: string
    quantidade: number
    pesoMedio: number
    pastoId: string
    proprietarioId: string | null
    categoriaEhBezerro: boolean
    detalheSafras: SafraDetalhe[]
  }): Promise<string | null> {
    const pesoTotal = round2(params.pesoMedio * params.quantidade)
    const safraColuna = resolverSafraColuna(params.categoriaEhBezerro, params.detalheSafras)
    const detalhamento = params.categoriaEhBezerro
      ? params.detalheSafras.map((d) => ({ safra: parseInt(d.safra, 10) || 0, quantidade: parseInt(d.quantidade, 10) || 0 }))
      : []

    const { data: idSalvo, error } = await supabase.rpc('fn_salvar_linha_saldo_inicial', {
      p_movimentacao_id: params.movimentacaoId,
      p_fazenda_id: fazendaId,
      p_categoria_id: params.categoriaId,
      p_data: data,
      p_quantidade: params.quantidade,
      p_peso_medio_kg: params.pesoMedio,
      p_peso_total_kg: pesoTotal,
      p_pasto_id: params.pastoId,
      p_proprietario_id: params.proprietarioId,
      p_safra_coluna: safraColuna,
      p_detalhamento: detalhamento,
    })

    if (error) {
      alert('Erro ao salvar: ' + error.message)
      return null
    }
    return idSalvo as unknown as string
  }

  function handleSalvarClick() {
    const incompletas = linhas.filter((l) => (!!l.quantidade) !== (!!l.pesoMedio))
    if (incompletas.length > 0) {
      alert(
        `Preencha quantidade e peso médio juntos (ou deixe os dois em branco) em: ${incompletas
          .map((l) => l.categoriaNome)
          .join(', ')}`
      )
      return
    }

    const erroSafra = encontrarErroDetalheSafra(linhas)
    if (erroSafra) {
      alert(erroSafra)
      return
    }

    if (!pastoId) {
      alert('Selecione o pasto.')
      return
    }

    if (mostrarSeletorProprietario && !proprietarioId) {
      alert('Selecione o proprietário.')
      return
    }

    if (confirmado) {
      setMostrarAvisoEdicao(true)
    } else {
      executarSalvar()
    }
  }

  async function executarSalvar() {
    setMostrarAvisoEdicao(false)
    setSalvando(true)

    for (const linha of linhas) {
      // categoria já dividida em 2+ pastos é só leitura aqui (não tem um
      // existingId único pra atualizar) — editar de verdade só na aba
      // "Saldo por Pasto", senão salvar aqui criaria uma linha nova
      // duplicando o que já existe por pasto.
      if (linha.multiPasto) continue

      const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : 0
      const pesoMedioNum = linha.pesoMedio ? parseFloat(linha.pesoMedio) : 0
      const linhaCompleta = quantidadeNum > 0 && pesoMedioNum > 0
      const linhaVazia = !linha.quantidade && !linha.pesoMedio

      if (linhaCompleta) {
        const proprietarioResolvido = resolverProprietarioId(proprietarioId)
        await salvarLinhaSaldoInicial({
          movimentacaoId: linha.existingId,
          categoriaId: linha.categoriaId,
          quantidade: quantidadeNum,
          pesoMedio: pesoMedioNum,
          pastoId,
          proprietarioId: proprietarioResolvido,
          categoriaEhBezerro: linha.categoriaEhBezerro,
          detalheSafras: linha.detalheSafras,
        })
      } else if (linhaVazia && linha.existingId) {
        await supabase.from('movimentacoes_rebanho').delete().eq('id', linha.existingId)
      }
    }

    await carregarLinhas()
    setSalvando(false)
  }

  function handleSalvarPorPastoClick() {
    for (const bloco of blocosPasto) {
      if (!bloco.pastoId) {
        alert('Selecione o pasto em todos os blocos antes de salvar.')
        return
      }
      const incompletas = bloco.linhas.filter((l) => (!!l.quantidade) !== (!!l.pesoMedio))
      if (incompletas.length > 0) {
        alert(
          `Preencha quantidade e peso médio juntos (ou deixe os dois em branco) em: ${incompletas
            .map((l) => l.categoriaNome)
            .join(', ')}`
        )
        return
      }
      const vistas = new Set<string>()
      for (const l of bloco.linhas) {
        if (vistas.has(l.categoriaId)) {
          alert(`A categoria "${l.categoriaNome}" aparece mais de uma vez no mesmo pasto — some numa linha só.`)
          return
        }
        vistas.add(l.categoriaId)
      }

      const erroSafra = encontrarErroDetalheSafra(bloco.linhas)
      if (erroSafra) {
        alert(erroSafra)
        return
      }
    }

    if (mostrarSeletorProprietario && !proprietarioId) {
      alert('Selecione o proprietário.')
      return
    }

    if (confirmado) {
      setMostrarAvisoEdicao(true)
    } else {
      executarSalvarPorPasto()
    }
  }

  async function executarSalvarPorPasto() {
    setMostrarAvisoEdicao(false)
    setSalvando(true)

    const idsSalvos = new Set<string>()
    for (const bloco of blocosPasto) {
      for (const linha of bloco.linhas) {
        const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : 0
        const pesoMedioNum = linha.pesoMedio ? parseFloat(linha.pesoMedio) : 0
        const linhaCompleta = quantidadeNum > 0 && pesoMedioNum > 0
        if (!linhaCompleta) continue

        const proprietarioResolvido = resolverProprietarioId(proprietarioId)

        if (linha.existingId) idsSalvos.add(linha.existingId)
        const idSalvo = await salvarLinhaSaldoInicial({
          movimentacaoId: linha.existingId,
          categoriaId: linha.categoriaId,
          quantidade: quantidadeNum,
          pesoMedio: pesoMedioNum,
          pastoId: bloco.pastoId,
          proprietarioId: proprietarioResolvido,
          categoriaEhBezerro: linha.categoriaEhBezerro,
          detalheSafras: linha.detalheSafras,
        })
        if (idSalvo) idsSalvos.add(idSalvo)
      }
    }

    // linhas que existiam no banco antes de abrir esse formulário e não
    // sobraram na lista atual (categoria/bloco removido, ou esvaziado) —
    // mesmo princípio de "apaga e reinsere" já usado noutras listas
    // filhas do sistema, só que aqui via update-in-place + delete
    // explícito das que saíram.
    for (const idAntigo of idsOriginaisPastoRef.current) {
      if (!idsSalvos.has(idAntigo)) {
        await supabase.from('movimentacoes_rebanho').delete().eq('id', idAntigo)
      }
    }

    await carregarLinhas()
    setSalvando(false)
  }

  function handleSalvarClickAtual() {
    if (modo === 'categorias') handleSalvarClick()
    else handleSalvarPorPastoClick()
  }

  function executarSalvarAtual() {
    if (modo === 'categorias') return executarSalvar()
    return executarSalvarPorPasto()
  }

  async function handleConfirmar() {
    setSalvando(true)
    const { error } = await supabase
      .from('fazendas')
      .update({ saldo_inicial_confirmado: true, saldo_inicial_confirmado_em: new Date().toISOString() })
      .eq('id', fazendaId)

    if (error) {
      alert('Erro ao confirmar: ' + error.message)
    } else {
      await carregarLinhas()
    }
    setMostrarConfirmacao(false)
    setSalvando(false)
  }

  const confirmado = fazendaSelecionada?.saldo_inicial_confirmado ?? false
  const totalCabecas = linhas.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)
  const totalPesoKg = linhas.reduce((s, l) => {
    const qtd = parseInt(l.quantidade, 10) || 0
    const peso = parseFloat(l.pesoMedio) || 0
    return s + qtd * peso
  }, 0)
  const pesoMedioPonderado = totalCabecas > 0 ? round2(totalPesoKg / totalCabecas) : null
  const existeCategoriaBezerro = linhas.some((l) => l.categoriaEhBezerro)

  const inputClass =
    'rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500'

  return (
    <div>
      <p className="text-sm text-text-secondary">
        Cadastre a quantidade de animais e o peso médio de cada categoria no momento em que a fazenda começou a
        usar o sistema. Depois de confirmado, o saldo inicial ainda pode ser corrigido se necessário, mas cada
        alteração pede uma confirmação extra — e nunca é permitido deixar o estoque negativo em nenhum momento.
      </p>

      {mostrarModoPasto && (
        <div className="mt-4 flex gap-1 border-b border-border">
          <button
            type="button"
            onClick={() => setModo('categorias')}
            className={`px-4 py-2 text-sm font-semibold ${
              modo === 'categorias'
                ? 'border-b-2 border-brand-500 text-brand-500'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Saldo por Categorias
          </button>
          <button
            type="button"
            onClick={() => setModo('pasto')}
            className={`px-4 py-2 text-sm font-semibold ${
              modo === 'pasto'
                ? 'border-b-2 border-brand-500 text-brand-500'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Saldo por Pasto
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Data de referência</label>
          <input type="date" className={inputClass} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        {modo === 'categorias' && mostrarSeletorModulo && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Módulo
              <Required />
            </label>
            <select className={inputClass} value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
              <option value="">Selecione...</option>
              {modulosDisponiveis.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        {modo === 'categorias' && mostrarSeletorPasto && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Pasto
              <Required />
            </label>
            <select className={inputClass} value={pastoId} onChange={(e) => setPastoId(e.target.value)}>
              <option value="">Selecione...</option>
              {pastosDoModulo.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        {mostrarSeletorProprietario && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Proprietário
              <Required />
            </label>
            <select className={inputClass} value={proprietarioId} onChange={(e) => setProprietarioId(e.target.value)}>
              <option value="">Selecione...</option>
              {proprietarios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
      ) : bloqueadoPorSemProprietario ? (
        <div className="mt-4 rounded-control border border-error bg-error-bg px-4 py-3 text-sm text-error">
          Nenhum proprietário cadastrado ainda — todo animal precisa ter um dono atribuído. Cadastre pelo menos
          um proprietário antes de declarar o saldo inicial.{' '}
          <a href="/pessoas" className="font-medium underline">
            Ir para Pessoas e Empresas
          </a>
        </div>
      ) : (
        <>
          {confirmado && (
            <div className="mt-4 rounded-control border border-success bg-success-bg px-4 py-3 text-sm text-text-primary">
              Saldo inicial confirmado em{' '}
              {fazendaSelecionada?.saldo_inicial_confirmado_em
                ? new Date(fazendaSelecionada.saldo_inicial_confirmado_em).toLocaleString('pt-BR')
                : '—'}
              . Ainda pode ser ajustado, mas cada alteração pede uma confirmação extra.
            </div>
          )}

          {modo === 'categorias' && (
            <>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="text-sm font-medium text-brand-500 underline"
                  onClick={() => setModalCategoriaAberto(true)}
                >
                  + Nova categoria
                </button>
              </div>

              <div className="mt-2 overflow-x-auto rounded-card border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-secondary">
                      <th className="p-2.5 font-medium">Categoria</th>
                      <th className="p-2.5 text-right font-medium">Quantidade</th>
                      <th className="p-2.5 text-right font-medium">Peso médio (kg)</th>
                      <th className="p-2.5 text-right font-medium">Peso total (kg)</th>
                      {existeCategoriaBezerro && <th className="p-2.5 text-left font-medium">Safra do bezerro</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const qtd = parseInt(l.quantidade, 10) || 0
                      const peso = parseFloat(l.pesoMedio) || 0
                      const pesoTotal = qtd && peso ? round2(qtd * peso) : null
                      if (l.multiPasto) {
                        return (
                          <tr key={l.categoriaId} className="border-b border-border last:border-0 bg-bg">
                            <td className="p-2.5 text-text-primary">
                              {l.categoriaNome}
                              <div className="mt-0.5 text-xs text-text-muted">
                                Dividido entre pastos — edite na aba &ldquo;Saldo por Pasto&rdquo;
                              </div>
                            </td>
                            <td className="p-2.5 text-right tabular-nums text-text-secondary">{formatQuantidade(qtd)}</td>
                            <td className="p-2.5 text-right tabular-nums text-text-secondary">{peso ? formatPeso(peso) : '—'}</td>
                            <td className="p-2.5 text-right tabular-nums text-text-secondary">
                              {pesoTotal != null ? formatPeso(pesoTotal) : '—'}
                            </td>
                            {existeCategoriaBezerro && <td className="p-2.5"></td>}
                          </tr>
                        )
                      }
                      return (
                        <tr key={l.categoriaId} className="border-b border-border last:border-0">
                          <td className="p-2.5 text-text-primary">{l.categoriaNome}</td>
                          <td className="p-2.5 text-right">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className={`w-24 text-right ${inputClass}`}
                              value={l.quantidade}
                              onChange={(e) => atualizarLinha(l.categoriaId, 'quantidade', e.target.value)}
                            />
                          </td>
                          <td className="p-2.5 text-right">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              className={`w-24 text-right ${inputClass}`}
                              value={l.pesoMedio}
                              onChange={(e) => atualizarLinha(l.categoriaId, 'pesoMedio', e.target.value)}
                            />
                          </td>
                          <td className="p-2.5 text-right tabular-nums text-text-secondary">
                            {pesoTotal != null ? formatPeso(pesoTotal) : '—'}
                          </td>
                          {existeCategoriaBezerro && (
                            <td className="p-2.5">
                              {l.categoriaEhBezerro && (
                                <DetalheSafraBezerro
                                  quantidadeTotal={qtd}
                                  dataReferencia={data}
                                  detalhes={l.detalheSafras}
                                  onChange={(novo) => atualizarDetalheSafra(l.categoriaId, novo)}
                                />
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="p-2.5 text-text-primary">Total</td>
                      <td className="p-2.5 text-right tabular-nums text-text-primary">{formatQuantidade(totalCabecas)}</td>
                      <td className="p-2.5 text-right tabular-nums text-text-primary">
                        {pesoMedioPonderado != null ? formatPeso(pesoMedioPonderado) : '—'}
                      </td>
                      <td className="p-2.5 text-right tabular-nums text-text-primary">
                        {totalCabecas > 0 ? formatPeso(round2(totalPesoKg)) : '—'}
                      </td>
                      {existeCategoriaBezerro && <td className="p-2.5"></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {modo === 'pasto' && (
            <div className="mt-4 space-y-4">
              {blocosPasto.map((bloco) => {
                const subtotalBloco = bloco.linhas.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)
                return (
                  <div key={bloco.id} className="overflow-hidden rounded-card border border-border">
                    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-brand-100 px-4 py-3">
                      <span className="text-xs font-bold uppercase tracking-wide text-text-secondary">Pasto</span>
                      <select
                        className={`${inputClass} max-w-[320px] flex-1 font-semibold`}
                        value={bloco.pastoId}
                        onChange={(e) => mudarPastoBloco(bloco.id, e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {modulosComPastos.map((g) => (
                          <optgroup key={g.modulo.id} label={g.modulo.nome}>
                            {g.pastos.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <span className="ml-auto text-xs text-text-secondary">
                        <b className="text-text-primary">{formatQuantidade(subtotalBloco)}</b> cabeças nesse pasto
                      </span>
                      <button
                        type="button"
                        title="Remover pasto"
                        disabled={blocosPasto.length <= 1}
                        onClick={() => removerBlocoPasto(bloco.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-control border border-border text-text-muted hover:border-error hover:text-error disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-2.5 p-4">
                      {bloco.linhas.map((linha) => (
                        <div
                          key={linha.id}
                          className={`grid grid-cols-2 items-end gap-3 rounded-control border border-border p-3 sm:grid-cols-4 ${
                            linha.categoriaEhBezerro ? 'sm:grid-cols-5' : ''
                          }`}
                        >
                          <div className="col-span-2 sm:col-span-1">
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">
                              Categoria
                            </label>
                            <select
                              className={`w-full ${inputClass}`}
                              value={linha.categoriaId}
                              onChange={(e) => atualizarLinhaPasto(bloco.id, linha.id, 'categoriaId', e.target.value)}
                            >
                              {linhas.map((c) => (
                                <option key={c.categoriaId} value={c.categoriaId}>
                                  {c.categoriaNome}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">
                              Quantidade
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className={`w-full ${inputClass}`}
                              value={linha.quantidade}
                              onChange={(e) => atualizarLinhaPasto(bloco.id, linha.id, 'quantidade', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">
                              Peso médio (kg)
                            </label>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              className={`w-full ${inputClass}`}
                              value={linha.pesoMedio}
                              onChange={(e) => atualizarLinhaPasto(bloco.id, linha.id, 'pesoMedio', e.target.value)}
                            />
                          </div>
                          {linha.categoriaEhBezerro && (
                            <div>
                              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">
                                Safra <Required />
                              </label>
                              <DetalheSafraBezerro
                                quantidadeTotal={parseInt(linha.quantidade, 10) || 0}
                                dataReferencia={data}
                                detalhes={linha.detalheSafras}
                                onChange={(novo) => atualizarDetalheSafraPasto(bloco.id, linha.id, novo)}
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            title="Remover categoria"
                            onClick={() => removerCategoriaDoBloco(bloco.id, linha.id)}
                            className="flex h-9 w-9 items-center justify-center justify-self-end rounded-control border border-border text-text-muted hover:border-error hover:text-error"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => adicionarCategoriaNoBloco(bloco.id)}
                        className="rounded-control border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-brand-500 hover:border-brand-500 hover:bg-brand-100"
                      >
                        + Adicionar categoria
                      </button>
                    </div>
                  </div>
                )
              })}

              <button
                type="button"
                onClick={adicionarBlocoPasto}
                className="w-full rounded-card border border-dashed border-brand-500 bg-brand-100/40 py-3 text-sm font-bold text-brand-500 hover:bg-brand-100"
              >
                + Adicionar pasto
              </button>

              <div className="overflow-hidden rounded-card border border-border">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-bold text-text-secondary">Total geral (todos os pastos)</span>
                  <span className="text-lg font-extrabold tabular-nums text-text-primary">
                    {formatQuantidade(totalGeralPasto)} cabeças
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarResumoPasto((v) => !v)}
                  className="flex w-full items-center gap-2 border-t border-border px-4 py-2.5 text-left text-xs font-bold text-brand-500"
                >
                  <span className={`transition-transform ${mostrarResumoPasto ? 'rotate-90' : ''}`}>▸</span>
                  Ver quantidade e peso médio por categoria
                </button>
                {mostrarResumoPasto && (
                  <div className="border-t border-border px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                          <th className="pb-2 font-bold">Categoria</th>
                          <th className="pb-2 text-right font-bold">Quantidade</th>
                          <th className="pb-2 text-right font-bold">Peso médio (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumoPorCategoriaPasto.map((r) => (
                          <tr key={r.nome} className="border-t border-border">
                            <td className="py-1.5 text-text-primary">{r.nome}</td>
                            <td className="py-1.5 text-right tabular-nums text-text-primary">{formatQuantidade(r.qtd)}</td>
                            <td className="py-1.5 text-right tabular-nums text-text-secondary">
                              {r.pesoMedio != null ? formatPeso(r.pesoMedio) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {!mostrarAvisoEdicao ? (
              <button
                type="button"
                disabled={salvando}
                onClick={handleSalvarClickAtual}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            ) : (
              <div className="rounded-control border border-warning bg-warning-bg p-3 text-sm">
                <p className="mb-2 text-text-primary">
                  O saldo inicial desta fazenda já foi confirmado. Alterar esses valores agora pode impactar
                  relatórios e apurações que já usaram esses números. O sistema não vai deixar o estoque ficar
                  negativo em nenhum momento, mas confirme que você realmente quer fazer esse ajuste.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-control border border-border px-4 py-2 text-text-primary"
                    onClick={() => setMostrarAvisoEdicao(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={salvando}
                    className="rounded-control bg-warning px-4 py-2 font-semibold text-white disabled:opacity-50"
                    onClick={executarSalvarAtual}
                  >
                    Sim, ajustar saldo inicial
                  </button>
                </div>
              </div>
            )}

            {!confirmado &&
              (!mostrarConfirmacao ? (
                <div>
                  <button
                    type="button"
                    className="text-sm text-text-secondary underline"
                    onClick={() => setMostrarConfirmacao(true)}
                  >
                    Confirmar saldo inicial
                  </button>
                </div>
              ) : (
                <div className="rounded-control border border-border bg-bg p-3 text-sm">
                  <p className="mb-2 text-text-primary">
                    Confirma que esse é o saldo inicial correto desta fazenda? Você ainda poderá corrigi-lo depois,
                    mas cada alteração passará a pedir essa mesma confirmação.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-control border border-border px-4 py-2 text-text-primary"
                      onClick={() => setMostrarConfirmacao(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={salvando}
                      className="rounded-control bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                      onClick={handleConfirmar}
                    >
                      Sim, confirmar saldo inicial
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {modalCategoriaAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={handleCriarCategoria}
            onKeyDown={bloquearEnvioPorEnter}
            className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5"
          >
            <h2 className="text-sm font-semibold text-text-primary">Nova categoria</h2>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Nome
                <Required />
              </label>
              <input
                className={`w-full ${inputClass}`}
                value={novaCategoriaNome}
                onChange={(e) => setNovaCategoriaNome(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Grupo Categoria
                <Required />
              </label>
              <select
                className={`w-full ${inputClass}`}
                value={novaCategoriaPapelId}
                onChange={(e) => setNovaCategoriaPapelId(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {papeis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.sexo ? ` (${p.sexo === 'MACHO' ? 'Macho' : 'Fêmea'})` : ' (sexo livre)'}
                  </option>
                ))}
              </select>
            </div>

            {sexoEhLivre && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Sexo
                  <Required />
                </label>
                <select
                  className={`w-full ${inputClass}`}
                  value={novaCategoriaSexo}
                  onChange={(e) => setNovaCategoriaSexo(e.target.value as Sexo)}
                  required
                >
                  <option value="">Selecione...</option>
                  <option value="MACHO">Macho</option>
                  <option value="FEMEA">Fêmea</option>
                </select>
              </div>
            )}

            {novaCategoriaPapelId && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Era
                  {!isBezerroPapel && <Required />}
                </label>
                {isBezerroPapel ? (
                  <p className="rounded-control border border-border bg-bg px-3 py-2 text-sm text-text-secondary">
                    00-08 (fixo para Bezerros/Bezerras Mamando)
                  </p>
                ) : (
                  <select
                    className={`w-full ${inputClass}`}
                    value={novaCategoriaEra}
                    onChange={(e) => setNovaCategoriaEra(e.target.value as Era)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {/* 00-08 é exclusiva de Bezerros/Bezerras Mamando — mesmo princípio já
                        aplicado em app/categorias/page.tsx */}
                    {ERAS.filter((e) => e !== '00-08').map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                )}
                {eraEfetiva && (
                  <p className="mt-1 text-xs text-text-muted">
                    Grupo Faixa Etária: {GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]}
                    {FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]
                      ? ` (${FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]})`
                      : ''}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Peso de referência (kg)</label>
              <input
                type="number"
                step="0.01"
                className={`w-full ${inputClass}`}
                value={novaCategoriaPesoReferencia}
                onChange={(e) => setNovaCategoriaPesoReferencia(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                onClick={() => setModalCategoriaAberto(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoCategoria}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvandoCategoria ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
