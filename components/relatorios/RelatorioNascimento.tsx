'use client'

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatQuantidade } from '@/lib/format'
import { corCategorica, CORES_BINARIAS } from '@/lib/relatorio-cores'
import KpiCard from './KpiCard'
import { MovimentacaoRelatorio, agruparPorChave, formatSafraNasc, formatarDataBr, mesDaLinha, nomeMes } from './tipos'

export default function RelatorioNascimento({ linhas }: { linhas: MovimentacaoRelatorio[] }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-text-primary">Nenhum nascimento no período</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          Ajuste os filtros acima ou lance nascimentos em Movimentações.
        </p>
      </div>
    )
  }

  const total = linhas.reduce((s, l) => s + l.quantidade, 0)
  const machos = linhas.filter((l) => l.categoria?.sexo === 'MACHO').reduce((s, l) => s + l.quantidade, 0)
  const femeas = total - machos
  const safras = new Set(linhas.map((l) => l.safra_nascimento_ano_inicio).filter((s) => s != null))

  const porMes = [...agruparPorChave(linhas, (l) => mesDaLinha(l.data)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, ls]) => ({ mes: nomeMes(mes), quantidade: ls.reduce((s, l) => s + l.quantidade, 0) }))

  const porSexo = [
    { nome: 'Machos', quantidade: machos },
    { nome: 'Fêmeas', quantidade: femeas },
  ].filter((s) => s.quantidade > 0)

  const porSafra = [...agruparPorChave(linhas, (l) => String(l.safra_nascimento_ano_inicio ?? 'sem-safra')).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([safra, ls]) => ({
      safra: safra === 'sem-safra' ? 'Sem safra' : formatSafraNasc(Number(safra)),
      quantidade: ls.reduce((s, l) => s + l.quantidade, 0),
    }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total nascido" value={formatQuantidade(total)} />
        <KpiCard label="Machos" value={formatQuantidade(machos)} hint={`${((machos / total) * 100).toFixed(0)}%`} />
        <KpiCard label="Fêmeas" value={formatQuantidade(femeas)} hint={`${((femeas / total) * 100).toFixed(0)}%`} />
        <KpiCard label="Safras no período" value={formatQuantidade(safras.size)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Nascimentos por mês</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
              <Bar dataKey="quantidade" fill="#1C8C7C" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Distribuição por sexo</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={porSexo} dataKey="quantidade" nameKey="nome" outerRadius={80} label>
                {porSexo.map((_, i) => (
                  <Cell key={i} fill={CORES_BINARIAS[i % 2]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Nascimentos por safra</h3>
          <ResponsiveContainer width="100%" height={220}>
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
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 font-medium">Sexo</th>
              <th className="px-4 py-2.5 font-medium">Safra</th>
              <th className="px-4 py-2.5 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-text-primary">{formatarDataBr(l.data)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatQuantidade(l.quantidade)}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.categoria?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{l.categoria?.sexo === 'MACHO' ? 'Macho' : 'Fêmea'}</td>
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
