'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatArea, formatLotacao, formatPeso, formatQuantidade } from '@/lib/format'
import {
  ultimoDiaDoMes,
  periodoSafra,
  periodoAno,
  anoInicioSafraAtual,
  anoCalendarioAtual,
  opcoesSafra,
  opcoesAno,
} from '@/lib/periodo'
import { nomeMes } from '@/components/relatorios/tipos'
import KpiCard from '@/components/relatorios/KpiCard'
import { corCategorica } from '@/lib/relatorio-cores'
import {
  Bar,
  ComposedChart,
  Line,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// 1 UA (Unidade Animal) = 450 kg de peso vivo — mesma convenção do Painel
const KG_POR_UA = 450

type Fazenda = { id: string; nome: string }

type LinhaMensal = {
  mes: number
  ano: number
  rebanho_medio: number
  peso_medio: number | null
  area_media: number
  dias_no_mes: number
}

type LinhaPastoRaw = {
  pasto_id: string
  pasto_nome: string
  categoria_id: string
  categoria_nome: string
  quantidade: number
  peso_medio_kg: number | null
}

type PastoInfo = { area_ha: number | null; fazenda_id: string }

type PastoLotacao = {
  pasto_id: string
  pasto_nome: string
  fazenda_nome: string
  quantidade: number
  pesoVivoTotal: number
  area_ha: number | null
  lotacao: number | null
}

const SERIES = [
  { key: 'rebanho_medio', label: 'Rebanho Médio (cab.)', tipo: 'bar' as const, cor: corCategorica(0), casas: 0 },
  { key: 'lotacao', label: 'Lotação (UA/ha)', tipo: 'linha' as const, cor: corCategorica(1), casas: 2 },
  { key: 'peso_medio', label: 'Peso Médio (kg)', tipo: 'linha' as const, cor: corCategorica(2), casas: 1 },
  { key: 'area_media', label: 'Área (ha)', tipo: 'linha' as const, cor: corCategorica(7), casas: 0 },
] as const

type SerieKey = (typeof SERIES)[number]['key']

function dominioBar(valores: number[]) {
  const max = Math.max(...valores, 1)
  return [0, Math.ceil(max * 1.15)]
}

function dominioLinha(valores: (number | null)[]) {
  const validos = valores.filter((v): v is number => v != null)
  if (validos.length === 0) return [0, 1]
  const min = Math.min(...validos)
  const max = Math.max(...validos)
  const span = max - min || Math.max(Math.abs(max), 1)
  return [min - span * 0.15, max + span * 0.15]
}

function formatarValor(valor: number | null, casas: number) {
  if (valor == null) return '—'
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export default function RelatorioLotacaoPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaIds, setFazendaIds] = useState<string[]>([])
  const [controlaPasto, setControlaPasto] = useState(false)

  const [modoFiltro, setModoFiltro] = useState<'mes' | 'safra' | 'ano' | 'periodo'>('safra')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicio] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionado] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustom] = useState(() => new Date().toISOString().slice(0, 10))

  const [linhasMensais, setLinhasMensais] = useState<LinhaMensal[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [pastosLotacao, setPastosLotacao] = useState<PastoLotacao[]>([])
  const [loadingPastos, setLoadingPastos] = useState(false)

  const [visiveis, setVisiveis] = useState<Set<SerieKey>>(new Set(SERIES.map((s) => s.key)))
  const [destaque, setDestaque] = useState<SerieKey | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)
  const mesAtual = hoje.slice(0, 7)
  const todasSelecionadas = fazendas.length > 0 && fazendaIds.length === fazendas.length

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
  const dataFimBruta =
    modoFiltro === 'mes'
      ? `${mes}-${String(ultimoDiaDoMes(mes)).padStart(2, '0')}`
      : modoFiltro === 'safra'
        ? safra.dataFim
        : modoFiltro === 'ano'
          ? anoCalendario.dataFim
          : dataFimCustom
  // rebanho não tem "previsão" como área — não é possível lançar
  // movimentação futura, então o período nunca passa de hoje
  const dataFim = dataFimBruta > hoje ? hoje : dataFimBruta
  const periodoInvalido = modoFiltro === 'periodo' && dataInicioCustom > dataFimCustom

  useEffect(() => {
    supabase
      .from('fazendas')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => {
        setFazendas(data || [])
        setFazendaIds((data || []).map((f) => f.id))
      })
    supabase
      .from('configuracoes')
      .select('controla_pasto')
      .single()
      .then(({ data }) => setControlaPasto(data?.controla_pasto ?? false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (fazendaIds.length === 0 || periodoInvalido) {
      setLinhasMensais([])
      return
    }
    let cancelado = false
    setLoading(true)
    setErro(null)
    supabase
      .rpc('fn_relatorio_lotacao_mensal', { p_fazenda_ids: fazendaIds, p_data_inicio: dataInicio, p_data_fim: dataFim })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setErro(error.message)
        } else {
          setLinhasMensais(data || [])
        }
        setLoading(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaIds, dataInicio, dataFim, periodoInvalido])

  useEffect(() => {
    if (!controlaPasto || fazendaIds.length === 0) {
      setPastosLotacao([])
      return
    }
    let cancelado = false
    setLoadingPastos(true)

    Promise.all([
      supabase
        .from('pastos')
        .select('id, nome, area_ha, ativo, modulo:modulos!modulo_id(fazenda_id)')
        .eq('ativo', true),
      Promise.all(
        fazendaIds.map((fId) =>
          supabase.rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fId, p_data: hoje }).then((r) => ({
            fazendaId: fId,
            rows: (r.data as LinhaPastoRaw[]) || [],
          }))
        )
      ),
    ]).then(([pastosResp, resultadosPorFazenda]) => {
      if (cancelado) return

      const infoPasto = new Map<string, PastoInfo>()
      for (const p of (pastosResp.data as any[]) || []) {
        infoPasto.set(p.id, { area_ha: p.area_ha, fazenda_id: p.modulo?.fazenda_id })
      }
      const nomeFazenda = new Map(fazendas.map((f) => [f.id, f.nome]))

      const acumulado = new Map<string, PastoLotacao>()
      for (const { fazendaId, rows } of resultadosPorFazenda) {
        for (const r of rows) {
          const info = infoPasto.get(r.pasto_id)
          const existente = acumulado.get(r.pasto_id) ?? {
            pasto_id: r.pasto_id,
            pasto_nome: r.pasto_nome,
            fazenda_nome: nomeFazenda.get(fazendaId) ?? '',
            quantidade: 0,
            pesoVivoTotal: 0,
            area_ha: info?.area_ha ?? null,
            lotacao: null,
          }
          existente.quantidade += r.quantidade
          existente.pesoVivoTotal += r.quantidade * (r.peso_medio_kg ?? 0)
          acumulado.set(r.pasto_id, existente)
        }
      }

      const linhas = [...acumulado.values()].map((p) => ({
        ...p,
        lotacao: p.area_ha && p.area_ha > 0 ? p.pesoVivoTotal / KG_POR_UA / p.area_ha : null,
      }))
      linhas.sort((a, b) => (b.lotacao ?? -1) - (a.lotacao ?? -1))

      setPastosLotacao(linhas)
      setLoadingPastos(false)
    })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlaPasto, fazendaIds])

  function alternarFazenda(id: string) {
    setFazendaIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  function alternarTodas() {
    setFazendaIds(todasSelecionadas ? [] : fazendas.map((f) => f.id))
  }

  function alternarSerie(key: SerieKey) {
    setVisiveis((prev) => {
      const novo = new Set(prev)
      novo.has(key) ? novo.delete(key) : novo.add(key)
      return novo
    })
  }

  const dadosGrafico = linhasMensais.map((l) => {
    const lotacao =
      l.peso_medio != null && l.area_media > 0 ? (l.rebanho_medio * l.peso_medio) / KG_POR_UA / l.area_media : null
    return {
      mesLabel: nomeMes(`${l.ano}-${String(l.mes).padStart(2, '0')}`),
      rebanho_medio: l.rebanho_medio,
      peso_medio: l.peso_medio,
      area_media: l.area_media,
      lotacao,
    }
  })

  // resumo do período inteiro, derivado das linhas mensais ponderando
  // pelos dias de cada mês — matematicamente idêntico a integrar direto
  // sobre todos os dias do período, sem precisar reconsultar (mesmo
  // princípio já usado pra área em fn_relatorio_distribuicao_area)
  const somaDias = linhasMensais.reduce((s, l) => s + l.dias_no_mes, 0)
  const somaCabecaDias = linhasMensais.reduce((s, l) => s + l.rebanho_medio * l.dias_no_mes, 0)
  const somaPesoVivoDias = linhasMensais.reduce(
    (s, l) => s + (l.peso_medio != null ? l.peso_medio * l.rebanho_medio * l.dias_no_mes : 0),
    0
  )
  const somaAreaDias = linhasMensais.reduce((s, l) => s + l.area_media * l.dias_no_mes, 0)

  const rebanhoMedioPeriodo = somaDias > 0 ? somaCabecaDias / somaDias : 0
  const pesoMedioPeriodo = somaCabecaDias > 0 ? somaPesoVivoDias / somaCabecaDias : null
  const areaMediaPeriodo = somaDias > 0 ? somaAreaDias / somaDias : 0
  const lotacaoPeriodo =
    pesoMedioPeriodo != null && areaMediaPeriodo > 0
      ? (rebanhoMedioPeriodo * pesoMedioPeriodo) / KG_POR_UA / areaMediaPeriodo
      : null

  const maxLotacaoPasto = Math.max(...pastosLotacao.map((p) => p.lotacao ?? 0), 0.0001)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Relatório de Lotação</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Evolução mensal do rebanho, peso, área e lotação — considerando a área em Pecuária.
      </p>

      <div className="mt-6 flex flex-wrap gap-5 rounded-card border border-border bg-surface p-5">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <label className="text-sm font-medium text-text-secondary">
              Fazendas
              <Required />
            </label>
            <button type="button" className="text-xs font-medium text-brand-500 underline" onClick={alternarTodas}>
              {todasSelecionadas ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
          </div>
          <div className="max-h-32 w-56 space-y-1 overflow-y-auto rounded-control border border-border p-2">
            {fazendas.length === 0 ? (
              <p className="text-xs text-text-muted">Nenhuma fazenda cadastrada.</p>
            ) : (
              fazendas.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm text-text-primary">
                  <input type="checkbox" checked={fazendaIds.includes(f.id)} onChange={() => alternarFazenda(f.id)} />
                  {f.nome}
                </label>
              ))
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Período</label>
          <div className="mb-1.5 flex flex-wrap gap-3 text-sm text-text-primary">
            <label className="flex items-center gap-1">
              <input type="radio" name="modoFiltro" checked={modoFiltro === 'mes'} onChange={() => setModoFiltro('mes')} />
              Mês
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="modoFiltro"
                checked={modoFiltro === 'safra'}
                onChange={() => setModoFiltro('safra')}
              />
              Ano Safra
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="modoFiltro" checked={modoFiltro === 'ano'} onChange={() => setModoFiltro('ano')} />
              Ano Calendário
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="modoFiltro"
                checked={modoFiltro === 'periodo'}
                onChange={() => setModoFiltro('periodo')}
              />
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
      </div>

      <div className="mt-6">
        {fazendaIds.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="font-semibold text-text-primary">Selecione ao menos uma fazenda</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              O relatório precisa de pelo menos uma fazenda marcada no filtro acima.
            </p>
          </div>
        ) : periodoInvalido ? (
          <p className="text-sm text-error">Corrija o período antes de continuar.</p>
        ) : loading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-card border border-border bg-surface p-5">
                  <div className="h-3 w-20 rounded bg-border" />
                  <div className="mt-3 h-6 w-16 rounded bg-border" />
                </div>
              ))}
            </div>
            <div className="h-80 rounded-card border border-border bg-surface" />
          </div>
        ) : erro ? (
          <p className="text-sm text-error">Erro: {erro}</p>
        ) : linhasMensais.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="font-semibold text-text-primary">Sem dados no período</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              Confira o saldo inicial e a área em Pecuária das fazendas selecionadas.
            </p>
          </div>
        ) : (
          <>
            {/* resumo do período */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label="Rebanho Médio" value={`${formatQuantidade(rebanhoMedioPeriodo)} cab.`} />
              <KpiCard label="Peso Médio" value={`${formatPeso(pesoMedioPeriodo)} kg`} />
              <KpiCard label="Área Média" value={`${formatArea(areaMediaPeriodo)} ha`} />
              <KpiCard label="Lotação" value={`${formatLotacao(lotacaoPeriodo)} UA/ha`} />
            </div>

            {/* gráfico combinado */}
            <div className="mt-4 rounded-card border border-border bg-surface p-5">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">
                Rebanho Médio × Lotação × Peso Médio × Área
              </h3>

              <div className="mb-3 flex flex-wrap gap-4 text-xs">
                {SERIES.map((s) => {
                  const ativa = visiveis.has(s.key)
                  const destacada = destaque === s.key
                  return (
                    <div
                      key={s.key}
                      className="flex cursor-pointer select-none items-center gap-1.5"
                      style={{ opacity: ativa ? 1 : 0.35, fontWeight: destacada ? 700 : 500 }}
                      onClick={() => alternarSerie(s.key)}
                      onMouseEnter={() => setDestaque(s.key)}
                      onMouseLeave={() => setDestaque(null)}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0"
                        style={{ background: s.cor, borderRadius: s.tipo === 'bar' ? 3 : 999 }}
                      />
                      <span className="text-text-primary">{s.label}</span>
                    </div>
                  )
                })}
              </div>

              <div onMouseLeave={() => setDestaque(null)}>
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={dadosGrafico} margin={{ top: 26, right: 12, left: 8, bottom: 4 }}>
                    <XAxis dataKey="mesLabel" tick={{ fontSize: 11, fill: '#8A9793' }} axisLine={{ stroke: '#DDE4E1' }} tickLine={false} />
                    <YAxis yAxisId="rebanho_medio" hide domain={dominioBar(dadosGrafico.map((d) => d.rebanho_medio))} />
                    <YAxis yAxisId="lotacao" hide domain={dominioLinha(dadosGrafico.map((d) => d.lotacao))} />
                    <YAxis yAxisId="peso_medio" hide domain={dominioLinha(dadosGrafico.map((d) => d.peso_medio))} />
                    <YAxis yAxisId="area_media" hide domain={dominioLinha(dadosGrafico.map((d) => d.area_media))} />
                    <Tooltip content={<TooltipMensal series={SERIES} visiveis={visiveis} />} />

                    {visiveis.has('rebanho_medio') && (
                      <Bar
                        yAxisId="rebanho_medio"
                        dataKey="rebanho_medio"
                        fill={SERIES[0].cor}
                        fillOpacity={destaque && destaque !== 'rebanho_medio' ? 0.15 : 1}
                        radius={[3, 3, 0, 0]}
                        isAnimationActive={false}
                        onMouseEnter={() => setDestaque('rebanho_medio')}
                        onClick={() => setDestaque('rebanho_medio')}
                      >
                        <LabelList
                          dataKey="rebanho_medio"
                          position="top"
                          formatter={(v: any) => formatarValor(v, 0)}
                          fill={SERIES[0].cor}
                          fontSize={9.5}
                          fontWeight={700}
                        />
                      </Bar>
                    )}

                    {SERIES.filter((s) => s.tipo === 'linha' && visiveis.has(s.key)).map((s) => (
                      <Line
                        key={s.key}
                        yAxisId={s.key}
                        dataKey={s.key}
                        stroke={s.cor}
                        strokeWidth={destaque === s.key ? 3.5 : 2.5}
                        strokeOpacity={destaque && destaque !== s.key ? 0.15 : 1}
                        dot={{ r: destaque === s.key ? 5 : 4, fill: '#fff', stroke: s.cor, strokeWidth: 2 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                        connectNulls
                        onMouseEnter={() => setDestaque(s.key)}
                        onClick={() => setDestaque(s.key)}
                      >
                        <LabelList
                          dataKey={s.key}
                          position="top"
                          formatter={(v: any) => formatarValor(v, s.casas)}
                          fill={s.cor}
                          fontSize={9.5}
                          fontWeight={700}
                        />
                      </Line>
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {controlaPasto && (
              <div className="mt-4 rounded-card border border-border bg-surface p-5">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Lotação atual por pasto</h3>
                {loadingPastos ? (
                  <div className="animate-pulse space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-8 rounded-control bg-border" />
                    ))}
                  </div>
                ) : pastosLotacao.length === 0 ? (
                  <p className="text-sm text-text-secondary">Nenhum pasto com rebanho registrado hoje.</p>
                ) : (
                  <div className="space-y-2.5">
                    {pastosLotacao.map((p) => {
                      const pct = ((p.lotacao ?? 0) / maxLotacaoPasto) * 100
                      const pesoMedio = p.quantidade > 0 ? p.pesoVivoTotal / p.quantidade : null
                      return (
                        <div key={p.pasto_id}>
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="text-text-primary">
                              {p.pasto_nome}
                              {fazendaIds.length > 1 ? ` (${p.fazenda_nome})` : ''}
                            </span>
                            <span className="tabular-nums text-text-secondary">
                              {formatQuantidade(p.quantidade)} cab. · {formatPeso(pesoMedio)} kg ·{' '}
                              {p.area_ha != null ? `${formatArea(p.area_ha)} ha · ` : ''}
                              <b className="text-text-primary">{formatLotacao(p.lotacao)} UA/ha</b>
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-brand-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TooltipMensal({
  active,
  payload,
  label,
  series,
  visiveis,
}: {
  active?: boolean
  payload?: { dataKey: string; value: number | null }[]
  label?: string
  series: typeof SERIES
  visiveis: Set<SerieKey>
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-text-primary px-3 py-2 text-xs text-white shadow-lg">
      <div className="mb-1 font-bold">{label}</div>
      {series
        .filter((s) => visiveis.has(s.key))
        .map((s) => {
          const item = payload.find((p) => p.dataKey === s.key)
          return (
            <div key={s.key}>
              <span style={{ color: s.cor }}>●</span> {s.label}:{' '}
              <b>{formatarValor(item?.value ?? null, s.casas)}</b>
            </div>
          )
        })}
    </div>
  )
}
