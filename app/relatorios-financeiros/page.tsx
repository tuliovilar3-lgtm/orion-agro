'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'
import { useFiltroGlobal } from '@/contexts/FiltroGlobalContext'
import { anoInicioSafraAtual, anoCalendarioAtual, opcoesSafra, opcoesAno } from '@/lib/periodo'
import FiltroMultiSelect from '@/components/relatorios/FiltroMultiSelect'
import PainelFiltroColapsavel from '@/components/relatorios/PainelFiltroColapsavel'
import { formatarDataBr } from '@/components/relatorios/tipos'
import { formatMoeda, formatQuantidade, formatDecimal, formatPeso } from '@/lib/format'
import { construirArvore, mesesDoIntervalo, nomeMesCurto, type NoArvore, type LinhaClassificada } from '@/components/relatorios-financeiros/arvore'

type ClasseInfo = { numero: number; nome: string; tipo: 'CREDITO' | 'DEBITO' }
type CentroInfo = { numero: number; nome: string; classe: ClasseInfo | null }
type SubcentroInfo = { numero: number; nome: string; centro: CentroInfo | null }

type LinhaBalancete = {
  id: string
  data: string
  valor: number
  fazenda_id: string
  proprietario_id: string | null
  atividade_economica_id: string | null
  status: string
  subcentro: SubcentroInfo | null
  produto: { nome: string } | null
}

type LinhaBaixa = {
  valor: number
  data_pagamento: string | null
  lancamento: {
    fazenda_id: string
    proprietario_id: string | null
    tipo: 'CREDITO' | 'DEBITO'
    status: string
    subcentro: SubcentroInfo | null
    produto: { nome: string } | null
  } | null
}

type MovRow = {
  tipo: string
  data: string
  peso_total_kg: number | null
  peso_morto_kg: number | null
  fazenda_id: string | null
  fazenda_origem_id: string | null
  fazenda_destino_id: string | null
  proprietario_id: string | null
}

const SELECT_CLASSIFICACAO = 'numero, nome, centro:centros_custo(numero, nome, classe:classes_financeiras(numero, nome, tipo))'

function paraLinhaClassificada(
  subcentro: SubcentroInfo | null,
  produtoNome: string | undefined,
  valor: number,
  data: string
): LinhaClassificada | null {
  const centro = subcentro?.centro
  const classe = centro?.classe
  if (!subcentro || !centro || !classe) return null
  return {
    tipo: classe.tipo,
    classeNumero: classe.numero,
    classeNome: classe.nome,
    centroNumero: centro.numero,
    centroNome: centro.nome,
    subcentroNumero: subcentro.numero,
    subcentroNome: subcentro.nome,
    produtoNome: produtoNome || '—',
    valor,
    mes: data.slice(0, 7),
  }
}

// Desembolso: Suporte à Produção (4) + Mão de Obra (5) + Despesas com
// Atividades Produtivas (6) + Investimentos (3), exceto o centro 3.3
// "Rebanho Investimento" (onde cai a Compra de gado — tratada como
// aquisição, não desembolso operacional). Custeio: só 4/5/6, nenhum
// item de Investimento entra.
function passaEscopo(classeNumero: number, centroNumero: number, escopo: 'desembolso' | 'custeio'): boolean {
  if ([4, 5, 6].includes(classeNumero)) return true
  if (escopo === 'desembolso' && classeNumero === 3 && centroNumero !== 3) return true
  return false
}

function pesoMovimentacao(m: MovRow, unidade: 'arroba' | 'kg'): number {
  if (unidade === 'kg') return m.peso_total_kg ?? 0
  if (m.tipo === 'VENDA_ABATE' && m.peso_morto_kg != null) return m.peso_morto_kg / 15
  return (m.peso_total_kg ?? 0) / 30
}

function achatarArvore(nos: NoArvore[], expandidos: Set<string>, profundidade = 0): { no: NoArvore; profundidade: number }[] {
  const linhas: { no: NoArvore; profundidade: number }[] = []
  for (const no of nos) {
    linhas.push({ no, profundidade })
    if (no.filhos.length > 0 && expandidos.has(no.chave)) {
      linhas.push(...achatarArvore(no.filhos, expandidos, profundidade + 1))
    }
  }
  return linhas
}

