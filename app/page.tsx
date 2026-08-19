'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { Geometry } from 'geojson'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatArea, formatLotacao, formatPeso, formatQuantidade } from '@/lib/format'
import { opcoesSafra, opcoesAno, anoInicioSafraAtual, anoCalendarioAtual } from '@/lib/periodo'
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts'
import { corCategorica, CORES_BINARIAS } from '@/lib/relatorio-cores'
import KpiCard from '@/components/relatorios/KpiCard'
import { agruparPorChave, formatarDataBr, mediaPonderada } from '@/components/relatorios/tipos'
import FluxoRebanho, { LinhaFluxoRebanho, somarFluxoRebanho } from '@/components/FluxoRebanho'
import { useFiltroGlobal } from '@/contexts/FiltroGlobalContext'
import { useAuth } from '@/contexts/AuthContext'
import InicioCampo from '@/components/campo/InicioCampo'
import SuporteHome from '@/components/suporte/SuporteHome'
import type { PastoDistribuicao } from '@/components/fazendas/MapaDistribuicaoRebanho'
import { ICONE_SRC } from '@/lib/categoria-icones'
import {
  montarDistribuicaoPorPasto,
  corPorModuloId,
  type CategoriaAnimalInfo,
  type LinhaPastoRaw,
  type PastoBaseInfo,
} from '@/lib/distribuicao-pasto'

// leaflet acessa `window` na importação — precisa ficar fora do SSR
const MapaDistribuicaoRebanho = dynamic(() => import('@/components/fazendas/MapaDistribuicaoRebanho'), {
  ssr: false,
})

// 1 UA (Unidade Animal) = 450 kg de peso vivo — convenção padrão da
// pecuária brasileira. Lotação = UA totais / hectares em uso "Pecuária".
const KG_POR_UA = 450

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
  // suporte "em casa" (não entrou em nenhuma conta ainda) vê a home de
  // Suporte, nunca o dashboard — checado ANTES do Modo Campo e de
  // qualquer hook do dashboard pra não disparar buscas de dado de conta
  // nenhuma à toa. Modo Campo mostra uma home simplificada (botões
  // grandes por módulo liberado) em vez do dashboard completo.
  const { usuarioApp, emModoSuporte, loading: loadingAuth } = useAuth()
  if (!loadingAuth && usuarioApp?.suporte && !emModoSuporte) return <SuporteHome />
  if (!loadingAuth && usuarioApp?.modo === 'CAMPO') return <InicioCampo />

  return <PainelDashboard />
}

