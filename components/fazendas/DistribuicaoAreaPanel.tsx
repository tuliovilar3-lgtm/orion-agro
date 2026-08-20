'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { corTipoUsoArea } from '@/lib/area-cores'
import { formatArea, formatQuantidade } from '@/lib/format'
import {
  ultimoDiaDoMes,
  periodoSafra,
  periodoAno,
  anoInicioSafraAtual,
  anoCalendarioAtual,
  opcoesSafra,
  opcoesAno,
} from '@/lib/periodo'

type FazendaResumo = { id: string; nome: string; area_ha: number | null }
type TipoUsoArea = { id: string; nome: string }
type SubtipoUsoArea = { id: string; tipo_uso_id: string; nome: string; ativo: boolean }
type PastoResumo = { id: string; nome: string; area_ha: number | null; ativo: boolean }

type TipoMovimentacaoArea = 'MUDANCA_USO' | 'INCORPORACAO_AREA' | 'DESINCORPORACAO_AREA'

type MovimentacaoArea = {
  id: string
  tipo: TipoMovimentacaoArea
  data: string
  tipo_uso_origem_id: string | null
  tipo_uso_destino_id: string | null
  subtipo_uso_origem_id: string | null
  subtipo_uso_destino_id: string | null
  area_ha: number
  observacao: string | null
  tipo_uso_origem: { nome: string } | null
  tipo_uso_destino: { nome: string } | null
  subtipo_uso_origem: { nome: string } | null
  subtipo_uso_destino: { nome: string } | null
}

const NOVO_SUBTIPO = '__novo__'
const TIPOS_COM_SUBTIPO = ['Pecuária', 'Agricultura']

function labelTipoUso(tipoNome: string | undefined, subtipoNome: string | undefined) {
  if (!tipoNome) return '—'
  if (!subtipoNome || subtipoNome === 'Geral') return tipoNome
  return `${tipoNome} (${subtipoNome})`
}

function labelMovimentacao(m: MovimentacaoArea) {
  if (m.tipo === 'INCORPORACAO_AREA') {
    return `+ ${labelTipoUso(m.tipo_uso_destino?.nome, m.subtipo_uso_destino?.nome)}`
  }
  if (m.tipo === 'DESINCORPORACAO_AREA') {
    return `− ${labelTipoUso(m.tipo_uso_origem?.nome, m.subtipo_uso_origem?.nome)}`
  }
  return `${labelTipoUso(m.tipo_uso_origem?.nome, m.subtipo_uso_origem?.nome)} → ${labelTipoUso(m.tipo_uso_destino?.nome, m.subtipo_uso_destino?.nome)}`
}

type ChecagemEdicaoArea = {
  tem_movimentacoes_futuras: boolean
  saldo_ficaria_negativo: boolean
  data_saldo_negativo: string | null
  tipo_uso_saldo_negativo: string | null
  saldo_minimo: number | null
}

type LinhaDistribuicao = {
  mes: number
  ano: number
  tipo_uso_id: string
  tipo_uso_nome: string
  area_media_ponderada: number
  dias_no_mes: number
}

type MesColuna = {
  chave: string
  label: string
  dias: number
}

