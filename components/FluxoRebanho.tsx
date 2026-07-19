import { formatQuantidade } from '@/lib/format'

// espelha o retorno de fn_relatorio_movimentacao_rebanho (uma linha por
// categoria) — reaproveitado tanto por app/relatorio-movimentacao quanto
// pelo Painel, cada um buscando essa mesma função com filtros próprios
export type LinhaFluxoRebanho = {
  estoque_inicial: number
  entrada_nascimento: number
  entrada_compra: number
  entrada_transferencia: number
  saida_morte: number
  saida_venda: number
  saida_consumo_doacao: number
  saida_transferencia: number
  estoque_final: number
}

type FluxoItem = { label: string; valor: number }

// soma as linhas por categoria em totais do rebanho inteiro. Desmame e
// Mudança de Categoria ficam de fora de propósito: são reclassificação
// interna (saída de uma categoria = entrada de outra), então somados em
// todas as categorias sempre se cancelam — não representam animal
// entrando ou saindo do rebanho, só aparecem no detalhe por categoria.
export function somarFluxoRebanho(linhas: LinhaFluxoRebanho[]) {
  const soma = (campo: keyof LinhaFluxoRebanho) => linhas.reduce((s, l) => s + l[campo], 0)
  return {
    estoqueInicial: soma('estoque_inicial'),
    entradas: [
      { label: 'Nascimentos', valor: soma('entrada_nascimento') },
      { label: 'Compras', valor: soma('entrada_compra') },
      { label: 'Transferência', valor: soma('entrada_transferencia') },
    ] as FluxoItem[],
    saidas: [
      { label: 'Mortalidade', valor: soma('saida_morte') },
      { label: 'Vendas/Abates', valor: soma('saida_venda') },
      { label: 'Consumo/Doação', valor: soma('saida_consumo_doacao') },
      { label: 'Transferência', valor: soma('saida_transferencia') },
    ] as FluxoItem[],
    estoqueFinal: soma('estoque_final'),
  }
}

export default function FluxoRebanho({
  estoqueInicial,
  entradas,
  saidas,
  estoqueFinal,
  labelInicial = 'Estoque Inicial',
  labelFinal = 'Estoque Final',
}: {
  estoqueInicial: number
  entradas: FluxoItem[]
  saidas: FluxoItem[]
  estoqueFinal: number
  labelInicial?: string
  labelFinal?: string
}) {
  const entradasVisiveis = entradas.filter((e) => e.valor > 0)
  const saidasVisiveis = saidas.filter((s) => s.valor > 0)

  return (
    <div className="relative py-2">
      <div className="pointer-events-none absolute left-[104px] right-[104px] top-1/2 hidden h-px -translate-y-1/2 bg-border sm:block" />
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="w-24 shrink-0 text-center">
          <div className="rounded-control border-2 border-brand-500 bg-brand-100 px-2 py-2.5">
            <div className="text-lg font-extrabold tabular-nums text-text-primary">{formatQuantidade(estoqueInicial)}</div>
          </div>
          <div className="mt-1.5 text-xs font-semibold text-text-secondary">{labelInicial}</div>
        </div>

        <div className="flex w-full flex-1 flex-col gap-2.5 sm:w-auto sm:px-2">
          {entradasVisiveis.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {entradasVisiveis.map((e) => (
                <span
                  key={e.label}
                  className="rounded-control bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700"
                >
                  +{formatQuantidade(e.valor)} {e.label}
                </span>
              ))}
            </div>
          )}
          {saidasVisiveis.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {saidasVisiveis.map((s) => (
                <span key={s.label} className="rounded-control bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  -{formatQuantidade(s.valor)} {s.label}
                </span>
              ))}
            </div>
          )}
          {entradasVisiveis.length === 0 && saidasVisiveis.length === 0 && (
            <p className="text-center text-xs text-text-muted">Nenhuma movimentação no período</p>
          )}
        </div>

        <div className="w-24 shrink-0 text-center">
          <div className="rounded-control border-2 border-brand-500 bg-brand-100 px-2 py-2.5">
            <div className="text-lg font-extrabold tabular-nums text-text-primary">{formatQuantidade(estoqueFinal)}</div>
          </div>
          <div className="mt-1.5 text-xs font-semibold text-text-secondary">{labelFinal}</div>
        </div>
      </div>
    </div>
  )
}