function somarDias(dataInicioIso: string, dias: number): string {
  const d = new Date(dataInicioIso + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

function fimDoMes(anoMes: string): string {
  const [ano, mes] = anoMes.split('-').map(Number)
  return new Date(ano, mes, 0).toISOString().slice(0, 10)
}

type Aba = 'balancete' | 'desembolso_cab' | 'desembolso_arroba'

export default function RelatoriosFinanceirosPage() {
  const {
    fazendas,
    fazendaIds,
    alternarFazenda,
    alternarTodas,
    todasSelecionadas,
    proprietarios,
    proprietarioIds,
    alternarProprietario,
    alternarTodosProprietarios,
    todosProprietariosSelecionados,
    modoFiltro,
    setModoFiltro,
    mes,
    setMes,
    safraAnoInicio,
    setSafraAnoInicio,
    anoCalendarioSelecionado,
    setAnoCalendarioSelecionado,
    dataInicioCustom,
    setDataInicioCustom,
    dataFimCustom,
    setDataFimCustom,
    dataInicio,
    dataFim,
    periodoInvalido,
  } = useFiltroGlobal()

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)
  const mesAtual = hoje.slice(0, 7)

  const [abaSelecionada, setAbaSelecionada] = useState<Aba>('balancete')
  const [agrupamento, setAgrupamento] = useState<'acumulado' | 'mensal'>('acumulado')
  const [escopoDesembolso, setEscopoDesembolso] = useState<'desembolso' | 'custeio'>('desembolso')
  const [unidade, setUnidade] = useState<'arroba' | 'kg'>('arroba')
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  function alternarExpandido(chave: string) {
    setExpandidos((prev) => {
      const novo = new Set(prev)
      if (novo.has(chave)) novo.delete(chave)
      else novo.add(chave)
      return novo
    })
  }

  const [atividades, setAtividades] = useState<{ id: string; nome: string }[]>([])
  const [atividadeIds, setAtividadeIds] = useState<string[]>([])
  useEffect(() => {
    supabase
      .from('atividades_economicas')
      .select('id, nome')
      .eq('ativo', true)
      .order('ordem')
      .then(({ data }) => {
        const lista = data || []
        setAtividades(lista)
        setAtividadeIds(lista.map((a) => a.id))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const todasAtividadesSelecionadas = atividades.length === 0 || atividadeIds.length === atividades.length
  function alternarAtividade(id: string) {
    setAtividadeIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]))
  }
  function alternarTodasAtividades() {
    setAtividadeIds((prev) => (prev.length === atividades.length ? [] : atividades.map((a) => a.id)))
  }

  const proprietarioFiltroAtivo = proprietarios.length > 0 && proprietarioIds.length < proprietarios.length

  // ---------------------------------------------------------------------
  // Aba 1 — Balancete: lancamentos_financeiros direto, status CONFIRMADO
  // ---------------------------------------------------------------------
  const [linhasBalancete, setLinhasBalancete] = useState<LinhaBalancete[]>([])
  const [carregandoBalancete, setCarregandoBalancete] = useState(false)

  useEffect(() => {
    if (abaSelecionada !== 'balancete') return
    if (fazendaIds.length === 0 || periodoInvalido) {
      setLinhasBalancete([])
      return
    }
    let cancelado = false
    setCarregandoBalancete(true)
    supabase
      .from('lancamentos_financeiros')
      .select(
        `id, data, valor, fazenda_id, proprietario_id, atividade_economica_id, status,
         subcentro:subcentros_custo(${SELECT_CLASSIFICACAO}),
         produto:produtos_financeiros(nome)`
      )
      .eq('status', 'CONFIRMADO')
      .in('fazenda_id', fazendaIds)
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setLinhasBalancete((data || []) as unknown as LinhaBalancete[])
        setCarregandoBalancete(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaSelecionada, fazendaIds, dataInicio, dataFim, periodoInvalido])

  const linhasBalanceteFiltradas = useMemo(() => {
    return linhasBalancete.filter((l) => {
      if (proprietarioFiltroAtivo && !(l.proprietario_id && proprietarioIds.includes(l.proprietario_id))) return false
      if (!todasAtividadesSelecionadas && !(l.atividade_economica_id && atividadeIds.includes(l.atividade_economica_id))) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhasBalancete, proprietarioIds, proprietarioFiltroAtivo, atividadeIds, todasAtividadesSelecionadas])

  const linhasClassificadasBalancete = useMemo(
    () =>
      linhasBalanceteFiltradas
        .map((l) => paraLinhaClassificada(l.subcentro, l.produto?.nome, l.valor, l.data))
        .filter((l): l is LinhaClassificada => l !== null),
    [linhasBalanceteFiltradas]
  )
  const arvoreBalancete = useMemo(() => construirArvore(linhasClassificadasBalancete), [linhasClassificadasBalancete])
  const totalCredito = arvoreBalancete.find((n) => n.chave === 'CREDITO')?.valor ?? 0
  const totalDebito = arvoreBalancete.find((n) => n.chave === 'DEBITO')?.valor ?? 0

  // ---------------------------------------------------------------------
  // Abas 2/3 — numerador comum: lancamento_baixas com data_pagamento no
  // período (regime de caixa), join até a classificação do lançamento pai
  // ---------------------------------------------------------------------
  const usaDesembolso = abaSelecionada === 'desembolso_cab' || abaSelecionada === 'desembolso_arroba'
  const [baixas, setBaixas] = useState<LinhaBaixa[]>([])
  const [carregandoBaixas, setCarregandoBaixas] = useState(false)

  useEffect(() => {
    if (!usaDesembolso) return
    if (fazendaIds.length === 0 || periodoInvalido) {
      setBaixas([])
      return
    }
    let cancelado = false
    setCarregandoBaixas(true)
    supabase
      .from('lancamento_baixas')
      .select(
        `valor, data_pagamento,
         lancamento:lancamentos_financeiros!lancamento_id(
           fazenda_id, proprietario_id, tipo, status,
           subcentro:subcentros_custo(${SELECT_CLASSIFICACAO}),
           produto:produtos_financeiros(nome)
         )`
      )
      .gte('data_pagamento', dataInicio)
      .lte('data_pagamento', dataFim)
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setBaixas((data || []) as unknown as LinhaBaixa[])
        setCarregandoBaixas(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usaDesembolso, fazendaIds, dataInicio, dataFim, periodoInvalido])

  const escopoAtivo = abaSelecionada === 'desembolso_cab' ? 'desembolso' : escopoDesembolso

  const linhasDesembolsoFiltradas = useMemo(() => {
    const fazendaSet = new Set(fazendaIds)
    return baixas.filter((b) => {
      const l = b.lancamento
      if (!l || l.status !== 'CONFIRMADO' || l.tipo !== 'DEBITO') return false
      if (!l.fazenda_id || !fazendaSet.has(l.fazenda_id)) return false
      if (proprietarioFiltroAtivo && !(l.proprietario_id && proprietarioIds.includes(l.proprietario_id))) return false
      const classe = l.subcentro?.centro?.classe
      if (!classe) return false
      if (!passaEscopo(classe.numero, l.subcentro!.centro!.numero, escopoAtivo)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baixas, fazendaIds, proprietarioIds, proprietarioFiltroAtivo, escopoAtivo])

  const linhasClassificadasDesembolso = useMemo(
    () =>
      linhasDesembolsoFiltradas
        .map((b) => paraLinhaClassificada(b.lancamento!.subcentro, b.lancamento!.produto?.nome, b.valor, b.data_pagamento!))
        .filter((l): l is LinhaClassificada => l !== null),
    [linhasDesembolsoFiltradas]
  )
  const arvoreDesembolsoCompleta = useMemo(() => construirArvore(linhasClassificadasDesembolso), [linhasClassificadasDesembolso])
  // sempre 1 ramo só (Débito) — a árvore exibida pula direto pra Classe
  const arvoreDesembolso = arvoreDesembolsoCompleta[0]?.filhos ?? []
  const totalDesembolso = arvoreDesembolsoCompleta[0]?.valor ?? 0
  const totalDesembolsoPorMes = arvoreDesembolsoCompleta[0]?.valoresPorMes ?? {}

  // ---------------------------------------------------------------------
  // Aba 2 — denominador: Rebanho Médio mensal (fn_relatorio_lotacao_mensal,
  // já existente — migração 062 acrescentou o filtro de proprietário)
  // ---------------------------------------------------------------------
  const [rebanhoMensal, setRebanhoMensal] = useState<{ mes: number; ano: number; rebanho_medio: number; dias_no_mes: number }[]>([])
  useEffect(() => {
    if (abaSelecionada !== 'desembolso_cab') return
    if (fazendaIds.length === 0 || periodoInvalido) {
      setRebanhoMensal([])
      return
    }
    supabase
      .rpc('fn_relatorio_lotacao_mensal', {
        p_fazenda_ids: fazendaIds,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        p_proprietario_ids: proprietarioFiltroAtivo ? proprietarioIds : null,
      })
      .then(({ data }) => setRebanhoMensal((data || []) as typeof rebanhoMensal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaSelecionada, fazendaIds, dataInicio, dataFim, proprietarioIds, proprietarioFiltroAtivo, periodoInvalido])

  const rebanhoPorMes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rebanhoMensal) m[`${r.ano}-${String(r.mes).padStart(2, '0')}`] = r.rebanho_medio
    return m
  }, [rebanhoMensal])
  const rebanhoMedioAcumulado = useMemo(() => {
    const somaDias = rebanhoMensal.reduce((s, r) => s + r.dias_no_mes, 0)
    if (somaDias === 0) return null
    const somaPonderada = rebanhoMensal.reduce((s, r) => s + r.rebanho_medio * r.dias_no_mes, 0)
    return somaPonderada / somaDias
  }, [rebanhoMensal])

  // ---------------------------------------------------------------------
  // Aba 3 — denominador: @ (ou kg) Produzida completa =
  // Estoque_final - Estoque_inicial - Entradas + Saídas, tudo na mesma
  // unidade. Estoque via fn_indicadores_rebanho_dia (peso vivo, migração
  // 062 já filtra por proprietário); entradas/saídas somadas direto de
  // movimentacoes_rebanho no período.
  // ---------------------------------------------------------------------
  const [movRows, setMovRows] = useState<MovRow[]>([])
  useEffect(() => {
    if (abaSelecionada !== 'desembolso_arroba') return
    if (fazendaIds.length === 0 || periodoInvalido) {
      setMovRows([])
      return
    }
    let cancelado = false
    const idsStr = fazendaIds.join(',')
    supabase
      .from('movimentacoes_rebanho')
      .select('tipo, data, peso_total_kg, peso_morto_kg, fazenda_id, fazenda_origem_id, fazenda_destino_id, proprietario_id')
      .in('tipo', ['COMPRA', 'VENDA_PE', 'VENDA_ABATE', 'TRANSFERENCIA', 'MORTE', 'CONSUMO_DOACAO'])
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .or(`fazenda_id.in.(${idsStr}),fazenda_origem_id.in.(${idsStr}),fazenda_destino_id.in.(${idsStr})`)
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setMovRows((data || []) as MovRow[])
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaSelecionada, fazendaIds, dataInicio, dataFim, periodoInvalido])

  const movRowsFiltradas = useMemo(() => {
    if (!proprietarioFiltroAtivo) return movRows
    return movRows.filter((m) => m.proprietario_id && proprietarioIds.includes(m.proprietario_id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movRows, proprietarioIds, proprietarioFiltroAtivo])

  function entradaSaidaPorMes(unid: 'arroba' | 'kg') {
    const fazendaSet = new Set(fazendaIds)
    const entradas: Record<string, number> = {}
    const saidas: Record<string, number> = {}
    for (const m of movRowsFiltradas) {
      const mesRow = m.data.slice(0, 7)
      const peso = pesoMovimentacao(m, unid)
      if (m.tipo === 'COMPRA' && m.fazenda_id && fazendaSet.has(m.fazenda_id)) entradas[mesRow] = (entradas[mesRow] || 0) + peso
      if (m.tipo === 'TRANSFERENCIA') {
        if (m.fazenda_destino_id && fazendaSet.has(m.fazenda_destino_id)) entradas[mesRow] = (entradas[mesRow] || 0) + peso
        if (m.fazenda_origem_id && fazendaSet.has(m.fazenda_origem_id)) saidas[mesRow] = (saidas[mesRow] || 0) + peso
      }
      if (['VENDA_PE', 'VENDA_ABATE', 'MORTE', 'CONSUMO_DOACAO'].includes(m.tipo) && m.fazenda_id && fazendaSet.has(m.fazenda_id)) {
        saidas[mesRow] = (saidas[mesRow] || 0) + peso
      }
    }
    return { entradas, saidas }
  }

  // snapshots de estoque (peso vivo total, kg) nas datas de fronteira —
  // dataInicio-1 (início) + fim de cada mês do período (+ dataFim, se o
  // período não acabar exatamente num fim de mês)
  const [estoquePorData, setEstoquePorData] = useState<Record<string, number>>({})
  useEffect(() => {
    if (abaSelecionada !== 'desembolso_arroba') return
    if (fazendaIds.length === 0 || periodoInvalido) {
      setEstoquePorData({})
      return
    }
    let cancelado = false
    const meses = mesesDoIntervalo(dataInicio, dataFim)
    const datasFronteira = new Set<string>([somarDias(dataInicio, -1), dataFim])
    for (const m of meses) datasFronteira.add(fimDoMes(m) < dataFim ? fimDoMes(m) : dataFim)
    const datas = [...datasFronteira]
    Promise.all(
      datas.map((d) =>
        supabase
          .rpc('fn_indicadores_rebanho_dia', {
            p_fazenda_ids: fazendaIds,
            p_data: d,
            p_proprietario_ids: proprietarioFiltroAtivo ? proprietarioIds : null,
          })
          .then(({ data }) => ({ data: d, peso: (data?.[0]?.peso_vivo_total as number | undefined) ?? 0 }))
      )
    ).then((resultados) => {
      if (cancelado) return
      const mapa: Record<string, number> = {}
      for (const r of resultados) mapa[r.data] = r.peso
      setEstoquePorData(mapa)
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaSelecionada, fazendaIds, dataInicio, dataFim, proprietarioIds, proprietarioFiltroAtivo, periodoInvalido])

  function estoqueNaUnidade(dataIso: string, unid: 'arroba' | 'kg'): number {
    const kg = estoquePorData[dataIso] ?? 0
    return unid === 'kg' ? kg : kg / 30
  }

  // produção (na unidade escolhida) por mês e acumulada — telescopa
  // naturalmente: soma das produções mensais = estoque final do último
  // mês - estoque inicial do primeiro, já que estoqueInicial(mes+1) é
  // sempre o mesmo valor de estoqueFinal(mes)
  const producaoPorMes = useMemo(() => {
    const { entradas, saidas } = entradaSaidaPorMes(unidade)
    const meses = mesesDoIntervalo(dataInicio, dataFim)
    const mapa: Record<string, number> = {}
    let dataAnterior = somarDias(dataInicio, -1)
    for (const m of meses) {
      const fimDesteMes = fimDoMes(m) < dataFim ? fimDoMes(m) : dataFim
      const estoqueInicial = estoqueNaUnidade(dataAnterior, unidade)
      const estoqueFinal = estoqueNaUnidade(fimDesteMes, unidade)
      mapa[m] = estoqueFinal - estoqueInicial - (entradas[m] || 0) + (saidas[m] || 0)
      dataAnterior = fimDesteMes
    }
    return mapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movRowsFiltradas, estoquePorData, unidade, dataInicio, dataFim])

  const producaoAcumulada = useMemo(() => Object.values(producaoPorMes).reduce((s, v) => s + v, 0), [producaoPorMes])

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  const listaMeses = mesesDoIntervalo(dataInicio, dataFim)
  const rotuloPeriodoCurto =
    modoFiltro === 'mes'
      ? mes
      : modoFiltro === 'safra'
        ? `Safra ${safraAnoInicio}/${safraAnoInicio + 1}`
        : modoFiltro === 'ano'
          ? `Ano ${anoCalendarioSelecionado}`
          : `${formatarDataBr(dataInicio)} – ${formatarDataBr(dataFim)}`

  const resumoFiltro = [
    `${fazendaIds.length} fazenda${fazendaIds.length === 1 ? '' : 's'}`,
    proprietarios.length > 1
      ? todosProprietariosSelecionados
        ? 'todos os proprietários'
        : `${proprietarioIds.length} proprietário${proprietarioIds.length === 1 ? '' : 's'}`
      : null,
    rotuloPeriodoCurto,
  ]
    .filter(Boolean)
    .join(' · ')

  function celulaValor(no: NoArvore, mesCol: string | null) {
    const valor = mesCol ? no.valoresPorMes[mesCol] || 0 : no.valor
    return (
      <td className="whitespace-nowrap px-3 py-1.5 text-right text-sm tabular-nums text-text-primary">{formatMoeda(valor)}</td>
    )
  }

  function celulaRatio(no: NoArvore, mesCol: string | null) {
    const valor = mesCol ? no.valoresPorMes[mesCol] || 0 : no.valor
    if (abaSelecionada === 'desembolso_cab') {
      const denom = mesCol ? rebanhoPorMes[mesCol] : rebanhoMedioAcumulado
      const ratio = denom && denom > 0 ? valor / denom : null
      return (
        <td className="whitespace-nowrap px-3 py-1.5 text-right text-sm tabular-nums text-text-secondary">
          {ratio != null ? `${formatMoeda(ratio)}/cab.` : '—'}
        </td>
      )
    }
    const denom = mesCol ? producaoPorMes[mesCol] : producaoAcumulada
    const ratio = denom && denom > 0 ? valor / denom : null
    return (
      <td className="whitespace-nowrap px-3 py-1.5 text-right text-sm tabular-nums text-text-secondary">
        {ratio != null ? `${formatMoeda(ratio)}/${unidade === 'arroba' ? '@' : 'kg'}` : '—'}
      </td>
    )
  }

  const arvoreExibida = abaSelecionada === 'balancete' ? arvoreBalancete : arvoreDesembolso
  const linhasAchatadas = achatarArvore(arvoreExibida, expandidos)
  const carregando = abaSelecionada === 'balancete' ? carregandoBalancete : carregandoBaixas

  return (
    <ModuloGate modulo="relatorios_financeiros">
      <div className="px-6 py-8 md:px-10">
        <PainelFiltroColapsavel
          titulo="Relatórios Financeiros"
          resumoFiltro={resumoFiltro}
          abaixoTitulo={
            <div className="-mx-6 flex flex-wrap gap-1.5 px-6 pt-1 md:mx-0 md:px-0">
              {(
                [
                  { id: 'balancete', label: 'Balancete' },
                  { id: 'desembolso_cab', label: 'Desembolso R$/cab./mês' },
                  { id: 'desembolso_arroba', label: 'Desembolso ou Custeio R$/@' },
                ] as const
              ).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAbaSelecionada(a.id)}
                  className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                    abaSelecionada === a.id
                      ? 'border-brand-500 text-brand-500 font-semibold'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          }
        >
          <FiltroMultiSelect
            label="Fazendas"
            required
            itens={fazendas}
            selecionados={fazendaIds}
            onToggleItem={alternarFazenda}
            onToggleTodos={alternarTodas}
            todosSelecionados={todasSelecionadas}
            vazioLabel="Nenhuma fazenda cadastrada."
          />

          {proprietarios.length > 1 && (
            <FiltroMultiSelect
              label="Proprietário"
              itens={proprietarios}
              selecionados={proprietarioIds}
              onToggleItem={alternarProprietario}
              onToggleTodos={alternarTodosProprietarios}
              todosSelecionados={todosProprietariosSelecionados}
              pluralMasculino
            />
          )}

          {abaSelecionada === 'balancete' && atividades.length > 0 && (
            <FiltroMultiSelect
              label="Atividade Econômica"
              itens={atividades}
              selecionados={atividadeIds}
              onToggleItem={alternarAtividade}
              onToggleTodos={alternarTodasAtividades}
              todosSelecionados={todasAtividadesSelecionadas}
            />
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Período</label>
            <div className="mb-1.5 flex flex-wrap gap-3 text-sm text-text-primary">
              <label className="flex items-center gap-1">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'mes'} onChange={() => setModoFiltro('mes')} />
                Mês
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'safra'} onChange={() => setModoFiltro('safra')} />
                Ano Safra
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'ano'} onChange={() => setModoFiltro('ano')} />
                Ano Calendário
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'periodo'} onChange={() => setModoFiltro('periodo')} />
                Período personalizado
              </label>
            </div>
            {modoFiltro === 'mes' ? (
              <input
                type="month"
                max={mesAtual}
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              />
            ) : modoFiltro === 'safra' ? (
              <select
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={safraAnoInicio}
                onChange={(e) => setSafraAnoInicio(Number(e.target.value))}
              >
                {opcoesSafra().map((ano) => (
                  <option key={ano} value={ano}>
                    {ano}/{ano + 1}
                    {ano === anoInicioSafraAtual() ? ' (atual)' : ''}
                  </option>
                ))}
              </select>
            ) : modoFiltro === 'ano' ? (
              <select
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={anoCalendarioSelecionado}
                onChange={(e) => setAnoCalendarioSelecionado(Number(e.target.value))}
              >
                {opcoesAno().map((ano) => (
                  <option key={ano} value={ano}>
                    {ano}
                    {ano === anoCalendarioAtual() ? ' (atual)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  max={hoje}
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={dataInicioCustom}
                  onChange={(e) => setDataInicioCustom(e.target.value)}
                />
                <span className="text-sm text-text-secondary">até</span>
                <input
                  type="date"
                  max={hoje}
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={dataFimCustom}
                  onChange={(e) => setDataFimCustom(e.target.value)}
                />
              </div>
            )}
            {periodoInvalido && <p className="mt-1 text-xs text-error">A data inicial não pode ser depois da final.</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Agrupamento</label>
            <div className="flex gap-3 text-sm text-text-primary">
              <label className="flex items-center gap-1">
                <input type="radio" name="agrupamento" checked={agrupamento === 'acumulado'} onChange={() => setAgrupamento('acumulado')} />
                Acumulado
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="agrupamento" checked={agrupamento === 'mensal'} onChange={() => setAgrupamento('mensal')} />
                Mensal
              </label>
            </div>
          </div>

          {abaSelecionada === 'desembolso_arroba' && (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Numerador</label>
                <div className="flex gap-3 text-sm text-text-primary">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="escopo"
                      checked={escopoDesembolso === 'desembolso'}
                      onChange={() => setEscopoDesembolso('desembolso')}
                    />
                    Desembolso
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="escopo"
                      checked={escopoDesembolso === 'custeio'}
                      onChange={() => setEscopoDesembolso('custeio')}
                    />
                    Custeio
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Unidade</label>
                <div className="flex gap-3 text-sm text-text-primary">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="unidade" checked={unidade === 'arroba'} onChange={() => setUnidade('arroba')} />
                    @ (carcaça)
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="unidade" checked={unidade === 'kg'} onChange={() => setUnidade('kg')} />
                    kg (vivo)
                  </label>
                </div>
              </div>
            </>
          )}
        </PainelFiltroColapsavel>

        <div className="mt-6">
          {fazendaIds.length === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="font-semibold text-text-primary">Selecione ao menos uma fazenda</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
                O relatório precisa de pelo menos uma fazenda marcada no filtro acima para trazer dados.
              </p>
            </div>
          ) : periodoInvalido ? (
            <p className="text-sm text-error">Corrija o período antes de continuar.</p>
          ) : carregando ? (
            <div className="h-64 animate-pulse rounded-card border border-border bg-surface" />
          ) : (
            <>
              {abaSelecionada === 'desembolso_cab' && (
                <p className="mb-3 text-sm text-text-secondary">
                  Rebanho médio do período: <span className="font-semibold text-text-primary">{formatQuantidade(rebanhoMedioAcumulado)} cab.</span>
                  {' · '}Desembolso total: <span className="font-semibold text-text-primary">{formatMoeda(totalDesembolso)}</span>
                  {' · '}
                  <span className="font-semibold text-text-primary">
                    {rebanhoMedioAcumulado ? formatMoeda(totalDesembolso / rebanhoMedioAcumulado) : '—'}/cab.
                  </span>
                </p>
              )}
              {abaSelecionada === 'desembolso_arroba' && (
                <p className="mb-3 text-sm text-text-secondary">
                  {unidade === 'arroba' ? '@ Produzida' : 'kg Produzido'} no período:{' '}
                  <span className="font-semibold text-text-primary">
                    {unidade === 'arroba' ? formatDecimal(producaoAcumulada) + ' @' : formatPeso(producaoAcumulada) + ' kg'}
                  </span>
                  {' · '}
                  {escopoAtivo === 'desembolso' ? 'Desembolso' : 'Custeio'} total:{' '}
                  <span className="font-semibold text-text-primary">{formatMoeda(totalDesembolso)}</span>
                  {' · '}
                  <span className="font-semibold text-text-primary">
                    {producaoAcumulada > 0 ? formatMoeda(totalDesembolso / producaoAcumulada) : '—'}/{unidade === 'arroba' ? '@' : 'kg'}
                  </span>
                </p>
              )}

              {linhasAchatadas.length === 0 ? (
                <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
                  <p className="font-semibold text-text-primary">Nenhum lançamento confirmado nesse filtro</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
                    Ajuste o período, as fazendas ou o proprietário selecionado acima.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-card border border-border bg-surface">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-bg">
                        <th className="px-3 py-2 text-left font-semibold text-text-secondary">Classificação</th>
                        {agrupamento === 'mensal' ? (
                          listaMeses.map((m) => (
                            <th key={m} className="whitespace-nowrap px-3 py-2 text-right font-semibold text-text-secondary" colSpan={abaSelecionada === 'balancete' ? 1 : 2}>
                              {nomeMesCurto(m)}
                            </th>
                          ))
                        ) : (
                          <th className="px-3 py-2 text-right font-semibold text-text-secondary" colSpan={abaSelecionada === 'balancete' ? 1 : 2}>
                            Total do período
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {linhasAchatadas.map(({ no, profundidade }) => (
                        <tr key={no.chave} className="border-b border-border last:border-0 hover:bg-bg">
                          <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + profundidade * 18}px` }}>
                            {no.filhos.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => alternarExpandido(no.chave)}
                                className="flex items-center gap-1.5 text-left text-sm font-medium text-text-primary hover:text-brand-500"
                              >
                                <span className="w-3 text-text-muted">{expandidos.has(no.chave) ? '−' : '+'}</span>
                                {no.label}
                              </button>
                            ) : (
                              <span className="text-sm text-text-secondary">{no.label}</span>
                            )}
                          </td>
                          {agrupamento === 'mensal'
                            ? listaMeses.map((m) => (
                                <Fragment key={m}>
                                  {celulaValor(no, m)}
                                  {abaSelecionada !== 'balancete' && celulaRatio(no, m)}
                                </Fragment>
                              ))
                            : (
                                <Fragment key="total">
                                  {celulaValor(no, null)}
                                  {abaSelecionada !== 'balancete' && celulaRatio(no, null)}
                                </Fragment>
                              )}
                        </tr>
                      ))}
                    </tbody>
                    {abaSelecionada === 'balancete' && (
                      <tfoot>
                        <tr className="border-t-2 border-border bg-bg font-semibold">
                          <td className="px-3 py-2 text-text-primary">Total Crédito</td>
                          <td className="px-3 py-2 text-right tabular-nums text-success" colSpan={agrupamento === 'mensal' ? listaMeses.length : 1}>
                            {formatMoeda(totalCredito)}
                          </td>
                        </tr>
                        <tr className="bg-bg font-semibold">
                          <td className="px-3 py-2 text-text-primary">Total Débito</td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-primary" colSpan={agrupamento === 'mensal' ? listaMeses.length : 1}>
                            {formatMoeda(totalDebito)}
                          </td>
                        </tr>
                        <tr className="bg-bg font-semibold">
                          <td className="px-3 py-2 text-text-primary">Resultado</td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${totalCredito - totalDebito >= 0 ? 'text-success' : 'text-error'}`}
                            colSpan={agrupamento === 'mensal' ? listaMeses.length : 1}
                          >
                            {formatMoeda(totalCredito - totalDebito)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModuloGate>
  )
}
