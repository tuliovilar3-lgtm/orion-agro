'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDecimal, formatMoeda, formatPeso, formatQuantidade } from '@/lib/format'
import { corCategorica } from '@/lib/relatorio-cores'
import KpiCard from './KpiCard'
import {
  MovimentacaoRelatorio,
  agruparPorChave,
  formatarDataBr,
  mediaPonderada,
  mesDaLinha,
  nomeMes,
  valorLiquido,
} from './tipos'

// PESO MORTO/RENDIMENTO são a fonte de verdade do fator 15 em venda abate —
// arroba total sempre a partir do peso morto (lote), nunca do vivo
function arrobasLinha(l: MovimentacaoRelatorio) {
  return l.peso_morto_kg != null ? l.peso_morto_kg / 15 : null
}

export default function RelatorioVendaAbate({ linhas }: { linhas: MovimentacaoRelatorio[] }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-text-primary">Nenhuma venda abate no período</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          Ajuste os filtros acima ou lance vendas abate em Movimentações.
        </p>
      </div>
    )
  }

  const total = linhas.reduce((s, l) => s + l.quantidade, 0)
  const receitaTotal = linhas.reduce((s, l) => s + (valorLiquido(l) ?? 0), 0)
  const rcMedio = mediaPonderada(linhas.map((l) => ({ valor: l.rendimento_carcaca_pct, peso: l.quantidade })))
  const precoMedioArroba = mediaPonderada(linhas.map((l) => ({ valor: l.valor_arroba, peso: arrobasLinha(l) ?? 0 })))

  const porMes = [...agruparPorChave(linhas, (l) => mesDaLinha(l.data)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, ls]) => ({
      mes: nomeMes(mes),
      rc: mediaPonderada(ls.map((l) => ({ valor: l.rendimento_carcaca_pct, peso: l.quantidade }))),
    }))

  const porCliente = [...agruparPorChave(linhas, (l) => l.cliente?.nome ?? 'Não informado').entries()]
    .map(([nome, ls]) => ({ nome, valor: ls.reduce((s, l) => s + (valorLiquido(l) ?? 0), 0) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)

  const pesoPorCategoria = [...agruparPorChave(linhas, (l) => l.categoria?.nome ?? '—').entries()].map(
    ([nome, ls]) => ({
      nome,
      pesoMedio: mediaPonderada(ls.map((l) => ({ valor: l.peso_medio_kg, peso: l.quantidade }))),
    })
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Cabeças abatidas" value={formatQuantidade(total)} />
        <KpiCard label="Receita total" value={formatMoeda(receitaTotal)} hint="líquido" />
        <KpiCard label="Rendimento de carcaça médio" value={`${formatDecimal(rcMedio)}%`} hint="média ponderada" />
        <KpiCard label="Preço médio (@)" value={formatMoeda(precoMedioArroba)} hint="média ponderada" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Rendimento de carcaça ao longo do tempo</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v: any) => `${formatDecimal(v)}%`} />
              <Line type="monotone" dataKey="rc" stroke="#1C8C7C" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Receita por cliente</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porCliente} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="nome" tick={{ fontSize: 12 }} width={100} />
              <Tooltip formatter={(v: any) => formatMoeda(v)} />
              <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                {porCliente.map((_, i) => (
                  <Cell key={i} fill={corCategorica(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-border bg-surface p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Peso vivo médio de abate por categoria</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={pesoPorCategoria}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDE4E1" />
              <XAxis dataKey="nome" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: any) => `${formatPeso(v)} kg`} />
              <Bar dataKey="pesoMedio" radius={[4, 4, 0, 0]}>
                {pesoPorCategoria.map((_, i) => (
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
              <th className="px-4 py-2.5 font-medium">Cliente</th>
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 font-medium">Qtde.</th>
              <th className="px-4 py-2.5 font-medium">Peso vivo (kg)</th>
              <th className="px-4 py-2.5 font-medium">Kg vivo total</th>
              <th className="px-4 py-2.5 font-medium">Peso morto (kg)</th>
              <th className="px-4 py-2.5 font-medium">Morto total</th>
              <th className="px-4 py-2.5 font-medium">RC %</th>
              <th className="px-4 py-2.5 font-medium">@</th>
              <th className="px-4 py-2.5 font-medium">R$/@</th>
              <th className="px-4 py-2.5 font-medium">R$/cabeça</th>
              <th className="px-4 py-2.5 font-medium">R$/kg</th>
              <th className="px-4 py-2.5 font-medium">R$ total</th>
              <th className="px-4 py-2.5 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-text-primary">{formatarDataBr(l.data)}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.cliente?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.categoria?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatQuantidade(l.quantidade)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_medio_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_total_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">
                  {formatPeso(l.peso_morto_kg != null ? l.peso_morto_kg / l.quantidade : null)}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_morto_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatDecimal(l.rendimento_carcaca_pct)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(arrobasLinha(l))}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_arroba)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_cabeca)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(valorLiquido(l))}</td>
                <td className="px-4 py-2.5 text-text-muted">{l.observacao || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
