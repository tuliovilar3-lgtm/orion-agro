'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade, formatPeso as formatPesoValor } from '@/lib/format'

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
      grupo = { pasto_id: l.pasto_id, pasto_nome: l.pasto_nome, linhas: [], totalQuantidade: 0 }
      pastos.push(grupo)
    }
    grupo.linhas.push(l)
    grupo.totalQuantidade += l.quantidade
  })

  const totalGeralQuantidade = linhas.reduce((s, l) => s + l.quantidade, 0)
  const totalGeralPeso = linhas.reduce((s, l) => s + (l.peso_medio_kg != null ? l.peso_medio_kg * l.quantidade : 0), 0)
  // média ponderada só sobre quem tem peso conhecido — misturar com
  // quantidade de peso desconhecido puxaria a média pra baixo à toa
  const quantidadeComPeso = linhas.reduce((s, l) => s + (l.peso_medio_kg != null ? l.quantidade : 0), 0)
  const pesoMedioGeral = quantidadeComPeso > 0 ? totalGeralPeso / quantidadeComPeso : null

  return (
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
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
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
                    <tr key={`${p.pasto_id}-${l.categoria_id}`} className={zebra ? 'bg-bg' : undefined}>
                      {lIdx === 0 && (
                        <td
                          rowSpan={p.linhas.length}
                          className="border-b border-border p-3 align-top font-semibold text-text-primary"
                        >
                          {p.pasto_nome}
                          <div className="mt-0.5 text-xs font-normal text-text-secondary">
                            {formatQuantidade(p.totalQuantidade)} cab.
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
        )}
      </div>
    </div>
  )
}
