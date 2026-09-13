'use client'

// modal de pesagem embutido, aberto pelo botão "Pesagem" do DetalhePastoModal — mesma família
// de LancamentoRapidoModal/MovimentacaoLotesModal, mas grava direto em `pesagens` (não em
// movimentacoes_rebanho — sem saldo/proprietário/safra envolvidos, ver "Pesagens e peso médio
// nos relatórios" no CLAUDE.md). Lista vertical de cards, um por categoria real presente no
// pasto (buscada via fn_relatorio_rebanho_por_pasto, nunca via pasto.categorias do mapa — mesmo
// motivo já documentado em MovimentacaoLotesModal/LancamentoRapidoModal), cada card salvando de
// forma independente. Mostra o último peso real já registrado (com data) pra referência, e o
// GMD calculado ao vivo entre essa última pesagem e o valor novo — primeiro uso real de
// formatGmd no sistema.
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade, formatPeso, formatGmd } from '@/lib/format'
import { formatarDataBr } from '@/components/relatorios/tipos'

type CartaoPesagem = {
  categoriaId: string
  categoriaNome: string
  quantidade: number
  ultimoPeso: number | null
  ultimaData: string | null // null quando não há pesagem real registrada (só a referência da categoria)
}

const inputSmClass =
  'w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500'
const labelSmClass = 'mb-1 block text-xs text-text-secondary'

function diasEntreDatas(inicio: string, fim: string) {
  const d1 = new Date(inicio + 'T00:00:00')
  const d2 = new Date(fim + 'T00:00:00')
  return Math.round((d2.getTime() - d1.getTime()) / 86400000)
}

export default function PesagemRapidaModal({
  fazendaId,
  pastoId,
  pastoNome,
  onClose,
  onSalvo,
}: {
  fazendaId: string
  pastoId: string
  pastoNome: string
  onClose: () => void
  onSalvo: () => void
}) {
  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const [carregando, setCarregando] = useState(true)
  const [cartoes, setCartoes] = useState<CartaoPesagem[]>([])
  const [data, setData] = useState(hoje)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      const [totalResp, pesagensResp] = await Promise.all([
        supabase.rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fazendaId, p_data: hoje }),
        supabase
          .from('pesagens')
          .select('categoria_id, data, peso_medio_kg')
          .eq('fazenda_id', fazendaId)
          .eq('pasto_id', pastoId)
          .order('data', { ascending: false }),
      ])
      if (cancelado) return

      const linhasPasto = ((totalResp.data || []) as any[]).filter((l) => l.pasto_id === pastoId)
      const ultimaPorCategoria = new Map<string, { data: string; peso: number }>()
      for (const p of (pesagensResp.data || []) as any[]) {
        if (!ultimaPorCategoria.has(p.categoria_id)) {
          ultimaPorCategoria.set(p.categoria_id, { data: p.data, peso: p.peso_medio_kg })
        }
      }
      setCartoes(
        linhasPasto.map((l) => {
          const ultima = ultimaPorCategoria.get(l.categoria_id)
          return {
            categoriaId: l.categoria_id,
            categoriaNome: l.categoria_nome,
            quantidade: l.quantidade,
            ultimoPeso: ultima ? ultima.peso : l.peso_medio_kg,
            ultimaData: ultima ? ultima.data : null,
          }
        })
      )
      setCarregando(false)
    }
    carregar()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, pastoId])

  function definirDataAtalho(diasAtras: number) {
    const d = new Date()
    d.setDate(d.getDate() - diasAtras)
    setData(d.toISOString().slice(0, 10))
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Pesagem</h2>
            <p className="text-xs text-text-secondary">{pastoNome}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-text-secondary hover:bg-bg"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {carregando ? (
          <div className="mt-6 animate-pulse space-y-3">
            <div className="h-4 w-2/3 rounded bg-border" />
            <div className="h-24 rounded bg-border" />
          </div>
        ) : (
          <>
            <div className="mt-4 max-w-xs">
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Data</label>
              <input
                type="date"
                max={hoje}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
              <div className="mt-1.5 flex gap-3">
                <button type="button" onClick={() => definirDataAtalho(0)} className="text-xs font-medium text-brand-500 underline">
                  Hoje
                </button>
                <button type="button" onClick={() => definirDataAtalho(1)} className="text-xs font-medium text-brand-500 underline">
                  Ontem
                </button>
              </div>
            </div>

            <div className="mt-4">
              {cartoes.length === 0 ? (
                <p className="text-sm text-text-muted">Sem rebanho nesse pasto.</p>
              ) : (
                <div className="space-y-3">
                  {cartoes.map((c) => (
                    <CardPesagem key={c.categoriaId} cartao={c} fazendaId={fazendaId} pastoId={pastoId} data={data} onSalvo={onSalvo} />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end border-t border-border pt-4">
              <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm">
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CardPesagem({
  cartao,
  fazendaId,
  pastoId,
  data,
  onSalvo,
}: {
  cartao: CartaoPesagem
  fazendaId: string
  pastoId: string
  data: string
  onSalvo: () => void
}) {
  const supabase = createClient()
  const [pesoNovo, setPesoNovo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const pesoNovoNum = parseFloat(pesoNovo)
  const dias = cartao.ultimaData ? diasEntreDatas(cartao.ultimaData, data) : null
  const gmd =
    cartao.ultimaData && cartao.ultimoPeso != null && dias != null && dias > 0 && Number.isFinite(pesoNovoNum)
      ? (pesoNovoNum - cartao.ultimoPeso) / dias
      : null

  async function handleSalvar() {
    setErro(null)
    if (!Number.isFinite(pesoNovoNum) || pesoNovoNum <= 0) return setErro('Informe o peso médio.')

    setSalvando(true)
    const { error } = await supabase.from('pesagens').insert({
      fazenda_id: fazendaId,
      pasto_id: pastoId,
      categoria_id: cartao.categoriaId,
      data,
      peso_medio_kg: pesoNovoNum,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) return setErro(error.message)
    setSalvo(true)
    onSalvo()
  }

  if (salvo) {
    return (
      <div className="flex items-center gap-2 rounded-control border border-success bg-success-bg px-3 py-3 text-sm text-success">
        <span>✓</span>
        <span>
          {cartao.categoriaNome}: {formatPeso(pesoNovoNum)} kg registrado.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-control border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-text-primary">{cartao.categoriaNome}</span>
        <span className="shrink-0 text-xs text-text-secondary">{formatQuantidade(cartao.quantidade)} cab.</span>
      </div>
      <p className="mb-2 text-xs text-text-secondary">
        Último peso: {cartao.ultimoPeso != null ? `${formatPeso(cartao.ultimoPeso)} kg` : '—'}
        {cartao.ultimaData ? ` em ${formatarDataBr(cartao.ultimaData)}` : ''}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelSmClass}>
            Peso médio (kg)
            <Required />
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={inputSmClass}
            value={pesoNovo}
            onChange={(e) => setPesoNovo(e.target.value)}
          />
        </div>
        <div>
          <label className={labelSmClass}>GMD (kg/cab/dia)</label>
          <div className="flex items-center rounded-control border border-border bg-bg px-2 py-1.5 text-sm tabular-nums text-text-secondary">
            {gmd != null ? formatGmd(gmd) : '—'}
          </div>
        </div>
      </div>
      <div className="mt-2">
        <label className={labelSmClass}>Observação</label>
        <textarea className={inputSmClass} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      {erro && <div className="mt-2 rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={salvando}
          onClick={handleSalvar}
          className="rounded-control bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
