'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { MODULOS } from '@/lib/modulos'
import { ICONS } from '@/lib/nav-icons'
import AlterarSenhaModal from '@/components/AlterarSenhaModal'

// layout alternativo pro Modo Campo: barra superior fina (marca + sair)
// e uma barra de abas fixa embaixo com Painel + os módulos liberados —
// sem sidebar, pensado pra uso com o polegar no celular. As telas em si
// (formulários, listas) continuam as mesmas do Modo Gestão; só a
// navegação muda.
export default function ModoCampoShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { usuarioApp, podeAcessar, signOut } = useAuth()
  const [alterarSenhaAberto, setAlterarSenhaAberto] = useState(false)

  const abas = [
    { id: 'painel', label: 'Início', href: '/', icon: ICONS.painel },
    ...MODULOS.filter((m) => podeAcessar(m.id)),
  ]

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

      <main className="flex-1 pb-20">{children}</main>

      {alterarSenhaAberto && <AlterarSenhaModal onClose={() => setAlterarSenhaAberto(false)} />}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-border bg-surface">
        {abas.map((aba) => {
          const ativo = pathname === aba.href
          return (
            <Link
              key={aba.id}
              href={aba.href}
              className={`flex min-w-[72px] flex-1 flex-col items-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                ativo ? 'text-brand-500' : 'text-text-muted'
              }`}
            >
              {aba.icon}
              <span className="truncate">{aba.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
