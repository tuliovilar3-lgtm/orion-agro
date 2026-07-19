'use client'

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDecimal, formatMoeda, formatPeso, formatQuantidade } from '@/lib/format'
import { CORES_BINARIAS } from '@/lib/relatorio-cores'
import KpiCard from './KpiCard'
import { MovimentacaoRelatorio, agruparPorChave, formatarDataBr, mesDaLinha, nomeMes, valorLiquido } from './tipos'

function arrobasLinha(l: MovimentacaoRelatorio) {
  if (l.peso_morto_kg != null) return l.peso_morto_kg / 15
  if (l.peso_total_kg != null) return l.peso_total_kg / 30
  return null
}

function rotuloSubtipo(s: MovimentacaoRelatorio['subtipo_consumo_doacao']) {
  return s === 'DOACAO' ? 'Doação' : 'Consumo interno'
}

export default function RelatorioConsumoDoacao({ linhas }: { linhas: MovimentacaoRelatorio[] }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-text-primary">Nenhum consumo/doação no período</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          Ajuste os filtros acima ou lance ocorrências em Movimentações.
        </p>
      </div>
    )
  }

  const total = linhas.reduce((s, l) => s + l.quantidade, 0)
  const valorEstimado = linhas.reduce((s, l) => s + (valorLiquido(l) ?? 0), 0)
  const consumo = linhas.filter((l) => l.subtipo_consumo_doacao !== 'DOACAO').reduce((s, l) => s + l.quantidade, 0)
  const doacao = total - consumo

  const porSubtipo = [
    { nome: 'Consumo interno', quantidade: consumo },
    { nome: 'Doação', quantidade: doacao },
  ].filter((s) => s.quantidade > 0)

  const porMes = [...agruparPorChave(linhas, (l) => mesDaLinha(l.data)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, ls]) => ({ mes: nomeMes(mes), quantidade: ls.reduce((s, l) => s + l.quantidade, 0) }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total de cabeças" value={formatQuantidade(total)} />
        <KpiCard label="Valor estimado" value={formatMoeda(valorEstimado)} hint="líquido" />
        <KpiCard label="Consumo interno" value={formatQuantidade(consumo)} hint={`${((consumo / total) * 100).toFixed(0)}%`} />
        <KpiCard label="Doação" value={formatQuantidade(doacao)} hint={`${((doacao / total) * 100).toFixed(0)}%`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Consumo x Doação</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={porSubtipo} dataKey="quantidade" nameKey="nome" outerRadius={80} label>
                {porSubtipo.map((_, i) => (
                  <Cell key={i} fill={CORES_BINARIAS[i % 2]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => formatQuantidade(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Evolução mensal</h3>
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
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="px-4 py-2.5 font-medium">Data</th>
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 font-medium">Subtipo</th>
              <th className="px-4 py-2.5 font-medium">Qtde.</th>
              <th className="px-4 py-2.5 font-medium">Peso vivo (kg)</th>
              <th className="px-4 py-2.5 font-medium">Kg total</th>
              <th className="px-4 py-2.5 font-medium">RC %</th>
              <th className="px-4 py-2.5 font-medium">@</th>
              <th className="px-4 py-2.5 font-medium">Kg morto</th>
              <th className="px-4 py-2.5 font-medium">R$/@</th>
              <th className="px-4 py-2.5 font-medium">R$/cabeça</th>
              <th className="px-4 py-2.5 font-medium">R$ total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-text-primary">{formatarDataBr(l.data)}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.categoria?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{rotuloSubtipo(l.subtipo_consumo_doacao)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatQuantidade(l.quantidade)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_medio_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_total_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatDecimal(l.rendimento_carcaca_pct)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(arrobasLinha(l))}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_morto_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_arroba)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_cabeca)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(valorLiquido(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
