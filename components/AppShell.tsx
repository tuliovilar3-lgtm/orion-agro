'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import ModoCampoShell from './campo/ModoCampoShell'
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
  const { usuarioApp } = useAuth()

  if (usuarioApp?.modo === 'CAMPO') {
    return <ModoCampoShell>{children}</ModoCampoShell>
  }

  return (
    <>
      <Sidebar collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <div
        className={`flex min-h-full flex-col transition-[padding-left] duration-150 ${
          collapsed ? 'md:pl-16' : 'md:pl-60'
        }`}
      >
        <main className="flex-1">{children}</main>
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

  // /login não usa a sidebar nem o filtro global — é a única tela
  // acessível sem sessão, então não faz sentido montar navegação nem
  // buscar fazendas ali
  if (pathname === '/login') {
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
