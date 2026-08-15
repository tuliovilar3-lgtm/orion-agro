'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { MODULOS } from '@/lib/modulos'

// home simplificada do Modo Campo — no lugar do Painel completo (KPIs,
// gráficos), mostra só botões grandes pros módulos que a pessoa tem
// liberado, pensado pra uso rápido no celular no meio do trabalho.
// Módulos com maior interação (lançamento) aparecem primeiro.
const ORDEM_PRIORIDADE = ['movimentacoes', 'pesagens', 'mudanca_pasto'] as const

export default function InicioCampo() {
  const { usuarioApp, modulosPermitidos } = useAuth()

  const modulosOrdenados = [...MODULOS]
    .filter((m) => modulosPermitidos.has(m.id))
    .sort((a, b) => {
      const pa = ORDEM_PRIORIDADE.indexOf(a.id as (typeof ORDEM_PRIORIDADE)[number])
      const pb = ORDEM_PRIORIDADE.indexOf(b.id as (typeof ORDEM_PRIORIDADE)[number])
      if (pa === -1 && pb === -1) return 0
      if (pa === -1) return 1
      if (pb === -1) return -1
      return pa - pb
    })

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <p className="text-sm text-text-secondary">Olá,</p>
      <h1 className="text-xl font-extrabold text-text-primary">{usuarioApp?.nome || 'bem-vindo'}</h1>

      {modulosOrdenados.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Nenhum módulo liberado</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Fale com o administrador do sistema pra liberar acesso a alguma tela.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {modulosOrdenados.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className="flex items-center gap-3 rounded-card border border-brand-100 bg-brand-100 px-4 py-4 text-brand-700 transition-colors active:bg-brand-100/70"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                {m.icon}
              </span>
              <span className="text-base font-semibold">{m.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
