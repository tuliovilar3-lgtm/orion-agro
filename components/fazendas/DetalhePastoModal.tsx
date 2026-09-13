'use client'

// modal de detalhe do pasto — abre ao clicar num selo do mapa de distribuição do rebanho
// (Painel / Rebanho por pasto). Mostra as categorias reais do pasto (não os marcadores
// agrupados do mapa) + um resumo de KPIs + 6 ações rápidas. Nascimento/Morte/Mudança de
// Pasto/Mudança de Categoria/Desmame/Pesagem abrem um modal de lançamento embutido, sem sair
// da aba do mapa (ver LancamentoRapidoModal/PesagemRapidaModal/MovimentacaoLotesModal) — ver
// "Selos do Rebanho — Fase 4 (lançamento embutido)" no CLAUDE.md. Um botão "Outras
// movimentações" no rodapé continua abrindo a tela cheia (Venda, Transferência, Consumo/
// Doação, ou qualquer lançamento em lote fora do escopo dos modais rápidos).
import { useRouter } from 'next/navigation'
import { ICONE_SRC } from '@/lib/categoria-icones'
import { IconeMovimentacao } from '@/lib/movimentacao-icones'
import { ICONS } from '@/lib/nav-icons'
import { formatArea, formatQuantidade, formatPeso, formatLotacao } from '@/lib/format'
import type { PastoDistribuicao } from './MapaDistribuicaoRebanho'
import type { TipoLancamentoRapido } from './LancamentoRapidoModal'

const KG_POR_UA = 450

export default function DetalhePastoModal({
  pasto,
  onClose,
  onAcaoRapida,
  onAbrirMudancaPasto,
  onAbrirPesagem,
}: {
  pasto: PastoDistribuicao
  onClose: () => void
  onAcaoRapida: (tipo: TipoLancamentoRapido) => void
  onAbrirMudancaPasto: () => void
  onAbrirPesagem: () => void
}) {
  const router = useRouter()

  const totalQuantidade = pasto.categorias.reduce((s, c) => s + c.quantidade, 0)
  const pesoVivoTotal = pasto.categorias.reduce((s, c) => s + (c.pesoMedio ?? 0) * c.quantidade, 0)
  const pesoMedioGeral = totalQuantidade > 0 ? pesoVivoTotal / totalQuantidade : null
  const lotacao =
    pasto.areaHa && pasto.areaHa > 0 && totalQuantidade > 0 ? pesoVivoTotal / KG_POR_UA / pasto.areaHa : null
  const categoriasOrdenadas = [...pasto.categorias].sort((a, b) => b.quantidade - a.quantidade)

  function irParaOutrasMovimentacoes() {
    onClose()
    router.push(`/movimentacoes?fazenda=${pasto.fazendaId}&pasto=${pasto.id}`)
  }

  // "Venda" saiu daqui de propósito — venda em pé vs. abate é uma decisão que precisa de dados
  // que o pessoal de campo normalmente não tem à mão (peso morto/rendimento, preço); decisão do
  // usuário: manter aqui só movimentações simples de executar direto no campo, cada uma num
  // modal embutido (ver import acima) em vez de navegar pra outra tela.
  const acoes = [
    { label: 'Nascimento', icon: <IconeMovimentacao tipo="NASCIMENTO" />, onClick: () => onAcaoRapida('NASCIMENTO') },
    { label: 'Morte', icon: <IconeMovimentacao tipo="MORTE" />, onClick: () => onAcaoRapida('MORTE') },
    { label: 'Mudança de Pasto', icon: ICONS.controlePasto, onClick: onAbrirMudancaPasto },
    {
      label: 'Mudança de Categoria',
      icon: <IconeMovimentacao tipo="MUDANCA_CATEGORIA" />,
      onClick: () => onAcaoRapida('MUDANCA_CATEGORIA'),
    },
    { label: 'Desmame', icon: <IconeMovimentacao tipo="DESMAME" />, onClick: () => onAcaoRapida('DESMAME') },
    { label: 'Pesagem', icon: ICONS.pesagens, onClick: onAbrirPesagem },
  ]

  return (
    // z-[1100]: os controles internos do Leaflet chegam a z-index 1000 (ver leaflet.css) — um
    // z-50 comum fica por baixo deles mesmo com `isolate` no wrapper do mapa, então esse modal
    // (sempre aberto por cima de um mapa) precisa de um z-index bem acima desse teto
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-card border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-text-primary">{pasto.nome}</h2>
            <p className="truncate text-xs text-text-secondary">
              {pasto.fazendaNome}
              {pasto.moduloNome ? ` · ${pasto.moduloNome}` : ''}
            </p>
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

        <div className="mt-4 grid grid-cols-4 gap-2 rounded-control border border-border bg-bg p-3 text-center">
          <div>
            <div className="text-[11px] text-text-secondary">Área útil</div>
            <div className="text-sm font-bold tabular-nums text-text-primary">
              {pasto.areaHa != null ? `${formatArea(pasto.areaHa)} ha` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-text-secondary">Rebanho</div>
            <div className="text-sm font-bold tabular-nums text-text-primary">
              {formatQuantidade(totalQuantidade)} cab.
            </div>
          </div>
          <div>
            <div className="text-[11px] text-text-secondary">Peso médio</div>
            <div className="text-sm font-bold tabular-nums text-text-primary">
              {pesoMedioGeral != null ? `${formatPeso(pesoMedioGeral)} kg` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-text-secondary">Lotação</div>
            <div className="text-sm font-bold tabular-nums text-text-primary">
              {lotacao != null ? `${formatLotacao(lotacao)} UA/ha` : '—'}
            </div>
          </div>
        </div>

        {categoriasOrdenadas.length === 0 ? (
          <p className="mt-3 text-center text-sm text-text-muted">Sem rebanho nesse pasto</p>
        ) : (
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
            {categoriasOrdenadas.map((c) => (
              <div key={c.codigo + c.nome} className="flex items-center gap-2.5 rounded-control border border-border p-2">
                <img src={ICONE_SRC[c.codigo]} alt="" className="h-8 w-8 shrink-0 object-contain" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-primary">{c.nome}</div>
                  <div className="text-xs text-text-muted">
                    peso médio {c.pesoMedio != null ? `${formatPeso(c.pesoMedio)} kg` : '—'}
                  </div>
                  {/* nome do dono discreto, só quando a conta tem 2+ proprietários — ver
                      "Selos do Rebanho: nome do proprietário junto ao lote" no CLAUDE.md */}
                  {c.porProprietario && c.porProprietario.length > 0 && (
                    <div className="truncate text-[11px] text-text-secondary">
                      {c.porProprietario.map((pp) => `${pp.nome} (${formatQuantidade(pp.quantidade)})`).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                  {formatQuantidade(c.quantidade)} cab.
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4">
          {acoes.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="flex flex-col items-center gap-1.5 rounded-control border border-border p-2.5 text-center text-xs font-medium text-text-secondary transition-colors hover:border-brand-500 hover:bg-brand-100 hover:text-brand-700"
            >
              <span className="h-5 w-5">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={irParaOutrasMovimentacoes}
          className="mt-2 w-full rounded-control border border-dashed border-border py-2 text-center text-xs font-medium text-text-secondary transition-colors hover:border-brand-500 hover:text-brand-700"
        >
          Outras movimentações →
        </button>
      </div>
    </div>
  )
}
