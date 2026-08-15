'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import type { ModuloId } from '@/lib/modulos'
import { ICONS } from '@/lib/nav-icons'

type NavItem = { label: string; href: string; icon: React.ReactNode; modulo?: ModuloId }
type NavGroup = { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: 'Gerenciamento',
    items: [
      { label: 'Fazendas', href: '/fazendas', icon: ICONS.fazendas, modulo: 'fazendas' },
      { label: 'Categorias', href: '/categorias', icon: ICONS.categorias, modulo: 'categorias' },
      { label: 'Pessoas e Empresas', href: '/pessoas', icon: ICONS.pessoas, modulo: 'pessoas' },
    ],
  },
  {
    label: 'Rebanho',
    items: [
      {
        label: 'Lançamento de Movimentações',
        href: '/movimentacoes',
        icon: ICONS.movimentacoes,
        modulo: 'movimentacoes',
      },
      { label: 'Pesagens', href: '/pesagens', icon: ICONS.pesagens, modulo: 'pesagens' },
      {
        label: 'Resumo de Movimentação de Rebanho',
        href: '/relatorio-movimentacao',
        icon: ICONS.relatorio,
        modulo: 'resumo_movimentacao',
      },
      {
        label: 'Relatórios de Movimentações',
        href: '/relatorios',
        icon: ICONS.relatorios,
        modulo: 'relatorios_movimentacoes',
      },
      {
        label: 'Relatório de Lotação',
        href: '/relatorio-lotacao',
        icon: ICONS.lotacao,
        modulo: 'relatorio_lotacao',
      },
    ],
  },
  {
    label: 'Controle de Pasto',
    items: [
      { label: 'Mudança de Pasto', href: '/controle-pasto', icon: ICONS.controlePasto, modulo: 'mudanca_pasto' },
      {
        label: 'Rebanho por pasto',
        href: '/relatorio-rebanho-por-pasto',
        icon: ICONS.rebanhoPorPasto,
        modulo: 'rebanho_por_pasto',
      },
    ],
  },
]

const PAINEL: NavItem = { label: 'Painel', href: '/', icon: ICONS.painel }
const USUARIOS: NavItem = { label: 'Usuários', href: '/usuarios', icon: ICONS.acesso }

const PLACEHOLDERS: NavItem[] = [
  { label: 'Financeiro', href: '#', icon: ICONS.financeiro },
  { label: 'Configurações', href: '#', icon: ICONS.configuracoes },
]

function NavLinks({
  pathname,
  onNavigate,
  collapsed = false,
}: {
  pathname: string
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { usuarioApp, isDono, podeAcessar, signOut } = useAuth()

  // grupos filtrados pelos módulos liberados pro usuário logado — dono
  // vê tudo (podeAcessar sempre true pra ele); grupo some inteiro se
  // nenhum item dele sobrar
  const gruposVisiveis = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.modulo || podeAcessar(item.modulo)),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 py-4">
      <div className="flex flex-col gap-0.5">
        <Link
          href={PAINEL.href}
          onClick={onNavigate}
          title={collapsed ? PAINEL.label : undefined}
          className={`flex items-center gap-2.5 rounded-r-control border-l-[3px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
            pathname === PAINEL.href
              ? 'border-brand-500 bg-white/8 text-white font-semibold'
              : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
          }`}
        >
          {PAINEL.icon}
          {!collapsed && PAINEL.label}
        </Link>
      </div>

      {gruposVisiveis.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              {group.label}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-2.5 rounded-r-control border-l-[3px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
                    active
                      ? 'border-brand-500 bg-white/8 text-white font-semibold'
                      : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {!collapsed && item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}

      {isDono && (
        <div>
          {!collapsed && (
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              Administração
            </div>
          )}
          <Link
            href={USUARIOS.href}
            onClick={onNavigate}
            title={collapsed ? USUARIOS.label : undefined}
            className={`flex items-center gap-2.5 rounded-r-control border-l-[3px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
              pathname === USUARIOS.href
                ? 'border-brand-500 bg-white/8 text-white font-semibold'
                : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
            }`}
          >
            {USUARIOS.icon}
            {!collapsed && USUARIOS.label}
          </Link>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-3">
        {PLACEHOLDERS.map((item) => (
          <div
            key={item.label}
            title={collapsed ? item.label : undefined}
            className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] font-medium text-white/35"
          >
            {item.icon}
            {!collapsed && (
              <>
                {item.label}
                <span className="ml-auto text-[10px] font-normal text-white/30">em breve</span>
              </>
            )}
          </div>
        ))}

        {usuarioApp && (
          <div className={`mt-2 flex items-center gap-2.5 border-t border-white/10 px-2.5 pt-3 ${collapsed ? 'flex-col' : ''}`}>
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/70" title={usuarioApp.nome}>
                {usuarioApp.nome}
              </span>
            )}
            <button
              type="button"
              onClick={signOut}
              title="Sair"
              aria-label="Sair"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white/50 hover:bg-white/10 hover:text-white"
            >
              {ICONS.sair}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapsed,
}: {
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-brand-900 px-4 py-3 md:hidden">
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setOpen(true)}
          className="text-white"
        >
          {ICONS.menu}
        </button>
        <span className="text-sm font-extrabold tracking-wide text-white">ORION AGRO</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-64 flex-col bg-brand-900">
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="text-sm font-extrabold tracking-wide text-white">ORION AGRO</span>
              <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="text-white/70">
                {ICONS.close}
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col bg-brand-900 transition-[width] duration-150 md:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          {!collapsed && <span className="text-sm font-extrabold tracking-wide text-white">ORION AGRO</span>}
          <button
            type="button"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            onClick={onToggleCollapsed}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white/60 hover:bg-white/10 hover:text-white ${
              collapsed ? 'mx-auto' : ''
            }`}
          >
            {collapsed ? ICONS.expand : ICONS.collapse}
          </button>
        </div>
        <NavLinks pathname={pathname} collapsed={collapsed} />
      </aside>
    </>
  )
}
