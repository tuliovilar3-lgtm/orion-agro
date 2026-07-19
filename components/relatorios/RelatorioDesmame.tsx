'use client'

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatPeso, formatQuantidade } from '@/lib/format'
import { corCategorica } from '@/lib/relatorio-cores'
import KpiCard from './KpiCard'
import {
  MovimentacaoRelatorio,
  agruparPorChave,
  formatSafraNasc,
  formatarDataBr,
  mediaPonderada,
  mesDaLinha,
  nomeMes,
} from './tipos'

export default function RelatorioDesmame({ linhas }: { linhas: MovimentacaoRelatorio[] }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-text-primary">Nenhum desmame no período</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          Ajuste os filtros acima ou lance desmames em Movimentações.
        </p>
      </div>
    )
  }

  const total = linhas.reduce((s, l) => s + l.quantidade, 0)
  const pesoMedio = mediaPonderada(linhas.map((l) => ({ valor: l.peso_medio_kg, peso: l.quantidade })))
  const safras = new Set(linhas.map((l) => l.safra_nascimento_ano_inicio).filter((s) => s != null))

  const porMes = [...agruparPorChave(linhas, (l) => mesDaLinha(l.data)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, ls]) => ({
      mes: nomeMes(mes),
      quantidade: ls.reduce((s, l) => s + l.quantidade, 0),
      pesoMedio: mediaPonderada(ls.map((l) => ({ valor: l.peso_medio_kg, peso: l.quantidade }))),
    }))

  const porSafra = [...agruparPorChave(linhas, (l) => String(l.safra_nascimento_ano_inicio ?? 'sem-safra')).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([safra, ls]) => ({
      safra: safra === 'sem-safra' ? 'Sem safra' : formatSafraNasc(Number(safra)),
      quantidade: ls.reduce((s, l) => s + l.quantidade, 0),
    }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total desmamado" value={formatQuantidade(total)} />
        <KpiCard label="Peso médio ao desmame" value={`${formatPeso(pesoMedio)} kg`} hint="média ponderada" />
        <KpiCard label="Safras no período" value={formatQuantidade(safras.size)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Peso médio por mês</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: any) => `${formatPeso(v)} kg`} />
              <Line type="monotone" dataKey="pesoMedio" stroke="#1C8C7C" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Desmames por safra</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porSafra}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis dataKey="safra" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
              <Bar dataKey="quantidade" radius={[4, 4, 0, 0]}>
                {porSafra.map((_, i) => (
                  <Cell key={i} fill={corCategorica(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="px-4 py-2.5 font-medium">Data</th>
              <th className="px-4 py-2.5 font-medium">Qtde.</th>
              <th className="px-4 py-2.5 font-medium">Peso</th>
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 font-medium">Safra</th>
              <th className="px-4 py-2.5 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-text-primary">{formatarDataBr(l.data)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatQuantidade(l.quantidade)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_medio_kg)} kg</td>
                <td className="px-4 py-2.5 text-text-primary">{l.categoria_destino?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{formatSafraNasc(l.safra_nascimento_ano_inicio)}</td>
                <td className="px-4 py-2.5 text-text-muted">{l.observacao || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
