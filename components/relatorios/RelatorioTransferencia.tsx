'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoeda, formatPeso, formatQuantidade } from '@/lib/format'
import KpiCard from './KpiCard'
import { MovimentacaoRelatorio, agruparPorChave, formatarDataBr, mesDaLinha, nomeMes } from './tipos'

function arrobasLinha(l: MovimentacaoRelatorio) {
  return l.peso_total_kg != null ? l.peso_total_kg / 30 : null
}

export default function RelatorioTransferencia({ linhas }: { linhas: MovimentacaoRelatorio[] }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-text-primary">Nenhuma transferência no período</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          Ajuste os filtros acima ou lance transferências em Movimentações.
        </p>
      </div>
    )
  }

  const total = linhas.reduce((s, l) => s + l.quantidade, 0)
  const valorTotal = linhas.reduce((s, l) => s + (l.valor_total ?? 0), 0)

  const porMes = [...agruparPorChave(linhas, (l) => mesDaLinha(l.data)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, ls]) => ({ mes: nomeMes(mes), quantidade: ls.reduce((s, l) => s + l.quantidade, 0) }))

  // fluxo líquido por fazenda: entradas (destino) - saídas (origem)
  const fluxo = new Map<string, number>()
  for (const l of linhas) {
    const origem = l.fazenda_origem?.nome ?? 'Não informada'
    const destino = l.fazenda_destino?.nome ?? 'Não informada'
    fluxo.set(origem, (fluxo.get(origem) ?? 0) - l.quantidade)
    fluxo.set(destino, (fluxo.get(destino) ?? 0) + l.quantidade)
  }
  const fluxoPorFazenda = [...fluxo.entries()].sort(([, a], [, b]) => b - a)

  // tabela cruzada origem x destino
  const origens = [...new Set(linhas.map((l) => l.fazenda_origem?.nome ?? 'Não informada'))].sort()
  const destinos = [...new Set(linhas.map((l) => l.fazenda_destino?.nome ?? 'Não informada'))].sort()
  const matriz = new Map<string, number>()
  for (const l of linhas) {
    const chave = `${l.fazenda_origem?.nome ?? 'Não informada'}|${l.fazenda_destino?.nome ?? 'Não informada'}`
    matriz.set(chave, (matriz.get(chave) ?? 0) + l.quantidade)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Cabeças transferidas" value={formatQuantidade(total)} />
        <KpiCard label="Valor total movimentado" value={formatMoeda(valorTotal)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Fluxo líquido por fazenda</h3>
          <div className="space-y-2">
            {fluxoPorFazenda.map(([nome, valor]) => (
              <div key={nome} className="flex items-center justify-between text-sm">
                <span className="text-text-primary">{nome}</span>
                <span className={`tabular-nums font-semibold ${valor >= 0 ? 'text-success' : 'text-error'}`}>
                  {valor >= 0 ? '+' : ''}
                  {formatQuantidade(valor)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-card border border-border bg-surface p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Cabeças transferidas: origem x destino</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="px-3 py-2 font-medium">Origem \ Destino</th>
                {destinos.map((d) => (
                  <th key={d} className="px-3 py-2 font-medium">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {origens.map((o) => (
                <tr key={o} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-text-primary">{o}</td>
                  {destinos.map((d) => (
                    <td key={d} className="px-3 py-2 tabular-nums text-text-primary">
                      {formatQuantidade(matriz.get(`${o}|${d}`) ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="px-4 py-2.5 font-medium">Data</th>
              <th className="px-4 py-2.5 font-medium">Fazenda origem</th>
              <th className="px-4 py-2.5 font-medium">Fazenda destino</th>
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 font-medium">Quantidade</th>
              <th className="px-4 py-2.5 font-medium">Peso</th>
              <th className="px-4 py-2.5 font-medium">Kg total</th>
              <th className="px-4 py-2.5 font-medium">@</th>
              <th className="px-4 py-2.5 font-medium">R$/@</th>
              <th className="px-4 py-2.5 font-medium">R$/cabeça</th>
              <th className="px-4 py-2.5 font-medium">R$/kg</th>
              <th className="px-4 py-2.5 font-medium">R$ total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-text-primary">{formatarDataBr(l.data)}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.fazenda_origem?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.fazenda_destino?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-primary">{l.categoria?.nome ?? '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatQuantidade(l.quantidade)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_medio_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(l.peso_total_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatPeso(arrobasLinha(l))}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_arroba)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_cabeca)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_kg)}</td>
                <td className="px-4 py-2.5 tabular-nums text-text-primary">{formatMoeda(l.valor_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
