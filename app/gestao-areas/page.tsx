'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { corTipoUsoArea } from '@/lib/area-cores'
import { formatArea } from '@/lib/format'
import {
  ultimoDiaDoMes,
  periodoSafra,
  periodoAno,
  anoInicioSafraAtual,
  anoCalendarioAtual,
  opcoesSafra,
  opcoesAno,
} from '@/lib/periodo'

type Fazenda = { id: string; nome: string; area_ha: number | null }
type TipoUsoArea = { id: string; nome: string }

type MovimentacaoArea = {
  id: string
  data: string
  tipo_uso_origem_id: string | null
  tipo_uso_destino_id: string
  area_ha: number
  cultura: string | null
  observacao: string | null
  tipo_uso_origem: { nome: string } | null
  tipo_uso_destino: { nome: string } | null
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

const NOMES_MES_ABREV = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

export default function GestaoAreasPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaId, setFazendaId] = useState('')
  const [fazendaSelecionada, setFazendaSelecionada] = useState<Fazenda | null>(null)
  const [tiposUso, setTiposUso] = useState<TipoUsoArea[]>([])
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

  // lançamento de mudança de uso
  const [data, setData] = useState('')
  const [tipoUsoOrigemId, setTipoUsoOrigemId] = useState('')
  const [tipoUsoDestinoId, setTipoUsoDestinoId] = useState('')
  const [areaHa, setAreaHa] = useState('')
  const [cultura, setCultura] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [areaDisponivelOrigem, setAreaDisponivelOrigem] = useState<number | null>(null)
  const [carregandoAreaDisponivel, setCarregandoAreaDisponivel] = useState(false)

  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoArea[]>([])
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [avisoEdicaoFutura, setAvisoEdicaoFutura] = useState<{
    payload: Record<string, unknown>
    mensagem: string
  } | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const tipoDestinoSelecionado = tiposUso.find((t) => t.id === tipoUsoDestinoId)
  const precisaCultura = tipoDestinoSelecionado?.nome === 'Agricultura'

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
      .from('fazendas')
      .select('id, nome, area_ha')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => {
        setFazendas(data || [])
        if (data && data.length === 1) setFazendaId(data[0].id)
      })
    supabase
      .from('tipos_uso_area')
      .select('id, nome')
      .order('ordem')
      .then(({ data }) => setTiposUso(data || []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function carregarDados(fId: string) {
    setLoading(true)
    const [{ data: fazenda }, { data: movs }] = await Promise.all([
      supabase.from('fazendas').select('id, nome, area_ha').eq('id', fId).single(),
      supabase
        .from('movimentacoes_area')
        .select(
          'id, data, tipo_uso_origem_id, tipo_uso_destino_id, area_ha, cultura, observacao, tipo_uso_origem:tipos_uso_area!tipo_uso_origem_id(nome), tipo_uso_destino:tipos_uso_area!tipo_uso_destino_id(nome)'
        )
        .eq('fazenda_id', fId)
        .eq('tipo', 'MUDANCA_USO')
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    setFazendaSelecionada(fazenda || null)
    setMovimentacoes((movs as unknown as MovimentacaoArea[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    if (fazendaId) {
      carregarDados(fazendaId)
    } else {
      setFazendaSelecionada(null)
      setMovimentacoes([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  useEffect(() => {
    if (!fazendaId || periodoInvalido) {
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
  }, [fazendaId, dataInicio, dataFim])

  useEffect(() => {
    if (!fazendaId || !dataFim || tiposUso.length === 0 || periodoInvalido) {
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
  }, [fazendaId, dataFim, tiposUso, periodoInvalido])

  useEffect(() => {
    if (!fazendaId || !tipoUsoOrigemId || !data) {
      setAreaDisponivelOrigem(null)
      return
    }
    let cancelado = false
    setCarregandoAreaDisponivel(true)
    supabase
      .rpc('fn_area_por_uso', { p_fazenda_id: fazendaId, p_tipo_uso_id: tipoUsoOrigemId, p_data: data })
      .then(({ data: saldo, error }) => {
        if (cancelado) return
        setAreaDisponivelOrigem(error ? null : saldo)
        setCarregandoAreaDisponivel(false)
      })
    return () => {
      cancelado = true
    }
  }, [fazendaId, tipoUsoOrigemId, data])

  useEffect(() => {
    if (!precisaCultura) setCultura('')
  }, [precisaCultura])

  function limparFormulario() {
    setData('')
    setTipoUsoOrigemId('')
    setTipoUsoDestinoId('')
    setAreaHa('')
    setCultura('')
    setObservacao('')
  }

  function iniciarEdicao(m: MovimentacaoArea) {
    setEditandoId(m.id)
    setData(m.data)
    setTipoUsoOrigemId(m.tipo_uso_origem_id || '')
    setTipoUsoDestinoId(m.tipo_uso_destino_id)
    setAreaHa(String(m.area_ha))
    setCultura(m.cultura || '')
    setObservacao(m.observacao || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() {
    setEditandoId(null)
    limparFormulario()
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
      await carregarDados(fazendaId)
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
    if (precisaCultura && !cultura.trim()) {
      alert('Informe a cultura.')
      return
    }

    const areaNum = parseFloat(areaHa)
    if (areaDisponivelOrigem !== null && areaNum > areaDisponivelOrigem) {
      alert('Área indisponível nesse tipo de uso para a data desejada.')
      return
    }

    const payload: Record<string, unknown> = {
      fazenda_id: fazendaId,
      tipo: 'MUDANCA_USO',
      data,
      tipo_uso_origem_id: tipoUsoOrigemId,
      tipo_uso_destino_id: tipoUsoDestinoId,
      area_ha: areaNum,
      cultura: precisaCultura ? cultura.trim() : null,
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
      await carregarDados(fazendaId)
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
  // área nunca "some" depois de declarada — só realoca entre tipos de
  // uso — então um mês com total zerado só pode significar que ainda
  // não havia saldo inicial declarado naquela data.
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
  // linha 100% zerada no período visível não precisa aparecer
  const linhasTipoUsoVisiveis = linhasTipoUso.filter((l) => mesesColunas.some((m) => (l.porMes[m.chave] || 0) > 0))

  const totalPorMes: Record<string, number> = {}
  mesesColunas.forEach((m) => {
    totalPorMes[m.chave] = linhasTipoUsoVisiveis.reduce((s, l) => s + (l.porMes[m.chave] || 0), 0)
  })
  const areaMediaGeral = round2(linhasTipoUsoVisiveis.reduce((s, l) => s + l.areaMedia, 0))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Gestão de áreas</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Distribuição de área e mudanças de uso do solo por fazenda. A área inicial de cada fazenda é declarada em
        "Fazendas".
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-5">
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">
          Fazenda
          <Required />
        </label>
        <select
          className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
          value={fazendaId}
          onChange={(e) => setFazendaId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {fazendas.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </div>

      {!fazendaId ? (
        <div className="mt-6 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Selecione uma fazenda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Escolha a fazenda acima para ver a distribuição de área e lançar mudanças de uso.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-card border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold text-text-primary">Distribuição de área</h2>

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
              {periodoInvalido && (
                <p className="mt-1 text-xs text-error">A data inicial não pode ser depois da data final.</p>
              )}
            </div>

            {periodoInvalido ? (
              <p className="mt-4 text-sm text-error">Corrija o período antes de continuar.</p>
            ) : loadingDistribuicao ? (
              <div className="mt-4 animate-pulse h-40 rounded-control bg-border" />
            ) : erroDistribuicao ? (
              <p className="mt-4 text-sm text-error">Erro: {erroDistribuicao}</p>
            ) : mesesColunas.length === 0 ? (
              <p className="mt-4 text-sm text-text-secondary">Sem dados de área nesse período.</p>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-4 text-xs">
                  {linhasTipoUsoVisiveis.map((l) => (
                    <div key={l.tipo_uso_id} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ backgroundColor: corTipoUsoArea(l.tipo_uso_nome) }}
                      />
                      {l.tipo_uso_nome}
                    </div>
                  ))}
                </div>

                <div
                  className="mx-auto mt-3 mb-6 flex max-w-3xl items-end justify-center gap-3 rounded-control border border-border p-4"
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

                <div className="overflow-x-auto">
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
                            <span
                              className="mr-1.5 inline-block h-2 w-2 rounded-sm"
                              style={{ backgroundColor: corTipoUsoArea(l.tipo_uso_nome) }}
                            />
                            {l.tipo_uso_nome}
                          </td>
                          {mesesColunas.map((m) => (
                            <td key={m.chave} className="border-b border-border p-2 text-right tabular-nums text-text-secondary">
                              {l.porMes[m.chave] ? formatArea(l.porMes[m.chave]) : ''}
                            </td>
                          ))}
                          <td className="border-b border-border p-2 text-right font-semibold tabular-nums text-text-primary">
                            {formatArea(l.areaMedia)}
                          </td>
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
                          {formatArea(
                            round2(linhasTipoUsoVisiveis.reduce((s, l) => s + (areasFinais[l.tipo_uso_id] ?? 0), 0))
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 rounded-card border border-border bg-surface p-6">
            <div className="mb-4 text-sm text-text-secondary">
              Área total da fazenda:{' '}
              {areaTotalFazenda != null ? (
                <strong className="text-text-primary">{formatArea(areaTotalFazenda)} ha</strong>
              ) : (
                <span className="text-warning">
                  não informada — preencha em Fazendas pra validar o limite entre os tipos de uso.
                </span>
              )}
            </div>

            <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="space-y-4">
              <h2 className="text-sm font-semibold text-text-primary">
                {editandoId ? 'Editar mudança de uso' : 'Lançar mudança de uso'}
              </h2>

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
                {precisaCultura && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Cultura
                      <Required />
                    </label>
                    <input
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                      value={cultura}
                      onChange={(e) => setCultura(e.target.value)}
                      placeholder="Ex.: Soja, Milho"
                      required
                    />
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
                        areaDisponivelOrigem !== null && areaHa && parseFloat(areaHa) > areaDisponivelOrigem
                          ? 'text-error'
                          : 'text-text-secondary'
                      }`}
                    >
                      {carregandoAreaDisponivel
                        ? 'Consultando área disponível...'
                        : areaDisponivelOrigem !== null
                          ? `Área disponível: ${formatArea(areaDisponivelOrigem)} ha${
                              areaHa && parseFloat(areaHa) > areaDisponivelOrigem
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
                  <button
                    type="button"
                    className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                    onClick={cancelarEdicao}
                  >
                    Cancelar edição
                  </button>
                )}
              </div>
            </form>

            <h3 className="mt-8 mb-3 text-sm font-semibold text-text-primary">Últimas mudanças de uso</h3>
            {loading ? (
              <div className="animate-pulse h-16 rounded-control bg-border" />
            ) : movimentacoes.length === 0 ? (
              <p className="text-sm text-text-secondary">Nenhuma mudança de uso lançada ainda.</p>
            ) : (
              <div className="space-y-3">
                {movimentacoes.map((m) => (
                  <div key={m.id} className="rounded-card border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm text-text-primary">
                        {m.tipo_uso_origem?.nome ?? '—'} → {m.tipo_uso_destino?.nome ?? '—'}
                      </strong>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-secondary">{m.data}</span>
                        <button
                          type="button"
                          className="text-xs text-brand-500 underline"
                          onClick={() => iniciarEdicao(m)}
                        >
                          Editar
                        </button>
                      </div>
                    </div>
                    <div className="text-sm text-text-secondary">
                      {formatArea(m.area_ha)} ha{m.cultura ? ` · ${m.cultura}` : ''}
                    </div>
                    {m.observacao && <div className="text-sm text-text-muted italic">{m.observacao}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

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
