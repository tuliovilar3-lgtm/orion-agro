'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { corCategorica } from '@/lib/relatorio-cores'
import KpiCard from '@/components/relatorios/KpiCard'
import { agruparPorChave, formatarDataBr, mediaPonderada } from '@/components/relatorios/tipos'

// 1 UA (Unidade Animal) = 450 kg de peso vivo — convenção padrão da
// pecuária brasileira. Lotação = UA totais / hectares em uso "Pecuária".
const KG_POR_UA = 450

type Fazenda = { id: string; nome: string }

type ResumoLinha = {
  fazenda_id: string
  categoria_id: string
  categoria_nome: string
  grupo_nome: string
  quantidade: number
  peso_medio_kg: number | null
}

type MovimentacaoFeed = {
  id: string
  data: string
  tipo: string
  quantidade: number
  fazenda: { nome: string } | null
  fazenda_origem: { nome: string } | null
  fazenda_destino: { nome: string } | null
  categoria: { nome: string } | null
  categoria_destino: { nome: string } | null
}

const NOMES_GRUPO: Record<string, string> = { BEZERRO: 'Bezerro', JOVEM: 'Jovem', ADULTO: 'Adulto' }
const ORDEM_GRUPO = ['BEZERRO', 'JOVEM', 'ADULTO']

const TIPOS_FEED = [
  'NASCIMENTO',
  'DESMAME',
  'COMPRA',
  'VENDA_PE',
  'VENDA_ABATE',
  'MORTE',
  'CONSUMO_DOACAO',
  'TRANSFERENCIA',
] as const

const LABELS_TIPO: Record<string, string> = {
  NASCIMENTO: 'Nascimento',
  DESMAME: 'Desmame',
  COMPRA: 'Compra',
  VENDA_PE: 'Venda em Pé',
  VENDA_ABATE: 'Venda Abate',
  MORTE: 'Mortalidade',
  CONSUMO_DOACAO: 'Consumo/Doação',
  TRANSFERENCIA: 'Transferência',
}

const SELECT_MOVIMENTACAO_FEED = `
  id, data, tipo, quantidade,
  fazenda:fazendas!fazenda_id(nome),
  fazenda_origem:fazendas!fazenda_origem_id(nome),
  fazenda_destino:fazendas!fazenda_destino_id(nome),
  categoria:categorias_animal!categoria_id(nome),
  categoria_destino:categorias_animal!categoria_destino_id(nome)
`

function nomeFazendaLinha(m: MovimentacaoFeed) {
  if (m.fazenda?.nome) return m.fazenda.nome
  if (m.fazenda_origem?.nome && m.fazenda_destino?.nome) return `${m.fazenda_origem.nome} → ${m.fazenda_destino.nome}`
  return '—'
}

