'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import ModoCampoShell from './campo/ModoCampoShell'
import SuporteBanner from './SuporteBanner'
import SuporteShell from './suporte/SuporteShell'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { FiltroGlobalProvider } from '@/contexts/FiltroGlobalContext'

const COLLAPSE_STORAGE_KEY = 'orion.sidebarColapsada'

// escolhe o layout de navegação depois que o usuário carrega — fica
// dentro do AuthProvider (só ele sabe usuarioApp.modo), diferente de
// AppShell, que precisa decidir ANTES se monta o AuthProvider (rota
// /login não usa nenhum dos dois)
function LayoutPorModo({
  children,
  collapsed,
  onToggleCollapsed,
}: {
  children: React.ReactNode
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const { usuarioApp, emModoSuporte } = useAuth()

  if (usuarioApp?.suporte && !emModoSuporte) {
    return <SuporteShell>{children}</SuporteShell>
  }

  if (usuarioApp?.modo === 'CAMPO') {
    // ModoCampoShell tem barra superior fixa em qualquer tamanho de tela
    // (diferente da Sidebar, que só tem topbar no mobile) — o banner
    // sempre gruda em top-14 (56px, altura da barra), nunca top-0
    return (
      <ModoCampoShell>
        <SuporteBanner className="sticky top-14" />
        {children}
      </ModoCampoShell>
    )
  }

  return (
    <>
      <Sidebar collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <div
        className={`flex min-h-full flex-col transition-[padding-left] duration-150 ${
          collapsed ? 'md:pl-16' : 'md:pl-60'
        }`}
      >
        <main className="flex-1">
          {/* mobile tem a topbar fixa da Sidebar (top-14 gruda embaixo
          dela); desktop não tem topbar nenhuma ali, então top-0 */}
          <SuporteBanner className="sticky top-14 md:top-0" />
          {children}
        </main>
      </div>
    </>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  // lido só depois de montar, pra não divergir do HTML renderizado no
  // servidor (evita mismatch de hidratação)
  useEffect(() => {
    if (window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1') setCollapsed(true)
  }, [])

  function alternarColapso() {
    setCollapsed((atual) => {
      const novo = !atual
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, novo ? '1' : '0')
      return novo
    })
  }

  // /login e /redefinir-senha não usam a sidebar nem o filtro global —
  // são as únicas telas acessíveis sem uma sessão "de verdade" (a
  // segunda usa uma sessão de recuperação, só serve pra trocar a
  // senha), então não faz sentido montar navegação nem buscar fazendas
  // ali
  if (pathname === '/login' || pathname === '/redefinir-senha') {
    return <AuthProvider>{children}</AuthProvider>
  }

  return (
    <AuthProvider>
      <FiltroGlobalProvider>
        <LayoutPorModo collapsed={collapsed} onToggleCollapsed={alternarColapso}>
          {children}
        </LayoutPorModo>
      </FiltroGlobalProvider>
    </AuthProvider>
  )
}
