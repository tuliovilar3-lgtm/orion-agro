'use client'

import { useEffect, useRef, useState } from 'react'
import { safraSugeridaParaData, formatSafra, formatSafraInput, extrairAnoSafraDigitado } from '@/lib/periodo'
import { formatQuantidade } from '@/lib/format'

export type SafraDetalhe = {
  id: string
  safra: string // dígitos do ano de início, mesmo formato de extrairAnoSafraDigitado
  quantidade: string
}

// Categoria de bezerro no Saldo Inicial pode legitimamente conter animais
// de mais de uma safra de nascimento na mesma linha (migração 066) — esse
// controle fica fechado por padrão (só o texto da safra + um ✎), e só vira
// uma divisão de fato quando o usuário edita a quantidade de uma linha ou
// clica "+ Adicionar safra"; até lá, a quantidade total da categoria
// sempre cai inteira numa safra só (a sugerida pra data de referência, ou
// a já salva). Compartilhado entre a aba "Saldo por Categorias" e "Saldo
// por Pasto" — o dado persistido (saldo_inicial_safras) é o mesmo nos
// dois casos, só a quantidade total de referência muda (a da categoria vs.
// a da linha dentro daquele pasto).
export default function DetalheSafraBezerro({
  quantidadeTotal,
  dataReferencia,
  detalhes,
  onChange,
}: {
  quantidadeTotal: number
  dataReferencia: string
  detalhes: SafraDetalhe[]
  onChange: (novo: SafraDetalhe[]) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onClickFora)
    return () => document.removeEventListener('mousedown', onClickFora)
  }, [aberto])

  const dividido = detalhes.length > 1
  const safraSugeridaAtual = dataReferencia ? String(safraSugeridaParaData(dataReferencia)) : ''
  const safraUnica = detalhes[0]?.safra || safraSugeridaAtual
  const soma = detalhes.reduce((s, d) => s + (parseInt(d.quantidade, 10) || 0), 0)
  const somaOk = !dividido || soma === quantidadeTotal

  function mudarSafraUnica(valor: string) {
    onChange([{ id: detalhes[0]?.id ?? crypto.randomUUID(), safra: valor, quantidade: String(quantidadeTotal) }])
  }

  function mudarSafraLinha(id: string, valor: string) {
    onChange(detalhes.map((d) => (d.id === id ? { ...d, safra: valor } : d)))
  }

  function mudarQtdLinha(id: string, valor: string) {
    onChange(detalhes.map((d) => (d.id === id ? { ...d, quantidade: valor } : d)))
  }

  function adicionarSafra() {
    const base = detalhes.length > 0 ? detalhes : [{ id: crypto.randomUUID(), safra: safraSugeridaAtual, quantidade: String(quantidadeTotal) }]
    const anoAtual = dataReferencia ? safraSugeridaParaData(dataReferencia) : new Date().getFullYear()
    const usadas = new Set(base.map((d) => d.safra))
    const candidatos = [anoAtual, anoAtual - 1, anoAtual + 1].map(String)
    const proxima = candidatos.find((s) => !usadas.has(s)) || String(anoAtual)
    onChange([...base, { id: crypto.randomUUID(), safra: proxima, quantidade: '0' }])
  }

  function removerLinha(id: string) {
    if (detalhes.length <= 1) return
    onChange(detalhes.filter((d) => d.id !== id))
  }

  const inputClass =
    'rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500'

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-semibold text-text-primary"
        onClick={() => setAberto((v) => !v)}
      >
        <span>{formatSafraInput(safraUnica)}</span>
        <span className="text-xs text-text-muted hover:text-brand-500" title="Detalhar por safra">
          ✎
        </span>
      </button>

      {aberto && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-control border border-border bg-surface p-3 text-left shadow-lg">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
            Quantidade por safra de nascimento
          </p>

          {!dividido ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Safra</label>
              <input
                type="text"
                inputMode="numeric"
                className={`w-full ${inputClass}`}
                value={formatSafraInput(safraUnica)}
                onChange={(e) => mudarSafraUnica(extrairAnoSafraDigitado(e.target.value))}
                onFocus={(e) => e.target.select()}
                autoFocus
              />
              <p className="mt-1 text-xs text-text-muted">
                As {formatQuantidade(quantidadeTotal)} cabeças caem inteiras nessa safra.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {detalhes.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`w-24 ${inputClass}`}
                    value={formatSafraInput(d.safra)}
                    onChange={(e) => mudarSafraLinha(d.id, extrairAnoSafraDigitado(e.target.value))}
                    onFocus={(e) => e.target.select()}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={`w-20 flex-1 ${inputClass}`}
                    value={d.quantidade}
                    onChange={(e) => mudarQtdLinha(d.id, e.target.value)}
                  />
                  <button
                    type="button"
                    title="Remover safra"
                    disabled={detalhes.length <= 1}
                    onClick={() => removerLinha(d.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-border text-text-muted hover:border-error hover:text-error disabled:opacity-30"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
                <span className="text-text-secondary">Soma precisa bater com {formatQuantidade(quantidadeTotal)}</span>
                <span className={`font-bold tabular-nums ${somaOk ? 'text-success' : 'text-error'}`}>
                  {formatQuantidade(soma)} / {formatQuantidade(quantidadeTotal)}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={adicionarSafra}
            className="mt-2.5 rounded-control border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-brand-500 hover:border-brand-500 hover:bg-brand-100"
          >
            + Adicionar safra
          </button>
        </div>
      )}
    </div>
  )
}

export function safraDetalheInicial(safraExistente: string | null, dataReferencia: string): SafraDetalhe[] {
  const safra = safraExistente || (dataReferencia ? String(safraSugeridaParaData(dataReferencia)) : '')
  return [{ id: crypto.randomUUID(), safra, quantidade: '' }]
}

// safra "representativa" da linha-mãe quando dividido (a de maior
// quantidade) — usada só como valor de referência em
// safra_nascimento_ano_inicio, já que a checagem de saldo real por safra
// (fn_saldo_categoria_safra) passa a ler o detalhamento, não essa coluna,
// assim que ele existir (migração 066).
export function safraRepresentativa(detalhes: SafraDetalhe[]): number | null {
  if (detalhes.length === 0) return null
  const maior = [...detalhes].sort((a, b) => (parseInt(b.quantidade, 10) || 0) - (parseInt(a.quantidade, 10) || 0))[0]
  return maior.safra ? parseInt(maior.safra, 10) : null
}
