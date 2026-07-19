'use client'

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatPeso, formatQuantidade } from '@/lib/format'
import { corCategorica } from '@/lib/relatorio-cores'
import KpiCard from './KpiCard'
import { MovimentacaoRelatorio, agruparPorChave, formatarDataBr, mesDaLinha, nomeMes } from './tipos'

export default function RelatorioMortalidade({ linhas }: { linhas: MovimentacaoRelatorio[] }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-text-primary">Nenhuma morte registrada no período</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          Ajuste os filtros acima ou lance ocorrências em Movimentações.
        </p>
      </div>
    )
  }

  const total = linhas.reduce((s, l) => s + l.quantidade, 0)

  const porCausa = [...agruparPorChave(linhas, (l) => l.causa_morte || 'Não informada').entries()]
    .map(([causa, ls]) => ({ nome: causa, quantidade: ls.reduce((s, l) => s + l.quantidade, 0) }))
    .sort((a, b) => b.quantidade - a.quantidade)

  const porGrupo = [...agruparPorChave(linhas, (l) => l.categoria?.grupo?.nome || 'Não informado').entries()]
    .map(([grupo, ls]) => ({ nome: grupo, quantidade: ls.reduce((s, l) => s + l.quantidade, 0) }))
    .sort((a, b) => b.quantidade - a.quantidade)

  const porMes = [...agruparPorChave(linhas, (l) => mesDaLinha(l.data)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, ls]) => ({ mes: nomeMes(mes), quantidade: ls.reduce((s, l) => s + l.quantidade, 0) }))

  const causaMaisFrequente = porCausa[0]?.nome ?? '—'
  const grupoMaisAfetado = porGrupo[0]?.nome ?? '—'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total de mortes" value={formatQuantidade(total)} />
        <KpiCard label="Causa mais frequente" value={causaMaisFrequente} />
        <KpiCard label="Grupo mais afetado" value={grupoMaisAfetado} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Mortes por causa</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porCausa} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="nome" tick={{ fontSize: 12 }} width={100} />
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
              <Bar dataKey="quantidade" radius={[0, 4, 4, 0]}>
                {porCausa.map((_, i) => (
                  <Cell key={i} fill={corCategorica(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Mortes por grupo faixa etária</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={porGrupo} dataKey="quantidade" nameKey="nome" outerRadius={80} label>
                {porGrupo.map((_, i) => (
                  <Cell key={i} fill={corCategorica(i)} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Evolução mensal</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
              <Bar dataKey="quantidade" fill="#D64545" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="px-4 py-2.5 font-medium">Data</th>
              <th className="px-4 py-2.5 font-medium">Causa mortis</th>
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 font-medium">Qtd.</th>
              <th className="px-4 py-2.5 font-medium">Peso vivo</th>
              <th className="px-4 py-2.5 font-medium">Peso total</th>
              <th className="px-4 py-2.5 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-text-primary">{formatarDataBr(l.data)}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.causa_morte || '—'}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.categoria?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatQuantidade(l.quantidade)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_medio_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_total_kg)}</td>
                <td className="px-4 py-2.5 text-text-muted">{l.observacao || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
