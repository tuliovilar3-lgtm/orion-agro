'use client'

import { useState } from 'react'

// título da página + botão de filtro recolhível — os dois sempre visíveis
// ao rolar (sticky), pedido do usuário pra não perder de vista o nome do
// relatório nem o acesso ao filtro numa tela cheia de dados. O painel de
// filtro em si (os campos passados como children) fica escondido por
// padrão — só ocupa espaço quando o usuário pede — e continua colado no
// topo enquanto aberto, pra não se perder dele rolando a página pra
// comparar com a tabela/gráfico abaixo.
//
// Reaproveitado em Resumo de Movimentação de Rebanho, Relatórios de
// Movimentações e Relatório de Lotação — as três telas que usam esse
// mesmo formato de cabeçalho + filtro por período (Painel e Rebanho por
// pasto ficam de fora: são fotografias de hoje, sem filtro de período).
export default function PainelFiltroColapsavel({
  titulo,
  resumoFiltro,
  abaixoTitulo,
  children,
}: {
  titulo: string
  resumoFiltro: string
  // conteúdo sempre visível (não colapsa), renderizado entre o título e o
  // painel de filtro — hoje só usado pela barra de abas de tipo em
  // Relatórios de Movimentações, que já era sticky antes desta mudança
  abaixoTitulo?: React.ReactNode
  children: React.ReactNode
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="sticky top-14 z-30 border-b border-border bg-bg pb-4 md:top-0">
      <div className="flex flex-wrap items-center justify-between gap-4 py-4">
        <h1 className="text-2xl font-extrabold text-text-primary">{titulo}</h1>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className={`flex max-w-full items-center gap-2.5 rounded-control border bg-surface px-3.5 py-2 text-sm transition-colors ${
            aberto ? 'border-brand-500' : 'border-border hover:border-brand-500'
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-none text-brand-500"
          >
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <span className="truncate font-medium text-text-secondary">{resumoFiltro}</span>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`flex-none text-text-muted transition-transform ${aberto ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {abaixoTitulo}
      {aberto && (
        <div className="flex flex-wrap gap-6 pb-5">{children}</div>
      )}
    </div>
  )
}
