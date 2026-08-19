'use client'

import { useEffect, useRef, useState } from 'react'
import Required from '@/components/Required'

// filtro de linha única (Fazendas, Categoria, Proprietário) que abre um
// popover de checkboxes pra marcar/desmarcar, em vez de uma lista sempre
// expandida — extraído de app/relatorios/page.tsx pra ser reaproveitado
// também em Resumo de Movimentação de Rebanho e Relatório de Lotação
// (mesmo princípio de extração já usado em lib/nav-icons.tsx e
// lib/movimentacao-icones.tsx). Útil sobretudo pra contas com muitas
// fazendas/proprietários, onde uma lista sempre aberta tomaria a tela.
export default function FiltroMultiSelect({
  label,
  required,
  itens,
  selecionados,
  onToggleItem,
  onToggleTodos,
  todosSelecionados,
  vazioLabel,
  // "Marcar/Desmarcar todas" (fazendas, categorias) por padrão;
  // masculino (proprietários) quando true — mesmo cuidado de concordância
  // já usado no mockup aprovado
  pluralMasculino,
}: {
  label: string
  required?: boolean
  itens: { id: string; nome: string }[]
  selecionados: string[]
  onToggleItem: (id: string) => void
  onToggleTodos: () => void
  todosSelecionados: boolean
  vazioLabel?: string
  pluralMasculino?: boolean
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

  const todasOuTodos = pluralMasculino ? 'todos' : 'todas'
  const umaOuUm = pluralMasculino ? 'selecionado' : 'selecionada'

  const resumo =
    itens.length === 0
      ? vazioLabel || 'Nenhuma opção'
      : todosSelecionados
        ? `${pluralMasculino ? 'Todos' : 'Todas'} (${itens.length})`
        : selecionados.length === 0
          ? `Nenhum${pluralMasculino ? '' : 'a'} ${umaOuUm}`
          : `${selecionados.length} de ${itens.length} ${umaOuUm}${selecionados.length > 1 ? 's' : ''}`

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">
        {label}
        {required && <Required />}
      </label>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-56 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2 text-left text-sm text-text-primary outline-none focus:border-brand-500"
      >
        <span className="truncate">{resumo}</span>
        <span className="text-text-muted">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-64 rounded-control border border-border bg-surface p-2 shadow-lg">
          <div className="mb-1.5 flex items-center justify-between border-b border-border pb-1.5">
            <span className="text-xs text-text-muted">
              {selecionados.length} de {itens.length}
            </span>
            <button type="button" className="text-xs font-medium text-brand-500 underline" onClick={onToggleTodos}>
              {todosSelecionados ? `Desmarcar ${todasOuTodos}` : `Marcar ${todasOuTodos}`}
            </button>
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {itens.length === 0 ? (
              <p className="px-1 py-1 text-xs text-text-muted">{vazioLabel || 'Nenhuma opção cadastrada.'}</p>
            ) : (
              itens.map((it) => (
                <label
                  key={it.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm text-text-primary hover:bg-bg"
                >
                  <input type="checkbox" checked={selecionados.includes(it.id)} onChange={() => onToggleItem(it.id)} />
                  {it.nome}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