type TipoUsoLinha = {
  tipo_uso_id: string
  tipo_uso_nome: string
  porMes: Record<string, number>
  areaMedia: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function formatarData(iso: string) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

const NOMES_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export default function DistribuicaoAreaPanel({
  fazendaId,
  onAreaChanged,
}: {
  fazendaId: string
  // avisa quem chamou (a barra de estatísticas fixa em app/fazendas/page.tsx)
  // que Área total/Pecuária/Agricultura podem ter mudado — essa barra vive
  // fora deste componente, sem remount ao editar aqui dentro, então
  // precisa desse aviso explícito pra não ficar mostrando número antigo
  onAreaChanged?: () => void
}) {
  const [fazendaSelecionada, setFazendaSelecionada] = useState<FazendaResumo | null>(null)
  const [tiposUso, setTiposUso] = useState<TipoUsoArea[]>([])
  const [subtiposUso, setSubtiposUso] = useState<SubtipoUsoArea[]>([])
  const [controlaSubtipoArea, setControlaSubtipoArea] = useState(false)
  const [controlaPasto, setControlaPasto] = useState(false)
  const [loading, setLoading] = useState(false)

  // distribuição de área
  const [modoFiltro, setModoFiltro] = useState<'mes' | 'safra' | 'ano' | 'periodo'>('mes')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicio] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionado] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustom] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhasDistribuicao, setLinhasDistribuicao] = useState<LinhaDistribuicao[]>([])
  const [loadingDistribuicao, setLoadingDistribuicao] = useState(false)
  const [erroDistribuicao, setErroDistribuicao] = useState<string | null>(null)
  const [areasFinais, setAreasFinais] = useState<Record<string, number>>({})
  // incrementado depois de qualquer lançamento novo/editado na aba —
  // as 3 buscas abaixo (gráfico/tabela de distribuição, áreas finais,
  // conferência com pastos) não têm nenhuma dependência que mude
  // sozinha quando só a lista de movimentações muda, então precisam
  // desse empurrão explícito pra refletir o lançamento sem reload
  const [refreshKey, setRefreshKey] = useState(0)

  // conferência com pastos (só quando controla_pasto está ligado) — soma
  // da área dos pastos ativos vs. área alocada em Pecuária hoje. Vínculo
  // puramente visual/informativo, sem mudança de schema — pasto continua
  // livre (sem subtipo/tipo de uso próprio).
  const [pastosAtivos, setPastosAtivos] = useState<PastoResumo[]>([])
  const [areaPecuariaHoje, setAreaPecuariaHoje] = useState<number | null>(null)

  // lançamento de mudança de uso
  const [data, setData] = useState('')
  const [tipoUsoOrigemId, setTipoUsoOrigemId] = useState('')
  const [tipoUsoDestinoId, setTipoUsoDestinoId] = useState('')
  const [areaHa, setAreaHa] = useState('')
  const [subtipoUsoOrigemId, setSubtipoUsoOrigemId] = useState('')
  const [subtipoUsoDestinoId, setSubtipoUsoDestinoId] = useState('')
  const [novoSubtipoOrigemNome, setNovoSubtipoOrigemNome] = useState('')
  const [novoSubtipoDestinoNome, setNovoSubtipoDestinoNome] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  // "+ Novo Lançamento" — mesmo padrão recolhido/expansível já usado em
  // Lançamento de Movimentações (app/movimentacoes/page.tsx)
  const [formularioAberto, setFormularioAberto] = useState(false)

  const [areaDisponivelOrigem, setAreaDisponivelOrigem] = useState<number | null>(null)
  const [carregandoAreaDisponivel, setCarregandoAreaDisponivel] = useState(false)

  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoArea[]>([])
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [avisoEdicaoFutura, setAvisoEdicaoFutura] = useState<{
    payload: Record<string, unknown>
    mensagem: string
  } | null>(null)

  // incorporar/desincorporar área — compra/venda de terra, muda o
  // total da fazenda (diferente de "Lançar mudança de uso", que só
  // realoca área que já existe). Formulário próprio, separado do de
  // mudança de uso, mesmo padrão "+ Novo Lançamento" recolhido.
  const [formAjusteAberto, setFormAjusteAberto] = useState(false)
  const [tipoAjuste, setTipoAjuste] = useState<'INCORPORACAO_AREA' | 'DESINCORPORACAO_AREA'>('INCORPORACAO_AREA')
  const [dataAjuste, setDataAjuste] = useState('')
  const [tipoUsoAjusteId, setTipoUsoAjusteId] = useState('')
  const [subtipoUsoAjusteId, setSubtipoUsoAjusteId] = useState('')
  const [novoSubtipoAjusteNome, setNovoSubtipoAjusteNome] = useState('')
  const [areaAjusteHa, setAreaAjusteHa] = useState('')
  const [observacaoAjuste, setObservacaoAjuste] = useState('')
  const [salvandoAjuste, setSalvandoAjuste] = useState(false)
  const [areaDisponivelAjuste, setAreaDisponivelAjuste] = useState<number | null>(null)
  const [carregandoAreaDisponivelAjuste, setCarregandoAreaDisponivelAjuste] = useState(false)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const tipoOrigemSelecionado = tiposUso.find((t) => t.id === tipoUsoOrigemId)
  const tipoDestinoSelecionado = tiposUso.find((t) => t.id === tipoUsoDestinoId)
  const tipoPecuaria = tiposUso.find((t) => t.nome === 'Pecuária')

  function subtiposDoTipo(tipoUsoId: string) {
    return subtiposUso.filter((s) => s.tipo_uso_id === tipoUsoId && s.ativo)
  }

  const mostrarSubtipoOrigem =
    controlaSubtipoArea &&
    !!tipoOrigemSelecionado &&
    TIPOS_COM_SUBTIPO.includes(tipoOrigemSelecionado.nome) &&
    subtiposDoTipo(tipoUsoOrigemId).length > 1
  const mostrarSubtipoDestino =
    controlaSubtipoArea &&
    !!tipoDestinoSelecionado &&
    TIPOS_COM_SUBTIPO.includes(tipoDestinoSelecionado.nome) &&
    subtiposDoTipo(tipoUsoDestinoId).length > 1

  const tipoAjusteSelecionado = tiposUso.find((t) => t.id === tipoUsoAjusteId)
  const mostrarSubtipoAjuste =
    controlaSubtipoArea &&
    !!tipoAjusteSelecionado &&
    TIPOS_COM_SUBTIPO.includes(tipoAjusteSelecionado.nome) &&
    subtiposDoTipo(tipoUsoAjusteId).length > 1

  const safra = periodoSafra(safraAnoInicio)
  const anoCalendario = periodoAno(anoCalendarioSelecionado)
  const dataInicio =
    modoFiltro === 'mes'
      ? `${mes}-01`
      : modoFiltro === 'safra'
        ? safra.dataInicio
        : modoFiltro === 'ano'
          ? anoCalendario.dataInicio
          : dataInicioCustom
  const dataFim =
    modoFiltro === 'mes'
      ? `${mes}-${String(ultimoDiaDoMes(mes)).padStart(2, '0')}`
      : modoFiltro === 'safra'
        ? safra.dataFim
        : modoFiltro === 'ano'
          ? anoCalendario.dataFim
          : dataFimCustom
  const periodoInvalido = modoFiltro === 'periodo' && dataInicioCustom > dataFimCustom

  useEffect(() => {
    supabase
      .from('tipos_uso_area')
      .select('id, nome')
      .order('ordem')
      .then(({ data }) => setTiposUso(data || []))
    supabase
      .from('subtipos_uso_area')
      .select('id, tipo_uso_id, nome, ativo')
      .order('ordem')
      .then(({ data }) => setSubtiposUso(data || []))
    supabase
      .from('configuracoes')
      .select('controla_subtipo_area, controla_pasto')
      .single()
      .then(({ data }) => {
        setControlaSubtipoArea(data?.controla_subtipo_area ?? false)
        setControlaPasto(data?.controla_pasto ?? false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function carregarDados(fId: string) {
    setLoading(true)
    const [{ data: fazenda }, { data: movs }] = await Promise.all([
      supabase.from('fazendas').select('id, nome, area_ha').eq('id', fId).single(),
      supabase
        .from('movimentacoes_area')
        .select(
          'id, tipo, data, tipo_uso_origem_id, tipo_uso_destino_id, subtipo_uso_origem_id, subtipo_uso_destino_id, area_ha, observacao, tipo_uso_origem:tipos_uso_area!tipo_uso_origem_id(nome), tipo_uso_destino:tipos_uso_area!tipo_uso_destino_id(nome), subtipo_uso_origem:subtipos_uso_area!subtipo_uso_origem_id(nome), subtipo_uso_destino:subtipos_uso_area!subtipo_uso_destino_id(nome)'
        )
        .eq('fazenda_id', fId)
        .in('tipo', ['MUDANCA_USO', 'INCORPORACAO_AREA', 'DESINCORPORACAO_AREA'])
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    setFazendaSelecionada(fazenda || null)
    setMovimentacoes((movs as unknown as MovimentacaoArea[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    carregarDados(fazendaId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  useEffect(() => {
    if (periodoInvalido) {
      setLinhasDistribuicao([])
      return
    }
    setLoadingDistribuicao(true)
    setErroDistribuicao(null)
    supabase
      .rpc('fn_relatorio_distribuicao_area', {
        p_fazenda_id: fazendaId,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
      })
      .then(({ data, error }) => {
        if (error) {
          setErroDistribuicao(error.message)
        } else {
          setLinhasDistribuicao(data || [])
        }
        setLoadingDistribuicao(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, dataInicio, dataFim, refreshKey])

  useEffect(() => {
    if (!dataFim || tiposUso.length === 0 || periodoInvalido) {
      setAreasFinais({})
      return
    }
    let cancelado = false
    Promise.all(
      tiposUso.map((t) =>
        supabase
          .rpc('fn_area_por_uso', { p_fazenda_id: fazendaId, p_tipo_uso_id: t.id, p_data: dataFim })
          .then(({ data: saldo }) => [t.id, saldo ?? 0] as const)
      )
    ).then((pares) => {
      if (!cancelado) setAreasFinais(Object.fromEntries(pares))
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, dataFim, tiposUso, periodoInvalido, refreshKey])

  // conferência com pastos: pastos ativos da fazenda (todos os módulos)
  // vs. área em Pecuária hoje
  useEffect(() => {
    if (!controlaPasto || !tipoPecuaria) {
      setPastosAtivos([])
      setAreaPecuariaHoje(null)
      return
    }
    let cancelado = false
    supabase
      .from('modulos')
      .select('id, pastos(id, nome, area_ha, ativo)')
      .eq('fazenda_id', fazendaId)
      // só módulos de Pecuária — desde que Agricultura existe (migração
      // 052, conversão pasto↔talhão), somar talhões aqui junto misturaria
      // a soma com a área de um tipo de uso diferente do denominador
      // (área em Pecuária) logo abaixo
      .eq('tipo_utilizacao', 'PECUARIA')
      .then(({ data }) => {
        if (cancelado) return
        const todos = ((data || []) as any[]).flatMap((m) => m.pastos || [])
        setPastosAtivos(todos.filter((p: PastoResumo) => p.ativo))
      })
    supabase
      .rpc('fn_area_por_uso', { p_fazenda_id: fazendaId, p_tipo_uso_id: tipoPecuaria.id, p_data: hoje })
      .then(({ data }) => {
        if (!cancelado) setAreaPecuariaHoje(data ?? 0)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlaPasto, tipoPecuaria?.id, fazendaId, refreshKey])

  useEffect(() => {
    if (!tipoUsoOrigemId || !data) {
      setAreaDisponivelOrigem(null)
      return
    }
    let cancelado = false
    setCarregandoAreaDisponivel(true)
    const usarSubtipo = subtipoUsoOrigemId && subtipoUsoOrigemId !== NOVO_SUBTIPO
    const chamada = usarSubtipo
      ? supabase.rpc('fn_area_por_subtipo_uso', {
          p_fazenda_id: fazendaId,
          p_tipo_uso_id: tipoUsoOrigemId,
          p_subtipo_uso_id: subtipoUsoOrigemId,
          p_data: data,
        })
      : supabase.rpc('fn_area_por_uso', { p_fazenda_id: fazendaId, p_tipo_uso_id: tipoUsoOrigemId, p_data: data })
    chamada.then(({ data: saldo, error }) => {
      if (cancelado) return
      setAreaDisponivelOrigem(error ? null : saldo)
      setCarregandoAreaDisponivel(false)
    })
    return () => {
      cancelado = true
    }
  }, [fazendaId, tipoUsoOrigemId, data, subtipoUsoOrigemId])

  // subtipo: some pro "Geral" sozinho quando o seletor está escondido
  // (controla_subtipo_area desligado, tipo de uso fora de Pecuária/
  // Agricultura, ou só um subtipo ativo) — mesmo princípio já usado
  // pro pasto em Movimentações e Controle de Pasto
  useEffect(() => {
    if (!tipoUsoOrigemId) {
      setSubtipoUsoOrigemId('')
      return
    }
    if (!mostrarSubtipoOrigem) {
      const geral = subtiposDoTipo(tipoUsoOrigemId).find((s) => s.nome === 'Geral') || subtiposDoTipo(tipoUsoOrigemId)[0]
      setSubtipoUsoOrigemId(geral ? geral.id : '')
    } else if (!subtiposDoTipo(tipoUsoOrigemId).some((s) => s.id === subtipoUsoOrigemId)) {
      setSubtipoUsoOrigemId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoUsoOrigemId, mostrarSubtipoOrigem, subtiposUso])

  useEffect(() => {
    if (!tipoUsoDestinoId) {
      setSubtipoUsoDestinoId('')
      return
    }
    if (!mostrarSubtipoDestino) {
      const geral = subtiposDoTipo(tipoUsoDestinoId).find((s) => s.nome === 'Geral') || subtiposDoTipo(tipoUsoDestinoId)[0]
      setSubtipoUsoDestinoId(geral ? geral.id : '')
    } else if (!subtiposDoTipo(tipoUsoDestinoId).some((s) => s.id === subtipoUsoDestinoId)) {
      setSubtipoUsoDestinoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoUsoDestinoId, mostrarSubtipoDestino, subtiposUso])

  useEffect(() => {
    if (!tipoUsoAjusteId) {
      setSubtipoUsoAjusteId('')
      return
    }
    if (!mostrarSubtipoAjuste) {
      const geral = subtiposDoTipo(tipoUsoAjusteId).find((s) => s.nome === 'Geral') || subtiposDoTipo(tipoUsoAjusteId)[0]
      setSubtipoUsoAjusteId(geral ? geral.id : '')
    } else if (!subtiposDoTipo(tipoUsoAjusteId).some((s) => s.id === subtipoUsoAjusteId)) {
      setSubtipoUsoAjusteId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoUsoAjusteId, mostrarSubtipoAjuste, subtiposUso])

  // área disponível só faz sentido pra desincorporar (precisa ter de
  // onde tirar) — incorporar nunca tem limite, área nova é o novo total
  useEffect(() => {
    if (tipoAjuste !== 'DESINCORPORACAO_AREA' || !tipoUsoAjusteId || !dataAjuste) {
      setAreaDisponivelAjuste(null)
      return
    }
    let cancelado = false
    setCarregandoAreaDisponivelAjuste(true)
    supabase
      .rpc('fn_area_por_uso', { p_fazenda_id: fazendaId, p_tipo_uso_id: tipoUsoAjusteId, p_data: dataAjuste })
      .then(({ data: saldo, error }) => {
        if (cancelado) return
        setAreaDisponivelAjuste(error ? null : saldo)
        setCarregandoAreaDisponivelAjuste(false)
      })
    return () => {
      cancelado = true
    }
  }, [fazendaId, tipoAjuste, tipoUsoAjusteId, dataAjuste])

  async function resolverSubtipoId(
    tipoUsoId: string,
    subtipoId: string,
    novoNome: string,
    mostrando: boolean
  ): Promise<string | null> {
    if (!mostrando) return subtipoId || null
    if (subtipoId === NOVO_SUBTIPO) {
      if (!novoNome.trim()) return null
      const { data: novoSubtipo, error } = await supabase
        .from('subtipos_uso_area')
        .insert({ tipo_uso_id: tipoUsoId, nome: novoNome.trim() })
        .select('id, tipo_uso_id, nome, ativo')
        .single()
      if (error) {
        alert('Erro ao cadastrar subtipo: ' + error.message)
        return null
      }
      setSubtiposUso((prev) => [...prev, novoSubtipo])
      return novoSubtipo.id
    }
    return subtipoId || null
  }

  function limparFormulario() {
    setData('')
    setTipoUsoOrigemId('')
    setTipoUsoDestinoId('')
    setAreaHa('')
    setSubtipoUsoOrigemId('')
    setSubtipoUsoDestinoId('')
    setNovoSubtipoOrigemNome('')
    setNovoSubtipoDestinoNome('')
    setObservacao('')
  }

  function iniciarEdicao(m: MovimentacaoArea) {
    setFormularioAberto(true)
    setEditandoId(m.id)
    setData(m.data)
    setTipoUsoOrigemId(m.tipo_uso_origem_id || '')
    setTipoUsoDestinoId(m.tipo_uso_destino_id || '')
    setAreaHa(String(m.area_ha))
    setSubtipoUsoOrigemId(m.subtipo_uso_origem_id || '')
    setSubtipoUsoDestinoId(m.subtipo_uso_destino_id || '')
    setObservacao(m.observacao || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() {
    setEditandoId(null)
    limparFormulario()
  }

  function handleFecharFormulario() {
    if (editandoId) {
      cancelarEdicao()
    } else {
      limparFormulario()
    }
    setFormularioAberto(false)
  }

  function limparFormularioAjuste() {
    setDataAjuste('')
    setTipoUsoAjusteId('')
    setSubtipoUsoAjusteId('')
    setNovoSubtipoAjusteNome('')
    setAreaAjusteHa('')
    setObservacaoAjuste('')
  }

  function handleFecharFormAjuste() {
    limparFormularioAjuste()
    setFormAjusteAberto(false)
  }

  async function handleSubmitAjuste(e: React.FormEvent) {
    e.preventDefault()
    if (!dataAjuste || !tipoUsoAjusteId || !areaAjusteHa) return
    if (mostrarSubtipoAjuste && subtipoUsoAjusteId === NOVO_SUBTIPO && !novoSubtipoAjusteNome.trim()) {
      alert('Informe o nome do novo subtipo.')
      return
    }

    const areaNum = parseFloat(areaAjusteHa)
    if (tipoAjuste === 'DESINCORPORACAO_AREA' && areaDisponivelAjuste !== null && areaNum > areaDisponivelAjuste) {
      alert('Área indisponível nesse tipo de uso para a data desejada.')
      return
    }

    const subtipoFinal = await resolverSubtipoId(tipoUsoAjusteId, subtipoUsoAjusteId, novoSubtipoAjusteNome, mostrarSubtipoAjuste)
    if (mostrarSubtipoAjuste && !subtipoFinal) return

    const payload: Record<string, unknown> = {
      fazenda_id: fazendaId,
      tipo: tipoAjuste,
      data: dataAjuste,
      area_ha: areaNum,
      observacao: observacaoAjuste.trim() || null,
      tipo_uso_origem_id: tipoAjuste === 'DESINCORPORACAO_AREA' ? tipoUsoAjusteId : null,
      tipo_uso_destino_id: tipoAjuste === 'INCORPORACAO_AREA' ? tipoUsoAjusteId : null,
      subtipo_uso_origem_id: tipoAjuste === 'DESINCORPORACAO_AREA' ? subtipoFinal : null,
      subtipo_uso_destino_id: tipoAjuste === 'INCORPORACAO_AREA' ? subtipoFinal : null,
    }

    setSalvandoAjuste(true)
    const { error } = await supabase.from('movimentacoes_area').insert(payload)
    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      handleFecharFormAjuste()
      await carregarDados(fazendaId)
      setRefreshKey((k) => k + 1)
      onAreaChanged?.()
    }
    setSalvandoAjuste(false)
  }

  async function salvarEdicao(payloadFinal: Record<string, unknown>) {
    if (!editandoId) return
    setSalvando(true)
    const { error } = await supabase.from('movimentacoes_area').update(payloadFinal).eq('id', editandoId)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setEditandoId(null)
      limparFormulario()
      setFormularioAberto(false)
      await carregarDados(fazendaId)
      setRefreshKey((k) => k + 1)
      onAreaChanged?.()
    }
    setAvisoEdicaoFutura(null)
    setSalvando(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!data || !tipoUsoOrigemId || !tipoUsoDestinoId || !areaHa) return
    if (tipoUsoOrigemId === tipoUsoDestinoId) {
      alert('Selecione tipos de uso de origem e destino diferentes.')
      return
    }
    if (mostrarSubtipoOrigem && subtipoUsoOrigemId === NOVO_SUBTIPO && !novoSubtipoOrigemNome.trim()) {
      alert('Informe o nome do novo subtipo de origem.')
      return
    }
    if (mostrarSubtipoDestino && subtipoUsoDestinoId === NOVO_SUBTIPO && !novoSubtipoDestinoNome.trim()) {
      alert('Informe o nome do novo subtipo de destino.')
      return
    }

    const areaNum = parseFloat(areaHa)
    if (areaDisponivelOrigem !== null && areaNum > areaDisponivelOrigem) {
      alert('Área indisponível nesse tipo de uso para a data desejada.')
      return
    }

    const subtipoOrigemFinal = await resolverSubtipoId(tipoUsoOrigemId, subtipoUsoOrigemId, novoSubtipoOrigemNome, mostrarSubtipoOrigem)
    if (mostrarSubtipoOrigem && !subtipoOrigemFinal) return
    const subtipoDestinoFinal = await resolverSubtipoId(tipoUsoDestinoId, subtipoUsoDestinoId, novoSubtipoDestinoNome, mostrarSubtipoDestino)
    if (mostrarSubtipoDestino && !subtipoDestinoFinal) return

    const payload: Record<string, unknown> = {
      fazenda_id: fazendaId,
      tipo: 'MUDANCA_USO',
      data,
      tipo_uso_origem_id: tipoUsoOrigemId,
      tipo_uso_destino_id: tipoUsoDestinoId,
      subtipo_uso_origem_id: subtipoOrigemFinal,
      subtipo_uso_destino_id: subtipoDestinoFinal,
      area_ha: areaNum,
      observacao: observacao.trim() || null,
    }

    if (editandoId) {
      setSalvando(true)
      const { data: check, error: checkError } = await supabase.rpc('fn_checar_edicao_area', {
        p_id: editandoId,
        p_fazenda_id: fazendaId,
        p_tipo: 'MUDANCA_USO',
        p_tipo_uso_origem_id: tipoUsoOrigemId,
        p_tipo_uso_destino_id: tipoUsoDestinoId,
        p_data: data,
        p_area_ha: areaNum,
      })
      setSalvando(false)

      if (checkError) {
        alert('Erro ao validar edição: ' + checkError.message)
        return
      }

      const resultado: ChecagemEdicaoArea | undefined = Array.isArray(check) ? check[0] : check

      if (resultado?.saldo_ficaria_negativo) {
        alert(
          `Não é possível editar: a área de ${resultado.tipo_uso_saldo_negativo} ficaria negativa (${resultado.saldo_minimo}) em ${resultado.data_saldo_negativo}.`
        )
        return
      }

      if (resultado?.tem_movimentacoes_futuras) {
        setAvisoEdicaoFutura({
          payload,
          mensagem: 'Existem mudanças de uso posteriores desses mesmos tipos de uso. Confirma a edição mesmo assim?',
        })
        return
      }

      await salvarEdicao(payload)
      return
    }

    setSalvando(true)
    const { error } = await supabase.from('movimentacoes_area').insert(payload)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      limparFormulario()
      setFormularioAberto(false)
      await carregarDados(fazendaId)
      setRefreshKey((k) => k + 1)
      onAreaChanged?.()
    }
    setSalvando(false)
  }

  const areaTotalFazenda = fazendaSelecionada?.area_ha ?? null

  // --- distribuição de área: monta colunas (meses) e linhas (tipo de uso) ---
  const mesesMap = new Map<string, MesColuna & { total: number }>()
  linhasDistribuicao.forEach((l) => {
    const chave = `${l.ano}-${String(l.mes).padStart(2, '0')}`
    if (!mesesMap.has(chave)) {
      mesesMap.set(chave, {
        chave,
        label: `${NOMES_MES_ABREV[l.mes - 1]}/${String(l.ano).slice(2)}`,
        dias: l.dias_no_mes,
        total: 0,
      })
    }
    mesesMap.get(chave)!.total += l.area_media_ponderada
  })
  const mesesColunas: MesColuna[] = [...mesesMap.values()]
    .sort((a, b) => (a.chave < b.chave ? -1 : 1))
    .filter((m) => m.total > 0)
  const chavesVisiveis = new Set(mesesColunas.map((m) => m.chave))
  const diasTotais = mesesColunas.reduce((s, m) => s + m.dias, 0)

  const linhasTipoUso: TipoUsoLinha[] = []
  linhasDistribuicao.forEach((l) => {
    const chave = `${l.ano}-${String(l.mes).padStart(2, '0')}`
    if (!chavesVisiveis.has(chave)) return
    let linha = linhasTipoUso.find((t) => t.tipo_uso_id === l.tipo_uso_id)
    if (!linha) {
      linha = { tipo_uso_id: l.tipo_uso_id, tipo_uso_nome: l.tipo_uso_nome, porMes: {}, areaMedia: 0 }
      linhasTipoUso.push(linha)
    }
    linha.porMes[chave] = l.area_media_ponderada
  })
  linhasTipoUso.forEach((linha) => {
    const somaPonderada = mesesColunas.reduce((s, m) => s + (linha.porMes[m.chave] || 0) * m.dias, 0)
    linha.areaMedia = diasTotais > 0 ? round2(somaPonderada / diasTotais) : 0
  })
  const linhasTipoUsoVisiveis = linhasTipoUso.filter((l) => mesesColunas.some((m) => (l.porMes[m.chave] || 0) > 0))

  const totalPorMes: Record<string, number> = {}
  mesesColunas.forEach((m) => {
    totalPorMes[m.chave] = linhasTipoUsoVisiveis.reduce((s, l) => s + (l.porMes[m.chave] || 0), 0)
  })
  const areaMediaGeral = round2(linhasTipoUsoVisiveis.reduce((s, l) => s + l.areaMedia, 0))

  const somaPastosAtivos = round2(pastosAtivos.reduce((s, p) => s + (p.area_ha || 0), 0))
  const pastosSemArea = pastosAtivos.filter((p) => p.area_ha == null).length

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-card border border-border bg-bg p-5">
        <h3 className="text-sm font-semibold text-text-primary">Distribuição de área</h3>

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={() => setModoFiltro('mes')}
            className={`rounded-control border px-3 py-1.5 ${
              modoFiltro === 'mes' ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
            }`}
          >
            Mês
          </button>
          <button
            type="button"
            onClick={() => setModoFiltro('safra')}
            className={`rounded-control border px-3 py-1.5 ${
              modoFiltro === 'safra' ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
            }`}
          >
            Ano Safra
          </button>
          <button
            type="button"
            onClick={() => setModoFiltro('ano')}
            className={`rounded-control border px-3 py-1.5 ${
              modoFiltro === 'ano' ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
            }`}
          >
            Ano Calendário
          </button>
          <button
            type="button"
            onClick={() => setModoFiltro('periodo')}
            className={`rounded-control border px-3 py-1.5 ${
              modoFiltro === 'periodo' ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
            }`}
          >
            Período personalizado
          </button>
        </div>

        <div className="mt-3">
          {modoFiltro === 'mes' ? (
            <input
              type="month"
              className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          ) : modoFiltro === 'periodo' ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={dataInicioCustom}
                onChange={(e) => setDataInicioCustom(e.target.value)}
              />
              <span className="text-text-muted">até</span>
              <input
                type="date"
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={dataFimCustom}
                onChange={(e) => setDataFimCustom(e.target.value)}
              />
            </div>
          ) : modoFiltro === 'safra' ? (
            <div className="flex items-center gap-2">
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
              <p className="text-sm text-text-secondary">
                {formatarData(dataInicio)} até {formatarData(dataFim)}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
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
              <p className="text-sm text-text-secondary">
                {formatarData(dataInicio)} até {formatarData(dataFim)}
              </p>
            </div>
          )}
          {periodoInvalido && <p className="mt-1 text-xs text-error">A data inicial não pode ser depois da data final.</p>}
        </div>

        {periodoInvalido ? (
          <p className="mt-4 text-sm text-error">Corrija o período antes de continuar.</p>
        ) : loadingDistribuicao ? (
          <div className="mt-4 h-40 animate-pulse rounded-control bg-border" />
        ) : erroDistribuicao ? (
          <p className="mt-4 text-sm text-error">Erro: {erroDistribuicao}</p>
        ) : mesesColunas.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">Sem dados de área nesse período.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-4 text-xs">
              {linhasTipoUsoVisiveis.map((l) => (
                <div key={l.tipo_uso_id} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: corTipoUsoArea(l.tipo_uso_nome) }} />
                  {l.tipo_uso_nome}
                </div>
              ))}
            </div>

            <div
              className="mx-auto mt-3 mb-6 flex max-w-3xl items-end justify-center gap-3 rounded-control border border-border bg-surface p-4"
              style={{ height: 270 }}
            >
              {mesesColunas.map((m) => (
                <div key={m.chave} className="flex flex-1 flex-col items-center gap-1" style={{ maxWidth: 64 }}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: 220 }}>
                    {linhasTipoUsoVisiveis.map((l) => {
                      const valor = l.porMes[m.chave] || 0
                      const maior = Math.max(1, ...mesesColunas.map((mm) => totalPorMes[mm.chave]))
                      const alturaPx = (valor / maior) * 220
                      return valor > 0 ? (
                        <div
                          key={l.tipo_uso_id}
                          style={{ height: alturaPx, backgroundColor: corTipoUsoArea(l.tipo_uso_nome) }}
                          title={`${l.tipo_uso_nome}: ${formatArea(valor)} ha`}
                        />
                      ) : null
                    })}
                  </div>
                  <span className="text-xs text-text-secondary">{m.label}</span>
                </div>
              ))}
            </div>

            {/* tabela cruzada (tipo de uso × mês) — telas md e acima */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border p-2 text-left font-medium text-text-secondary">Tipo de uso</th>
                    {mesesColunas.map((m) => (
                      <th key={m.chave} className="border-b border-border p-2 text-right font-medium text-text-secondary">
                        {m.label}
                      </th>
                    ))}
                    <th className="border-b border-border p-2 text-right font-semibold text-text-primary">Área média</th>
                    <th
                      className="cursor-help border-b border-border p-2 text-right font-semibold text-text-primary underline decoration-dotted decoration-text-muted"
                      title="Área alocada nesse tipo de uso no último dia do período — não é uma média, é o estado no final do período."
                    >
                      Área final
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhasTipoUsoVisiveis.map((l) => (
                    <tr key={l.tipo_uso_id}>
                      <td className="border-b border-border p-2 text-text-primary">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: corTipoUsoArea(l.tipo_uso_nome) }} />
                        {l.tipo_uso_nome}
                      </td>
                      {mesesColunas.map((m) => (
                        <td key={m.chave} className="border-b border-border p-2 text-right tabular-nums text-text-secondary">
                          {l.porMes[m.chave] ? formatArea(l.porMes[m.chave]) : ''}
                        </td>
                      ))}
                      <td className="border-b border-border p-2 text-right font-semibold tabular-nums text-text-primary">{formatArea(l.areaMedia)}</td>
                      <td className="border-b border-border p-2 text-right font-semibold tabular-nums text-text-primary">
                        {formatArea(areasFinais[l.tipo_uso_id] ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="p-2 text-text-primary">Total</td>
                    {mesesColunas.map((m) => (
                      <td key={m.chave} className="p-2 text-right tabular-nums">
                        {formatArea(totalPorMes[m.chave])}
                      </td>
                    ))}
                    <td className="p-2 text-right tabular-nums">{formatArea(areaMediaGeral)}</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatArea(round2(linhasTipoUsoVisiveis.reduce((s, l) => s + (areasFinais[l.tipo_uso_id] ?? 0), 0)))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* cards — abaixo de md, o detalhe mês a mês fica só na tabela (com
                rolagem própria se reaberta numa tela maior); no card mostramos
                o resumo que importa pra decisão rápida: média e área final */}
            <div className="flex flex-col gap-2 md:hidden">
              {linhasTipoUsoVisiveis.map((l) => (
                <div key={l.tipo_uso_id} className="rounded-control border border-border bg-surface p-3">
                  <div className="flex items-center gap-1.5 font-medium text-text-primary">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: corTipoUsoArea(l.tipo_uso_nome) }} />
                    {l.tipo_uso_nome}
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-text-secondary">Área média</span>
                    <span className="tabular-nums text-text-primary">{formatArea(l.areaMedia)} ha</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-text-secondary" title="Área alocada nesse tipo de uso no último dia do período.">
                      Área final
                    </span>
                    <span className="tabular-nums text-text-primary">{formatArea(areasFinais[l.tipo_uso_id] ?? 0)} ha</span>
                  </div>
                </div>
              ))}
              <div className="rounded-control border border-border bg-brand-100 p-3 font-semibold">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-text-primary">Total — Área média</span>
                  <span className="tabular-nums text-text-primary">{formatArea(areaMediaGeral)} ha</span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-text-primary">Total — Área final</span>
                  <span className="tabular-nums text-text-primary">
                    {formatArea(round2(linhasTipoUsoVisiveis.reduce((s, l) => s + (areasFinais[l.tipo_uso_id] ?? 0), 0)))} ha
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {controlaPasto && (
        <div className="rounded-card border border-border bg-bg p-5">
          <h3 className="text-sm font-semibold text-text-primary">Conferência com pastos</h3>
          <p className="mt-1 text-xs text-text-muted">
            Soma da área dos pastos ativos (aba "Módulos e Pastos") vs. área alocada em Pecuária hoje — os pastos
            continuam livres, sem vínculo por subtipo; é só uma conferência visual.
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="text-text-secondary">
              Soma dos pastos ativos:{' '}
              <b className="text-text-primary">{formatArea(somaPastosAtivos)} ha</b>
              {pastosSemArea > 0 && (
                <span className="text-text-muted"> ({formatQuantidade(pastosSemArea)} sem área declarada)</span>
              )}
            </span>
            <span className="text-text-secondary">
              Área em Pecuária hoje:{' '}
              <b className="text-text-primary">{areaPecuariaHoje != null ? `${formatArea(areaPecuariaHoje)} ha` : '—'}</b>
            </span>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border bg-bg p-5">
        <div className="mb-4 text-sm text-text-secondary">
          Área total da fazenda:{' '}
          {areaTotalFazenda != null ? (
            <strong className="text-text-primary">{formatArea(areaTotalFazenda)} ha</strong>
          ) : (
            <span className="text-warning">não informada — preencha na edição da fazenda pra validar o limite entre os tipos de uso.</span>
          )}
        </div>

        {!formularioAberto ? (
          <button
            type="button"
            onClick={() => setFormularioAberto(true)}
            className="flex w-full items-center justify-center gap-2 rounded-control border-[1.5px] border-dashed border-brand-500 bg-brand-100/40 py-3.5 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nova mudança de uso
          </button>
        ) : (
        <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">{editandoId ? 'Editar mudança de uso' : 'Nova mudança de uso'}</h3>
            <button type="button" onClick={handleFecharFormulario} className="text-xs text-text-secondary underline">
              Fechar
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Data
                <Required />
              </label>
              <input
                type="date"
                max={hoje}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={data}
                onChange={(e) => setData(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Tipo de uso origem
                <Required />
              </label>
              <select
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={tipoUsoOrigemId}
                onChange={(e) => setTipoUsoOrigemId(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {tiposUso.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Tipo de uso destino
                <Required />
              </label>
              <select
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={tipoUsoDestinoId}
                onChange={(e) => setTipoUsoDestinoId(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {tiposUso.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>
            {mostrarSubtipoOrigem && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Subtipo de origem
                  <Required />
                </label>
                <select
                  className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={subtipoUsoOrigemId}
                  onChange={(e) => setSubtipoUsoOrigemId(e.target.value)}
                  required
                >
                  <option value="">Selecione...</option>
                  {subtiposDoTipo(tipoUsoOrigemId).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                  <option value={NOVO_SUBTIPO}>+ Novo subtipo...</option>
                </select>
                {subtipoUsoOrigemId === NOVO_SUBTIPO && (
                  <input
                    className="mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={novoSubtipoOrigemNome}
                    onChange={(e) => setNovoSubtipoOrigemNome(e.target.value)}
                    placeholder="Nome do novo subtipo"
                  />
                )}
              </div>
            )}
            {mostrarSubtipoDestino && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Subtipo de destino
                  <Required />
                </label>
                <select
                  className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={subtipoUsoDestinoId}
                  onChange={(e) => setSubtipoUsoDestinoId(e.target.value)}
                  required
                >
                  <option value="">Selecione...</option>
                  {subtiposDoTipo(tipoUsoDestinoId).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                  <option value={NOVO_SUBTIPO}>+ Novo subtipo...</option>
                </select>
                {subtipoUsoDestinoId === NOVO_SUBTIPO && (
                  <input
                    className="mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={novoSubtipoDestinoNome}
                    onChange={(e) => setNovoSubtipoDestinoNome(e.target.value)}
                    placeholder="Nome do novo subtipo"
                  />
                )}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Área (ha)
                <Required />
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={areaHa}
                onChange={(e) => setAreaHa(e.target.value)}
                required
              />
              {tipoUsoOrigemId && data && (
                <p
                  className={`mt-1 text-xs ${
                    areaDisponivelOrigem !== null && areaHa && parseFloat(areaHa) > areaDisponivelOrigem ? 'text-error' : 'text-text-secondary'
                  }`}
                >
                  {carregandoAreaDisponivel
                    ? 'Consultando área disponível...'
                    : areaDisponivelOrigem !== null
                      ? `Área disponível: ${formatArea(areaDisponivelOrigem)} ha${
                          areaHa && parseFloat(areaHa) > areaDisponivelOrigem ? ' — área indisponível nesse tipo de uso para a data desejada' : ''
                        }`
                      : ''}
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Observação</label>
              <textarea
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={salvando}
              className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : editandoId ? 'Salvar edição' : 'Salvar mudança de uso'}
            </button>
            {editandoId && (
              <button type="button" className="rounded-control border border-border px-4 py-2 text-sm text-text-primary" onClick={cancelarEdicao}>
                Cancelar edição
              </button>
            )}
          </div>
        </form>
        )}

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="mb-1 text-sm font-semibold text-text-primary">Incorporar ou desincorporar área</h3>
          <p className="mb-3 text-xs text-text-secondary">
            Pra quando a fazenda compra uma área nova (incorpora ao total) ou vende um pedaço (desincorpora) — diferente
            de "Lançar mudança de uso", que só realoca área que já existe entre tipos de uso.
          </p>

          {!formAjusteAberto ? (
            <button
              type="button"
              onClick={() => setFormAjusteAberto(true)}
              className="flex w-full items-center justify-center gap-2 rounded-control border-[1.5px] border-dashed border-brand-500 bg-brand-100/40 py-3.5 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Incorporar/desincorporar área
            </button>
          ) : (
            <form onSubmit={handleSubmitAjuste} onKeyDown={bloquearEnvioPorEnter} className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text-primary">Nova incorporação/desincorporação</h4>
                <button type="button" onClick={handleFecharFormAjuste} className="text-xs text-text-secondary underline">
                  Fechar
                </button>
              </div>

              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setTipoAjuste('INCORPORACAO_AREA')}
                  className={`rounded-control border px-3 py-1.5 ${
                    tipoAjuste === 'INCORPORACAO_AREA'
                      ? 'border-brand-500 bg-brand-100 text-brand-700'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  Incorporar (comprei uma área)
                </button>
                <button
                  type="button"
                  onClick={() => setTipoAjuste('DESINCORPORACAO_AREA')}
                  className={`rounded-control border px-3 py-1.5 ${
                    tipoAjuste === 'DESINCORPORACAO_AREA'
                      ? 'border-brand-500 bg-brand-100 text-brand-700'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  Desincorporar (vendi uma área)
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Data
                    <Required />
                  </label>
                  <input
                    type="date"
                    max={hoje}
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={dataAjuste}
                    onChange={(e) => setDataAjuste(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    {tipoAjuste === 'INCORPORACAO_AREA' ? 'Tipo de uso de destino' : 'Tipo de uso de origem'}
                    <Required />
                  </label>
                  <select
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={tipoUsoAjusteId}
                    onChange={(e) => setTipoUsoAjusteId(e.target.value)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {tiposUso.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </div>
                {mostrarSubtipoAjuste && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Subtipo
                      <Required />
                    </label>
                    <select
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                      value={subtipoUsoAjusteId}
                      onChange={(e) => setSubtipoUsoAjusteId(e.target.value)}
                      required
                    >
                      <option value="">Selecione...</option>
                      {subtiposDoTipo(tipoUsoAjusteId).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome}
                        </option>
                      ))}
                      <option value={NOVO_SUBTIPO}>+ Novo subtipo...</option>
                    </select>
                    {subtipoUsoAjusteId === NOVO_SUBTIPO && (
                      <input
                        className="mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                        value={novoSubtipoAjusteNome}
                        onChange={(e) => setNovoSubtipoAjusteNome(e.target.value)}
                        placeholder="Nome do novo subtipo"
                      />
                    )}
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Área (ha)
                    <Required />
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={areaAjusteHa}
                    onChange={(e) => setAreaAjusteHa(e.target.value)}
                    required
                  />
                  {tipoAjuste === 'DESINCORPORACAO_AREA' && tipoUsoAjusteId && dataAjuste && (
                    <p
                      className={`mt-1 text-xs ${
                        areaDisponivelAjuste !== null && areaAjusteHa && parseFloat(areaAjusteHa) > areaDisponivelAjuste
                          ? 'text-error'
                          : 'text-text-secondary'
                      }`}
                    >
                      {carregandoAreaDisponivelAjuste
                        ? 'Consultando área disponível...'
                        : areaDisponivelAjuste !== null
                          ? `Área disponível: ${formatArea(areaDisponivelAjuste)} ha${
                              areaAjusteHa && parseFloat(areaAjusteHa) > areaDisponivelAjuste
                                ? ' — área indisponível nesse tipo de uso para a data desejada'
                                : ''
                            }`
                          : ''}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Observação</label>
                  <textarea
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={observacaoAjuste}
                    onChange={(e) => setObservacaoAjuste(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={salvandoAjuste}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvandoAjuste ? 'Salvando...' : tipoAjuste === 'INCORPORACAO_AREA' ? 'Incorporar área' : 'Desincorporar área'}
              </button>
            </form>
          )}
        </div>

        <h3 className="mt-8 mb-3 text-sm font-semibold text-text-primary">Últimas movimentações de área</h3>
        {loading ? (
          <div className="h-16 animate-pulse rounded-control bg-border" />
        ) : movimentacoes.length === 0 ? (
          <p className="text-sm text-text-secondary">Nenhuma movimentação de área lançada ainda.</p>
        ) : (
          <div className="space-y-3">
            {movimentacoes.map((m) => (
              <div key={m.id} className="rounded-card border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <strong className="text-sm text-text-primary">{labelMovimentacao(m)}</strong>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-secondary">{m.data}</span>
                    {m.tipo === 'MUDANCA_USO' && (
                      <button type="button" className="text-xs text-brand-500 underline" onClick={() => iniciarEdicao(m)}>
                        Editar
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-sm text-text-secondary">{formatArea(m.area_ha)} ha</div>
                {m.observacao && <div className="text-sm italic text-text-muted">{m.observacao}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {avisoEdicaoFutura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">Confirmar edição</h2>
            <p className="text-sm text-text-secondary">{avisoEdicaoFutura.mensagem}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                onClick={() => setAvisoEdicaoFutura(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                onClick={() => salvarEdicao(avisoEdicaoFutura.payload)}
              >
                {salvando ? 'Salvando...' : 'Confirmar edição'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
