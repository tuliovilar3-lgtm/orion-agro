'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Geometry } from 'geojson'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade, formatPeso as formatPesoValor, formatArea, formatLotacao } from '@/lib/format'
import ModuloGate from '@/components/ModuloGate'
import type { PastoDistribuicao } from '@/components/fazendas/MapaDistribuicaoRebanho'
import {
  montarDistribuicaoPorPasto,
  type CategoriaAnimalInfo,
  type LinhaPastoRaw,
  type PastoBaseInfo,
} from '@/lib/distribuicao-pasto'

// leaflet acessa `window` na importação — precisa ficar fora do SSR
const MapaDistribuicaoRebanho = dynamic(() => import('@/components/fazendas/MapaDistribuicaoRebanho'), {
  ssr: false,
})

// 1 UA (Unidade Animal) = 450 kg de peso vivo — mesma convenção usada no
// Painel e no Relatório de Lotação
const KG_POR_UA = 450

type Fazenda = { id: string; nome: string }

type LinhaRelatorio = {
  pasto_id: string
  pasto_nome: string
  pasto_ordem: number
  categoria_id: string
  categoria_nome: string
  quantidade: number
  peso_medio_kg: number | null
}

type PastoAgrupado = {
  pasto_id: string
  pasto_nome: string
  linhas: LinhaRelatorio[]
  totalQuantidade: number
  pesoMedio: number | null
  areaHa: number | null
  lotacao: number | null
}

function formatPeso(kg: number | null) {
  return kg != null ? `${formatPesoValor(kg)} kg` : '—'
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 rounded-control bg-border" />
      ))}
    </div>
  )
}

export default function RelatorioRebanhoPorPastoPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaId, setFazendaId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhas, setLinhas] = useState<LinhaRelatorio[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [pastosBase, setPastosBase] = useState<Map<string, PastoBaseInfo>>(new Map())
  const [categoriasInfo, setCategoriasInfo] = useState<Map<string, CategoriaAnimalInfo>>(new Map())
  const [fazendaGeometria, setFazendaGeometria] = useState<Geometry | null>(null)
  const [pastoSelecionadoMapaId, setPastoSelecionadoMapaId] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    supabase
      .from('fazendas')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => {
        setFazendas(data || [])
        if (data && data.length === 1) setFazendaId(data[0].id)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // categorias não mudam por fazenda — carrega uma vez só
  useEffect(() => {
    supabase
      .from('categorias_animal')
      .select('id, sexo, era, papel:grupos_categoria_papel(nome)')
      .then(({ data }) => {
        const mapa = new Map<string, CategoriaAnimalInfo>()
        for (const c of (data as any[]) || []) {
          mapa.set(c.id, { papel: c.papel?.nome ?? '', sexo: c.sexo, era: c.era })
        }
        setCategoriasInfo(mapa)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setPastoSelecionadoMapaId(null)
    if (!fazendaId) {
      setPastosBase(new Map())
      setFazendaGeometria(null)
      return
    }
    supabase
      .from('fazendas')
      .select('geometria')
      .eq('id', fazendaId)
      .single()
      .then(({ data }) => setFazendaGeometria((data?.geometria as Geometry | null) ?? null))
    supabase
      .from('pastos')
      .select('id, nome, area_ha, cor, geometria, modulo:modulos!modulo_id(fazenda_id)')
      .then(({ data }) => {
        const mapa = new Map<string, PastoBaseInfo>()
        for (const p of (data as any[]) || []) {
          if (p.modulo?.fazenda_id !== fazendaId) continue
          mapa.set(p.id, { areaHa: p.area_ha, cor: p.cor || '#1C8C7C', geometria: p.geometria ?? null, fazendaNome: '' })
        }
        setPastosBase(mapa)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  useEffect(() => {
    if (!fazendaId || !data) {
      setLinhas([])
      return
    }
    setLoading(true)
    setErro(null)
    supabase
      .rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fazendaId, p_data: data })
      .then(({ data: rows, error }) => {
        if (error) {
          setErro(error.message)
        } else {
          setLinhas(rows || [])
        }
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, data])

  const pastos: PastoAgrupado[] = []
  linhas.forEach((l) => {
    let grupo = pastos.find((p) => p.pasto_id === l.pasto_id)
    if (!grupo) {
      grupo = {
        pasto_id: l.pasto_id,
        pasto_nome: l.pasto_nome,
        linhas: [],
        totalQuantidade: 0,
        pesoMedio: null,
        areaHa: pastosBase.get(l.pasto_id)?.areaHa ?? null,
        lotacao: null,
      }
      pastos.push(grupo)
    }
    grupo.linhas.push(l)
    grupo.totalQuantidade += l.quantidade
  })
  // peso médio ponderado e lotação, calculados depois de agrupar (precisam do total)
  for (const p of pastos) {
    const pesoTotal = p.linhas.reduce((s, l) => s + (l.peso_medio_kg != null ? l.peso_medio_kg * l.quantidade : 0), 0)
    const quantidadeComPeso = p.linhas.reduce((s, l) => s + (l.peso_medio_kg != null ? l.quantidade : 0), 0)
    p.pesoMedio = quantidadeComPeso > 0 ? pesoTotal / quantidadeComPeso : null
    p.lotacao = p.areaHa && p.areaHa > 0 ? pesoTotal / KG_POR_UA / p.areaHa : null
  }

  const totalGeralQuantidade = linhas.reduce((s, l) => s + l.quantidade, 0)
  const totalGeralPeso = linhas.reduce((s, l) => s + (l.peso_medio_kg != null ? l.peso_medio_kg * l.quantidade : 0), 0)
  // média ponderada só sobre quem tem peso conhecido — misturar com
  // quantidade de peso desconhecido puxaria a média pra baixo à toa
  const quantidadeComPeso = linhas.reduce((s, l) => s + (l.peso_medio_kg != null ? l.quantidade : 0), 0)
  const pesoMedioGeral = quantidadeComPeso > 0 ? totalGeralPeso / quantidadeComPeso : null

  const distribuicaoMapa: PastoDistribuicao[] = montarDistribuicaoPorPasto(
    linhas as LinhaPastoRaw[],
    pastosBase,
    categoriasInfo
  )
  const temPastoComContorno = distribuicaoMapa.some((p) => p.geometria)

  return (
    <ModuloGate modulo="rebanho_por_pasto">
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Rebanho por pasto</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Fotografia de quantas cabeças de cada categoria estão em cada pasto numa data específica.
      </p>

      <div className="mt-6 flex flex-wrap gap-4 rounded-card border border-border bg-surface p-5">
        <div>
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
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Data de referência
            <Required />
          </label>
          <input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6">
        {!fazendaId ? (
          <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="text-base font-semibold text-text-primary">Selecione uma fazenda</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              Escolha a fazenda e a data acima para ver a distribuição do rebanho por pasto.
            </p>
          </div>
        ) : loading ? (
          <TableSkeleton />
        ) : erro ? (
          <p className="text-sm text-error">Erro: {erro}</p>
        ) : pastos.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="text-base font-semibold text-text-primary">Sem rebanho registrado nessa data</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              Confira o saldo inicial ou as movimentações lançadas para essa fazenda.
            </p>
          </div>
        ) : (
          <>
            {temPastoComContorno && (
              <div className="mb-6">
                <MapaDistribuicaoRebanho
                  fazendasGeometria={fazendaGeometria ? [fazendaGeometria] : []}
                  pastos={distribuicaoMapa}
                  pastoSelecionadoId={pastoSelecionadoMapaId}
                  onSelecionarPasto={setPastoSelecionadoMapaId}
                  altura={420}
                />
              </div>
            )}

            {/* tabela — telas md e acima */}
            <div className="hidden overflow-x-auto rounded-card border border-border bg-surface md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border p-3 text-left font-medium text-text-secondary">Pasto</th>
                    <th className="border-b border-border p-3 text-left font-medium text-text-secondary">Categoria</th>
                    <th className="border-b border-border p-3 text-right font-medium text-text-secondary">Quantidade</th>
                    <th className="border-b border-border p-3 text-right font-medium text-text-secondary">Peso médio</th>
                    <th className="border-b border-border p-3 text-right font-medium text-text-secondary">Peso total</th>
                  </tr>
                </thead>
                <tbody>
                  {pastos.map((p, pIdx) => {
                    const zebra = pIdx % 2 === 1
                    return p.linhas.map((l, lIdx) => (
                      <tr
                        key={`${p.pasto_id}-${l.categoria_id}`}
                        className={`${zebra ? 'bg-bg' : ''} ${pastoSelecionadoMapaId === p.pasto_id ? '!bg-brand-100' : ''}`}
                      >
                        {lIdx === 0 && (
                          <td
                            rowSpan={p.linhas.length}
                            className="cursor-pointer border-b border-border p-3 align-top font-semibold text-text-primary"
                            onClick={() => setPastoSelecionadoMapaId(p.pasto_id)}
                          >
                            {p.pasto_nome}
                            <div className="mt-1.5 flex flex-col gap-0.5 text-xs font-normal text-text-secondary">
                              <span>{formatQuantidade(p.totalQuantidade)} cab.</span>
                              <span>
                                Peso médio <b className="font-semibold text-text-primary">{formatPeso(p.pesoMedio)}</b>
                              </span>
                              <span>
                                Área{' '}
                                <b className="font-semibold text-text-primary">
                                  {p.areaHa != null ? `${formatArea(p.areaHa)} ha` : '—'}
                                </b>
                              </span>
                              <span>
                                Lotação{' '}
                                <b className="font-semibold text-text-primary">
                                  {p.lotacao != null ? `${formatLotacao(p.lotacao)} UA/ha` : '—'}
                                </b>
                              </span>
                            </div>
                          </td>
                        )}
                        <td className="border-b border-border p-3 text-text-primary">{l.categoria_nome}</td>
                        <td className="border-b border-border p-3 text-right tabular-nums">
                          {formatQuantidade(l.quantidade)}
                        </td>
                        <td className="border-b border-border p-3 text-right tabular-nums">
                          {formatPeso(l.peso_medio_kg)}
                        </td>
                        <td className="border-b border-border p-3 text-right tabular-nums">
                          {l.peso_medio_kg != null ? formatPeso(l.peso_medio_kg * l.quantidade) : '—'}
                        </td>
                      </tr>
                    ))
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="p-3 text-text-primary" colSpan={2}>
                      Total geral
                    </td>
                    <td className="p-3 text-right tabular-nums">{formatQuantidade(totalGeralQuantidade)}</td>
                    <td className="p-3 text-right tabular-nums">{formatPeso(pesoMedioGeral)}</td>
                    <td className="p-3 text-right tabular-nums">{formatPeso(totalGeralPeso)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* cards — abaixo de md, uma tabela de 5 colunas não cabe sem rolagem horizontal */}
            <div className="flex flex-col gap-3 md:hidden">
              {pastos.map((p) => (
                <div key={p.pasto_id} className="rounded-card border border-border bg-surface p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-text-primary">{p.pasto_nome}</span>
                    <span className="text-xs text-text-secondary">{formatQuantidade(p.totalQuantidade)} cab.</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
                    <span>
                      Peso médio <b className="font-semibold text-text-primary">{formatPeso(p.pesoMedio)}</b>
                    </span>
                    <span>
                      Área{' '}
                      <b className="font-semibold text-text-primary">
                        {p.areaHa != null ? `${formatArea(p.areaHa)} ha` : '—'}
                      </b>
                    </span>
                    <span>
                      Lotação{' '}
                      <b className="font-semibold text-text-primary">
                        {p.lotacao != null ? `${formatLotacao(p.lotacao)} UA/ha` : '—'}
                      </b>
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5">
                    {p.linhas.map((l) => (
                      <div key={l.categoria_id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-text-primary">{l.categoria_nome}</span>
                        <span className="shrink-0 text-right text-text-secondary tabular-nums">
                          {formatQuantidade(l.quantidade)} cab. · {formatPeso(l.peso_medio_kg)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="rounded-card border border-border bg-brand-100 p-4">
                <div className="flex items-baseline justify-between font-semibold text-text-primary">
                  <span>Total geral</span>
                  <span className="tabular-nums">{formatQuantidade(totalGeralQuantidade)} cab.</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between text-sm text-text-secondary">
                  <span>Peso médio</span>
                  <span className="tabular-nums">{formatPeso(pesoMedioGeral)}</span>
                </div>
                <div className="flex items-baseline justify-between text-sm text-text-secondary">
                  <span>Peso total</span>
                  <span className="tabular-nums">{formatPeso(totalGeralPeso)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </ModuloGate>
  )
}