function PainelDashboard() {
  const {
    fazendas,
    fazendaIds,
    alternarFazenda,
    alternarTodas,
    todasSelecionadas,
    proprietarios,
    proprietarioIds,
    alternarProprietario,
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

  const [tipoPecuariaId, setTipoPecuariaId] = useState<string | null>(null)

  const [resumo, setResumo] = useState<ResumoLinha[]>([])
  const [loadingResumo, setLoadingResumo] = useState(true)
  const [areaPecuaria, setAreaPecuaria] = useState<number | null>(null)

  const [hoverSexoIndex, setHoverSexoIndex] = useState<number | null>(null)
  const [hoverCategoriaIndex, setHoverCategoriaIndex] = useState<number | null>(null)

  const [fluxoLinhas, setFluxoLinhas] = useState<LinhaFluxoRebanho[]>([])
  const [loadingFluxo, setLoadingFluxo] = useState(true)

  const [controlaPasto, setControlaPasto] = useState(false)
  const [pastosDistribuicao, setPastosDistribuicao] = useState<PastoDistribuicao[]>([])
  const [fazendasGeometriaMapa, setFazendasGeometriaMapa] = useState<Geometry[]>([])
  const [loadingMapa, setLoadingMapa] = useState(false)
  const [pastoSelecionadoMapaId, setPastoSelecionadoMapaId] = useState<string | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  useEffect(() => {
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
      .rpc('fn_relatorio_movimentacao_rebanho', {
        p_fazenda_ids: fazendaIds,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        // vazio OU todos marcados = sem filtro (nunca esconder lançamentos
        // sem proprietário atribuído, a maioria); só filtra de verdade
        // quando é uma seleção parcial deliberada
        p_proprietario_ids:
          proprietarioIds.length > 0 && proprietarioIds.length < proprietarios.length ? proprietarioIds : null,
      })
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setFluxoLinhas(data || [])
        setLoadingFluxo(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaIds, dataInicio, dataFim, periodoInvalido, proprietarioIds])

  useEffect(() => {
    supabase
      .from('configuracoes')
      .select('controla_pasto')
      .single()
      .then(({ data }) => setControlaPasto(data?.controla_pasto ?? false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!controlaPasto || fazendaIds.length === 0) {
      setPastosDistribuicao([])
      setFazendasGeometriaMapa([])
      return
    }
    let cancelado = false
    setLoadingMapa(true)
    setPastoSelecionadoMapaId(null)

    Promise.all([
      supabase
        .from('pastos')
        .select('id, nome, area_ha, cor, geometria, ativo, modulo_id, modulo:modulos!modulo_id(fazenda_id)')
        .eq('ativo', true),
      supabase.from('modulos').select('id, fazenda_id, ordem'),
      supabase.from('fazendas').select('id, nome, geometria').in('id', fazendaIds),
      supabase.from('categorias_animal').select('id, sexo, era, papel:grupos_categoria_papel(nome)'),
      Promise.all(
        fazendaIds.map((fId) =>
          supabase
            .rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fId, p_data: hoje })
            .then((r) => (r.data as LinhaPastoRaw[]) || [])
        )
      ),
    ]).then(([pastosResp, modulosResp, fazendasResp, categoriasResp, resultadosPorFazenda]) => {
      if (cancelado) return

      const nomeFazendaPorId = new Map((fazendasResp.data || []).map((f: any) => [f.id, f.nome as string]))
      // mesma regra de cor automática de GestaoAreasPanel — pasto sem cor
      // própria usa a cor categórica do módulo, não uma cor fixa pra todos
      const corPorModulo = corPorModuloId(
        ((modulosResp.data as any[]) || []).map((m) => ({ id: m.id, fazendaId: m.fazenda_id, ordem: m.ordem }))
      )
      const pastosBase = new Map<string, PastoBaseInfo>()
      for (const p of (pastosResp.data as any[]) || []) {
        // só pastos das fazendas selecionadas no filtro — a query não
        // filtra isso no servidor (embutido em join não é trivial via
        // supabase-js), então filtra aqui antes de semear o mapa
        if (!fazendaIds.includes(p.modulo?.fazenda_id)) continue
        pastosBase.set(p.id, {
          nome: p.nome,
          areaHa: p.area_ha,
          cor: p.cor || corPorModulo.get(p.modulo_id) || '#1C8C7C',
          geometria: p.geometria ?? null,
          fazendaNome: nomeFazendaPorId.get(p.modulo?.fazenda_id) ?? '',
        })
      }

      const categoriasInfo = new Map<string, CategoriaAnimalInfo>()
      for (const c of (categoriasResp.data as any[]) || []) {
        categoriasInfo.set(c.id, { papel: c.papel?.nome ?? '', sexo: c.sexo, era: c.era })
      }

      const linhas = resultadosPorFazenda.flat()
      setPastosDistribuicao(montarDistribuicaoPorPasto(linhas, pastosBase, categoriasInfo))
      setFazendasGeometriaMapa(
        (fazendasResp.data || []).map((f: any) => f.geometria).filter((g: Geometry | null): g is Geometry => !!g)
      )
      setLoadingMapa(false)
    })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlaPasto, fazendaIds])

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
                <div className="space-y-1">
                  {porCategoria.map((c) => {
                    const pct = totalCabecas ? (c.quantidade / totalCabecas) * 100 : 0
                    const idxNaRosca = porCategoriaPorSexo.findIndex((pc) => pc.nome === c.nome)
                    const destacada = hoverCategoriaIndex != null && hoverCategoriaIndex === idxNaRosca
                    return (
                      <div
                        key={c.nome}
                        onMouseEnter={() => setHoverCategoriaIndex(idxNaRosca)}
                        onMouseLeave={() => setHoverCategoriaIndex(null)}
                        className={`cursor-pointer rounded-control px-1.5 py-1 transition-colors ${destacada ? 'bg-brand-100' : ''}`}
                      >
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-text-primary">{c.nome}</span>
                          <span className="tabular-nums text-text-secondary">
                            {formatQuantidade(c.quantidade)} cab. ·{' '}
                            {c.pesoMedio != null ? `${formatPeso(c.pesoMedio)} kg` : '—'}
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
                    const destacada = hoverCategoriaIndex === i
                    return (
                      <div
                        key={c.nome}
                        onMouseEnter={() => setHoverCategoriaIndex(i)}
                        onMouseLeave={() => setHoverCategoriaIndex(null)}
                        onClick={() => setHoverCategoriaIndex(i)}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-control px-1 py-0.5 transition-colors ${destacada ? 'bg-brand-100' : ''}`}
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

      {controlaPasto && fazendaIds.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">Mapa do rebanho por pasto</h2>
          <p className="mb-3 text-xs text-text-secondary">
            Distribuição de hoje — clique num pasto ou num ícone pra ver o detalhe.
          </p>
          {loadingMapa ? (
            <div className="h-[480px] animate-pulse rounded-control bg-border" />
          ) : pastosDistribuicao.filter((p) => p.geometria).length === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface px-6 py-10 text-center">
              <p className="font-semibold text-text-primary">Nenhum pasto com contorno desenhado ainda</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
                Desenhe ou importe o contorno dos pastos em Fazendas → Gestão de Áreas pra ver o mapa aqui.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
              <MapaDistribuicaoRebanho
                fazendasGeometria={fazendasGeometriaMapa}
                pastos={pastosDistribuicao}
                pastoSelecionadoId={pastoSelecionadoMapaId}
                onSelecionarPasto={setPastoSelecionadoMapaId}
              />
              <DetalhePastoDistribuicao
                pasto={
                  pastosDistribuicao.find((p) => p.id === pastoSelecionadoMapaId) ??
                  pastosDistribuicao.find((p) => p.geometria) ??
                  null
                }
              />
            </div>
          )}
        </div>
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

        {proprietarios.length > 1 && (
          <div className="mt-3">
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Proprietário</label>
            <div className="flex max-h-24 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-control border border-border p-2">
              {proprietarios.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-sm text-text-primary">
                  <input type="checkbox" checked={proprietarioIds.includes(p.id)} onChange={() => alternarProprietario(p.id)} />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>
        )}

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

function DetalhePastoDistribuicao({ pasto }: { pasto: PastoDistribuicao | null }) {
  if (!pasto) {
    return (
      <div className="flex h-full items-center justify-center rounded-control border border-dashed border-border bg-surface p-4 text-center text-sm text-text-secondary">
        Selecione um pasto no mapa
      </div>
    )
  }

  const totalQuantidade = pasto.categorias.reduce((s, c) => s + c.quantidade, 0)
  const pesoVivoTotal = pasto.categorias.reduce((s, c) => s + (c.pesoMedio ?? 0) * c.quantidade, 0)
  const lotacao =
    pasto.areaHa && pasto.areaHa > 0 && totalQuantidade > 0 ? pesoVivoTotal / KG_POR_UA / pasto.areaHa : null
  const categoriasOrdenadas = [...pasto.categorias].sort((a, b) => b.quantidade - a.quantidade)

  return (
    <div className="rounded-control border border-border bg-surface p-4 text-sm">
      <p className="font-semibold text-text-primary">{pasto.nome}</p>
      <p className="text-xs text-text-secondary">{pasto.fazendaNome}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 border-y border-border py-3 text-center">
        <div>
          <div className="text-[11px] text-text-secondary">Área útil</div>
          <div className="font-bold tabular-nums text-text-primary">
            {pasto.areaHa != null ? formatArea(pasto.areaHa) : '—'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-text-secondary">Rebanho</div>
          <div className="font-bold tabular-nums text-text-primary">{formatQuantidade(totalQuantidade)}</div>
        </div>
        <div>
          <div className="text-[11px] text-text-secondary">Lotação</div>
          <div className="font-bold tabular-nums text-text-primary">
            {lotacao != null ? formatLotacao(lotacao) : '—'}
          </div>
        </div>
      </div>

      {categoriasOrdenadas.length === 0 ? (
        <p className="mt-2 text-center text-xs text-text-muted">Sem rebanho nesse pasto</p>
      ) : (
        <div className="mt-2 space-y-2">
          {categoriasOrdenadas.map((c) => (
            <div key={c.codigo + c.nome} className="flex items-center gap-2.5">
              <img src={ICONE_SRC[c.codigo]} alt="" className="h-7 w-7 shrink-0 object-contain" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-text-primary">{c.nome}</div>
                <div className="text-xs text-text-muted">peso médio {c.pesoMedio != null ? `${formatPeso(c.pesoMedio)} kg` : '—'}</div>
              </div>
              <div className="shrink-0 font-semibold tabular-nums text-text-primary">
                {formatQuantidade(c.quantidade)} cab.
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
