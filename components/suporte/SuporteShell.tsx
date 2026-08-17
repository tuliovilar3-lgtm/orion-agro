'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { ICONS } from '@/lib/nav-icons'
import AlterarSenhaModal from '@/components/AlterarSenhaModal'

// layout de navegação pra quem tem usuarios_app.suporte = true e ainda
// não "entrou" em nenhuma conta — sem sidebar, sem grupos de módulo
// (não há módulo nenhum pra navegar nesse estado, só a home de
// Suporte). Mesmo estilo de barra superior fina já usado no topo do
// ModoCampoShell, sem a barra de abas inferior (essa é específica de
// navegação por módulo de uma conta).
export default function SuporteShell({ children }: { children: React.ReactNode }) {
  const { usuarioApp, signOut } = useAuth()
  const [alterarSenhaAberto, setAlterarSenhaAberto] = useState(false)

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-brand-900 px-4 py-3">
        <span className="text-sm font-extrabold tracking-wide text-white">ORION AGRO</span>
        <div className="flex items-center gap-2">
          <span className="max-w-[140px] truncate text-xs text-white/70">{usuarioApp?.nome}</span>
          <button
            type="button"
            onClick={() => setAlterarSenhaAberto(true)}
            title="Alterar senha"
            aria-label="Alterar senha"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white/60 hover:bg-white/10 hover:text-white"
          >
            {ICONS.senha}
          </button>
          <button
            type="button"
            onClick={signOut}
            title="Sair"
            aria-label="Sair"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white/60 hover:bg-white/10 hover:text-white"
          >
            {ICONS.sair}
          </button>
        </div>
      </div>

      <main className="flex-1">{children}</main>

      {alterarSenhaAberto && <AlterarSenhaModal onClose={() => setAlterarSenhaAberto(false)} />}
    </div>
  )
}
