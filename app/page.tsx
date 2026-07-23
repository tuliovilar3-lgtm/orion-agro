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
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts'
import { corCategorica, CORES_BINARIAS } from '@/lib/relatorio-cores'
import KpiCard from '@/components/relatorios/KpiCard'
import { agruparPorChave, formatarDataBr, mediaPonderada } from '@/components/relatorios/tipos'
import FluxoRebanho, { LinhaFluxoRebanho, somarFluxoRebanho } from '@/components/FluxoRebanho'

// 1 UA (Unidade Animal) = 450 kg de peso vivo — convenção padrão da
// pecuária brasileira. Lotação = UA totais / hectares em uso "Pecuária".
const KG_POR_UA = 450

type Fazenda = { id: string; nome: string }

type ResumoLinha = {
  fazenda_id: string
  categoria_id: string
  categoria_nome: string
  grupo_nome: string
  sexo: 'MACHO' | 'FEMEA'
  quantidade: number
  peso_medio_kg: number | null
}

function formaSetor(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, isActive } = props
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={isActive ? outerRadius + 6 : outerRadius}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  )
}

export default function PainelPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaIds, setFazendaIds] = useState<string[]>([])
  const [tipoPecuariaId, setTipoPecuariaId] = useState<string | null>(null)

  const [resumo, setResumo] = useState<ResumoLinha[]>([])
  const [loadingResumo, setLoadingResumo] = useState(true)
  const [areaPecuaria, setAreaPecuaria] = useState<number | null>(null)

  const [hoverSexoIndex, setHoverSexoIndex] = useState<number | null>(null)
  const [hoverCategoriaIndex, setHoverCategoriaIndex] = useState<number | null>(null)

  const [modoFiltro, setModoFiltro] = useState<'mes' | 'safra' | 'ano' | 'periodo'>('safra')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicio] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionado] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustom] = useState(() => new Date().toISOString().slice(0, 10))

  const [fluxoLinhas, setFluxoLinhas] = useState<LinhaFluxoRebanho[]>([])
  const [loadingFluxo, setLoadingFluxo] = useState(true)

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
      setFluxoLinhas([])
      setLoadingFluxo(false)
      return
    }
    let cancelado = false
    setLoadingFluxo(true)
    supabase
      .rpc('fn_relatorio_movimentacao_rebanho', { p_fazenda_ids: fazendaIds, p_data_inicio: dataInicio, p_data_fim: dataFim })
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setFluxoLinhas(data || [])
        setLoadingFluxo(false)
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

  const porCategoria = [...agruparPorChave(resumo, (r) => r.categoria_nome).entries()]
    .map(([nome, rs]) => ({
      nome,
      sexo: rs[0].sexo,
      quantidade: rs.reduce((s, r) => s + r.quantidade, 0),
      pesoMedio: mediaPonderada(rs.map((r) => ({ valor: r.peso_medio_kg, peso: r.quantidade }))),
    }))
    .sort((a, b) => b.quantidade - a.quantidade)

  // agrupada por sexo (fêmeas contíguas, depois machos) pro anel externo
  // da rosca ficar visualmente alinhado com o anel interno de sexo
  const porCategoriaPorSexo = [...porCategoria].sort((a, b) =>
    a.sexo === b.sexo ? b.quantidade - a.quantidade : a.sexo === 'FEMEA' ? -1 : 1
  )

  const porSexo = (['MACHO', 'FEMEA'] as const)
    .map((sx) => {
      const rs = porCategoria.filter((c) => c.sexo === sx)
      return {
        sexo: sx,
        label: sx === 'MACHO' ? 'Machos' : 'Fêmeas',
        quantidade: rs.reduce((s, c) => s + c.quantidade, 0),
        pesoMedio: mediaPonderada(rs.map((c) => ({ valor: c.pesoMedio, peso: c.quantidade }))),
      }
    })
    .filter((s) => s.quantidade > 0)

  const infoCategoria = hoverCategoriaIndex != null ? porCategoriaPorSexo[hoverCategoriaIndex] : null
  const infoSexo = hoverSexoIndex != null ? porSexo[hoverSexoIndex] : null
  const infoCentral = infoCategoria
    ? { nome: infoCategoria.nome, quantidade: infoCategoria.quantidade, pesoMedio: infoCategoria.pesoMedio }
    : infoSexo
      ? { nome: infoSexo.label, quantidade: infoSexo.quantidade, pesoMedio: infoSexo.pesoMedio }
      : { nome: 'Total', quantidade: totalCabecas, pesoMedio: pesoMedioGeral }

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
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Distribuição do rebanho atual</h3>
                <div className="space-y-2.5">
                  {porCategoria.map((c) => {
                    const pct = totalCabecas ? (c.quantidade / totalCabecas) * 100 : 0
                    return (
                      <div key={c.nome}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-text-primary">{c.nome}</span>
                          <span className="tabular-nums text-text-secondary">
                            {formatQuantidade(c.quantidade)} cab. ·{' '}
                            {c.pesoMedio != null ? `${formatPeso(c.pesoMedio)} kg` : '—'} ·{' '}
                            {pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-brand-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                  <span className="text-sm font-bold text-text-primary">Total</span>
                  <span className="tabular-nums text-sm font-bold text-text-primary">
                    {formatQuantidade(totalCabecas)} cab. · {formatPeso(pesoMedioGeral)} kg
                  </span>
                </div>
              </div>

              <div className="rounded-card border border-border bg-surface p-5">
                <h3 className="mb-1 text-sm font-semibold text-text-primary">Distribuição sexo × categoria</h3>
                <p className="mb-2 text-xs text-text-muted">Anel interno: sexo · Anel externo: categoria</p>
                <div className="relative">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        id="anel-sexo"
                        data={porSexo}
                        dataKey="quantidade"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius={42}
                        outerRadius={62}
                        isAnimationActive={false}
                        shape={formaSetor}
                        onMouseEnter={(_: any, i: number) => setHoverSexoIndex(i)}
                        onMouseLeave={() => setHoverSexoIndex(null)}
                        onClick={(_: any, i: number) => setHoverSexoIndex(i)}
                      >
                        {porSexo.map((s) => (
                          <Cell
                            key={s.sexo}
                            fill={CORES_BINARIAS[s.sexo === 'MACHO' ? 0 : 1]}
                            style={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Pie>
                      <Pie
                        id="anel-categoria"
                        data={porCategoriaPorSexo}
                        dataKey="quantidade"
                        nameKey="nome"
                        cx="50%"
                        cy="50%"
                        innerRadius={68}
                        outerRadius={88}
                        isAnimationActive={false}
                        shape={formaSetor}
                        onMouseEnter={(_: any, i: number) => setHoverCategoriaIndex(i)}
                        onMouseLeave={() => setHoverCategoriaIndex(null)}
                        onClick={(_: any, i: number) => setHoverCategoriaIndex(i)}
                      >
                        {porCategoriaPorSexo.map((c, i) => (
                          <Cell
                            key={c.nome}
                            fill={corCategorica(i)}
                            stroke="#fff"
                            strokeWidth={1}
                            style={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-extrabold tabular-nums text-text-primary">
                      {formatQuantidade(infoCentral.quantidade)}
                    </span>
                    <span className="max-w-[90px] truncate text-[10px] font-medium text-text-secondary">
                      {infoCentral.nome}
                    </span>
                    <span className="text-[10px] tabular-nums text-text-muted">
                      {infoCentral.pesoMedio != null ? `${formatPeso(infoCentral.pesoMedio)} kg` : '—'}
                    </span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {porCategoriaPorSexo.map((c, i) => {
                    const pct = totalCabecas ? (c.quantidade / totalCabecas) * 100 : 0
                    return (
                      <div
                        key={c.nome}
                        onMouseEnter={() => setHoverCategoriaIndex(i)}
                        onMouseLeave={() => setHoverCategoriaIndex(null)}
                        onClick={() => setHoverCategoriaIndex(i)}
                        className="flex cursor-pointer items-center gap-1.5"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{ background: corCategorica(i) }}
                        />
                        <span className="truncate text-text-secondary">
                          {c.nome} <b className="text-text-primary">{pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b>
                        </span>
                      </div>
                    )
                  })}
                </div>
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
        ) : loadingFluxo ? (
          <div className="mt-4 h-24 animate-pulse rounded-control bg-border" />
        ) : (
          <div className="mt-4 rounded-card border border-border bg-bg p-4">
            <FluxoRebanho
              {...somarFluxoRebanho(fluxoLinhas)}
              labelInicial={`Estoque Inicial (${formatarDataBr(dataInicio)})`}
              labelFinal={`Estoque Final (${formatarDataBr(dataFim)})`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
