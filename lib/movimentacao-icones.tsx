// ícone + direção (entrada/saída/interno) por tipo de movimentação —
// extraído de app/movimentacoes/page.tsx pra ser reaproveitado também em
// app/relatorio-movimentacao/page.tsx (mesmo princípio já usado em
// lib/nav-icons.tsx, extraído de Sidebar pra ser reaproveitado no Modo
// Campo). Nunca usa success/error pra cor de direção (reservados pra
// confirmação/bloqueio) — saída não é "ruim", é o propósito comercial do
// rebanho, mesmo princípio já documentado em FluxoRebanho.
export type TipoMovimentacao =
  | 'NASCIMENTO'
  | 'DESMAME'
  | 'COMPRA'
  | 'VENDA_PE'
  | 'VENDA_ABATE'
  | 'MORTE'
  | 'CONSUMO_DOACAO'
  | 'MUDANCA_CATEGORIA'
  | 'TRANSFERENCIA'

export type Direcao = 'entrada' | 'saida' | 'interno'

export const DIRECAO_TIPO: Record<TipoMovimentacao, Direcao> = {
  NASCIMENTO: 'entrada',
  COMPRA: 'entrada',
  VENDA_PE: 'saida',
  VENDA_ABATE: 'saida',
  MORTE: 'saida',
  CONSUMO_DOACAO: 'saida',
  DESMAME: 'interno',
  MUDANCA_CATEGORIA: 'interno',
  TRANSFERENCIA: 'interno',
}

export const DIRECAO_GRUPOS: { direcao: Direcao; label: string }[] = [
  { direcao: 'entrada', label: 'Entradas' },
  { direcao: 'saida', label: 'Saídas' },
  { direcao: 'interno', label: 'Reclassificação / interno' },
]

export const DIRECAO_CLASSES: Record<Direcao, { bg: string; fg: string }> = {
  entrada: { bg: 'bg-brand-100', fg: 'text-brand-500' },
  saida: { bg: 'bg-warning-bg', fg: 'text-warning' },
  interno: { bg: 'bg-bg', fg: 'text-text-secondary' },
}

// símbolos por tipo — traço (viewBox 24, stroke 1.75), mesmo padrão de
// ícone já usado no resto do app. Cor/tamanho controlados pelo wrapper
// (o svg em si é sempre h-full w-full).
export function IconeMovimentacao({ tipo }: { tipo: TipoMovimentacao }) {
  const p = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-full w-full',
  }
  switch (tipo) {
    case 'NASCIMENTO':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'COMPRA':
      return (
        <svg {...p}>
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      )
    case 'VENDA_PE':
      return (
        <svg {...p}>
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path d="M7 9l5-5 5 5" />
          <path d="M12 4v11" />
        </svg>
      )
    case 'VENDA_ABATE':
      return (
        <svg {...p}>
          <path d="M12 3v18" />
          <path d="M16.5 8c0-1.9-1.8-3-4.5-3-3 0-4.8 1.4-4.8 3.2 0 1.9 1.8 2.7 4.8 3.3 3 .6 4.8 1.4 4.8 3.3 0 1.8-1.8 3.2-4.8 3.2-2.7 0-4.5-1.1-4.5-3" />
        </svg>
      )
    case 'MORTE':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      )
    case 'CONSUMO_DOACAO':
      return (
        <svg {...p}>
          <path d="M6 2v6a2 2 0 0 0 4 0V2" />
          <path d="M8 8v14" />
          <path d="M18 2v8c-1.7 0-3-1.8-3-4s1.3-4 3-4Z" />
          <path d="M18 8v14" />
        </svg>
      )
    case 'DESMAME':
      return (
        <svg {...p}>
          <path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z" />
          <path d="M4 4l16 16" />
        </svg>
      )
    case 'MUDANCA_CATEGORIA':
      return (
        <svg {...p}>
          <path d="M5 20V15M12 20V10M19 20V5" />
          <path d="M3 20h18" />
        </svg>
      )
    case 'TRANSFERENCIA':
      return (
        <svg {...p}>
          <path d="M4 7h11l-3-3M4 7l3 3" />
          <path d="M20 17H9l3 3M20 17l-3-3" />
        </svg>
      )
  }
}