export default function PainelPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaIds, setFazendaIds] = useState<string[]>([])
  const [tipoPecuariaId, setTipoPecuariaId] = useState<string | null>(null)

  const [resumo, setResumo] = useState<ResumoLinha[]>([])
  const [loadingResumo, setLoadingResumo] = useState(true)
  const [areaPecuaria, setAreaPecuaria] = useState<number | null>(null)

  const [modoFiltro, setModoFiltro] = useState<'mes' | 'safra' | 'ano' | 'periodo'>('safra')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicio] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionado] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustom] = useState(() => new Date().toISOString().slice(0, 10))

  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoFeed[]>([])
  const [loadingMovimentacoes, setLoadingMovimentacoes] = useState(true)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)
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
      .from('tipos_uso_area')
      .select('id, nome')
      .eq('nome', 'Pecuária')
      .single()
      .then(({ data }) => setTipoPecuariaId(data?.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (fazendaIds.length === 0) {
      setResumo([])
      setLoadingResumo(false)
      return
    }
    let cancelado = false
    setLoadingResumo(true)
    supabase.rpc('fn_resumo_rebanho_atual', { p_fazenda_ids: fazendaIds }).then(({ data, error }) => {
      if (cancelado) return
      if (!error) setResumo(data || [])
      setLoadingResumo(false)
    })
    return () => {
      cancelado = true
    }
  }, [fazendaIds])

  useEffect(() => {
    if (!tipoPecuariaId || fazendaIds.length === 0) {
      setAreaPecuaria(fazendaIds.length === 0 ? 0 : null)
      return
    }
    let cancelado = false
    Promise.all(
      fazendaIds.map((fId) => supabase.rpc('fn_area_por_uso', { p_fazenda_id: fId, p_tipo_uso_id: tipoPecuariaId, p_data: hoje }))
    ).then((resultados) => {
      if (cancelado) return
      const soma = resultados.reduce((s, r) => s + (r.data ?? 0), 0)
      setAreaPecuaria(soma)
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoPecuariaId, fazendaIds])

  useEffect(() => {
    if (fazendaIds.length === 0 || periodoInvalido) {
      setMovimentacoes([])
      setLoadingMovimentacoes(false)
      return
    }
    let cancelado = false
    setLoadingMovimentacoes(true)
    supabase
      .from('movimentacoes_rebanho')
      .select(SELECT_MOVIMENTACAO_FEED)
      .in('tipo', TIPOS_FEED)
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .or(`fazenda_id.in.(${fazendaIds.join(',')}),fazenda_origem_id.in.(${fazendaIds.join(',')}),fazenda_destino_id.in.(${fazendaIds.join(',')})`)
      .order('data', { ascending: false })
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setMovimentacoes((data as unknown as MovimentacaoFeed[]) || [])
        setLoadingMovimentacoes(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaIds, dataInicio, dataFim, periodoInvalido])

  function alternarFazenda(id: string) {
    setFazendaIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  function alternarTodas() {
    setFazendaIds(todasSelecionadas ? [] : fazendas.map((f) => f.id))
  }

  const totalCabecas = resumo.reduce((s, r) => s + r.quantidade, 0)
  const pesoMedioGeral = mediaPonderada(resumo.map((r) => ({ valor: r.peso_medio_kg, peso: r.quantidade })))
  const pesoVivoTotal = resumo.reduce((s, r) => s + (r.peso_medio_kg != null ? r.peso_medio_kg * r.quantidade : 0), 0)
  const lotacaoAtual = areaPecuaria != null && areaPecuaria > 0 ? pesoVivoTotal / KG_POR_UA / areaPecuaria : null

  const porGrupo = ORDEM_GRUPO.map((grupo) => ({
    grupo: NOMES_GRUPO[grupo],
    quantidade: resumo.filter((r) => r.grupo_nome === grupo).reduce((s, r) => s + r.quantidade, 0),
  })).filter((g) => g.quantidade > 0)

  const porCategoria = [...agruparPorChave(resumo, (r) => r.categoria_nome).entries()]
    .map(([nome, rs]) => ({
      nome,
      quantidade: rs.reduce((s, r) => s + r.quantidade, 0),
      pesoMedio: mediaPonderada(rs.map((r) => ({ valor: r.peso_medio_kg, peso: r.quantidade }))),
    }))
    .sort((a, b) => b.quantidade - a.quantidade)

  const contagemPorTipo = TIPOS_FEED.map((tipo) => ({
    tipo,
    label: LABELS_TIPO[tipo],
    total: movimentacoes.filter((m) => m.tipo === tipo).length,
  })).filter((t) => t.total > 0)

  const rotuloPeriodo =
    modoFiltro === 'safra'
      ? `Safra ${safraAnoInicio}/${safraAnoInicio + 1}`
      : modoFiltro === 'ano'
        ? `Ano ${anoCalendarioSelecionado}`
        : modoFiltro === 'mes'
          ? new Date(`${mes}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
          : `${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)}`

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Painel</h1>
      <p className="mt-1 text-sm text-text-secondary">Visão geral do rebanho e das movimentações recentes.</p>

      <div className="mt-6 rounded-card border border-border bg-surface p-5">
        <div className="mb-1.5 flex items-center justify-between gap-4">
          <label className="text-sm font-medium text-text-secondary">
            Fazendas
            <Required />
          </label>
          <button type="button" className="text-xs font-medium text-brand-500 underline" onClick={alternarTodas}>
            {todasSelecionadas ? 'Desmarcar todas' : 'Marcar todas'}
          </button>
        </div>
        <div className="flex max-h-32 flex-wrap gap-x-6 gap-y-1 overflow-y-auto rounded-control border border-border p-2">
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

      {fazendaIds.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="font-semibold text-text-primary">Selecione ao menos uma fazenda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            O painel precisa de pelo menos uma fazenda marcada no filtro acima.
          </p>
        </div>
      ) : loadingResumo ? (
        <div className="mt-6 grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-card border border-border bg-surface p-5">
              <div className="h-3 w-20 rounded bg-border" />
              <div className="mt-3 h-6 w-16 rounded bg-border" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Total de cabeças" value={formatQuantidade(totalCabecas)} />
            <KpiCard label="Peso médio geral" value={`${formatPeso(pesoMedioGeral)} kg`} hint="média ponderada" />
            <KpiCard
              label="Lotação atual"
              value={lotacaoAtual != null ? `${formatLotacao(lotacaoAtual)} UA/ha` : '—'}
              hint="1 UA = 450 kg"
            />
            <KpiCard label="Área em Pecuária" value={areaPecuaria != null ? `${formatArea(areaPecuaria)} ha` : '—'} />
          </div>

          {resumo.length === 0 ? (
            <div className="mt-6 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="font-semibold text-text-primary">Nenhum animal no estoque atual</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
                Declare o saldo inicial das fazendas selecionadas em Fazendas.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-card border border-border bg-surface p-5">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Distribuição por grupo faixa etária</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={porGrupo} dataKey="quantidade" nameKey="grupo" outerRadius={80} label>
                      {porGrupo.map((_, i) => (
                        <Cell key={i} fill={corCategorica(i)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatQuantidade(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto rounded-card border border-border bg-surface p-5">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Cabeças por categoria</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-secondary">
                      <th className="py-1.5 font-medium">Categoria</th>
                      <th className="py-1.5 text-right font-medium">Qtde.</th>
                      <th className="py-1.5 text-right font-medium">Peso médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porCategoria.map((c) => (
                      <tr key={c.nome} className="border-b border-border last:border-0">
                        <td className="py-1.5 text-text-primary">{c.nome}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-primary">{formatQuantidade(c.quantidade)}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-secondary">
                          {c.pesoMedio != null ? `${formatPeso(c.pesoMedio)} kg` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-8 rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text-primary">Movimentações do período</h2>
          <Link href="/relatorios" className="text-sm font-medium text-brand-500 underline">
            Ver relatórios completos →
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {(['mes', 'safra', 'ano', 'periodo'] as const).map((modo) => (
            <button
              key={modo}
              type="button"
              onClick={() => setModoFiltro(modo)}
              className={`rounded-control border px-3 py-1.5 ${
                modoFiltro === modo ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
              }`}
            >
              {modo === 'mes' ? 'Mês' : modo === 'safra' ? 'Ano Safra' : modo === 'ano' ? 'Ano Calendário' : 'Período personalizado'}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {modoFiltro === 'mes' ? (
            <input
              type="month"
              max={hoje.slice(0, 7)}
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

        {periodoInvalido ? (
          <p className="mt-4 text-sm text-error">Corrija o período antes de continuar.</p>
        ) : loadingMovimentacoes ? (
          <div className="mt-4 h-32 animate-pulse rounded-control bg-border" />
        ) : movimentacoes.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">Nenhuma movimentação em {rotuloPeriodo.toLowerCase()}.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {contagemPorTipo.map((t) => (
                <span
                  key={t.tipo}
                  className="rounded-control border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text-secondary"
                >
                  <span className="font-semibold text-text-primary">{t.total}</span> {t.label.toLowerCase()}
                </span>
              ))}
            </div>

            <div className="mt-4 divide-y divide-border">
              {movimentacoes.slice(0, 15).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 text-xs font-medium text-text-secondary">{LABELS_TIPO[m.tipo]}</span>
                    <span className="text-text-primary">
                      {m.categoria?.nome ?? m.categoria_destino?.nome ?? '—'}
                      <span className="text-text-muted"> · {nomeFazendaLinha(m)}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular-nums text-text-secondary">{formatQuantidade(m.quantidade)}</span>
                    <span className="text-xs text-text-muted">{formatarDataBr(m.data)}</span>
                  </div>
                </div>
              ))}
            </div>
            {movimentacoes.length > 15 && (
              <p className="mt-3 text-xs text-text-muted">
                Mostrando 15 de {formatQuantidade(movimentacoes.length)} lançamentos em {rotuloPeriodo.toLowerCase()}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
