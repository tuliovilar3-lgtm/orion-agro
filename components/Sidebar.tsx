'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { label: string; href: string; icon: React.ReactNode }
type NavGroup = { label: string; items: NavItem[] }

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const ICONS = {
  fazendas: (
    <Icon>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-6h4v6" />
    </Icon>
  ),
  categorias: (
    <Icon>
      <path d="M11 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.59 1.41l-7 7a2 2 0 0 1-2.82 0l-6-6a2 2 0 0 1 0-2.82l7-7A2 2 0 0 1 11 3Z" />
      <circle cx="15.5" cy="8.5" r="1.1" />
    </Icon>
  ),
  clientes: (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M15.3 14.2c2.5.5 4.2 2.6 4.2 5.3" />
    </Icon>
  ),
  movimentacoes: (
    <Icon>
      <path d="M7 8h12m0 0-4-4m4 4-4 4" />
      <path d="M17 16H5m0 0 4-4m-4 4 4 4" />
    </Icon>
  ),
  saldoInicial: (
    <Icon>
      <path d="M6 3v18" />
      <path d="M6 4h12l-3 4 3 4H6" />
    </Icon>
  ),
  relatorio: (
    <Icon>
      <path d="M5 20v-6m6 6V8m6 12v-9" />
      <path d="M3 20h18" />
    </Icon>
  ),
  relatorios: (
    <Icon>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
    </Icon>
  ),
  areas: (
    <Icon>
      <path d="M4 4h16v16H4z" />
      <path d="M4 12h16" />
      <path d="M12 4v8" />
    </Icon>
  ),
  pesagens: (
    <Icon>
      <path d="M12 3v3" />
      <path d="M5 7h14l-1.5 4a6 6 0 0 1-11 0Z" />
      <circle cx="12" cy="17" r="4" />
    </Icon>
  ),
  rebanhoPorPasto: (
    <Icon>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </Icon>
  ),
  controlePasto: (
    <Icon>
      <rect x="3" y="9" width="7" height="7" rx="1" />
      <rect x="14" y="9" width="7" height="7" rx="1" />
      <path d="M10 12.5h4m0 0-2-2m2 2-2 2" />
    </Icon>
  ),
  financeiro: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v12" />
      <path d="M15 9.3c0-1.4-1.4-1.9-3-1.9s-3 .7-3 1.9 1.4 1.7 3 1.9 3 .7 3 1.9-1.4 1.9-3 1.9-3-.5-3-1.9" />
    </Icon>
  ),
  configuracoes: (
    <Icon>
      <path d="M4 6h16" />
      <circle cx="9" cy="6" r="2" />
      <path d="M4 12h16" />
      <circle cx="15" cy="12" r="2" />
      <path d="M4 18h16" />
      <circle cx="7" cy="18" r="2" />
    </Icon>
  ),
  menu: (
    <Icon>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  ),
  close: (
    <Icon>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  ),
}

const GROUPS: NavGroup[] = [
  {
    label: 'Gestão',
    items: [
      { label: 'Fazendas', href: '/fazendas', icon: ICONS.fazendas },
      { label: 'Categorias', href: '/categorias', icon: ICONS.categorias },
      { label: 'Clientes/Fornecedores', href: '/clientes-fornecedores', icon: ICONS.clientes },
    ],
  },
  {
    label: 'Movimentação',
    items: [
      { label: 'Movimentações', href: '/movimentacoes', icon: ICONS.movimentacoes },
      { label: 'Saldo inicial', href: '/saldo-inicial', icon: ICONS.saldoInicial },
      { label: 'Pesagens', href: '/pesagens', icon: ICONS.pesagens },
      { label: 'Relatório', href: '/relatorio-movimentacao', icon: ICONS.relatorio },
      { label: 'Relatórios por tipo', href: '/relatorios', icon: ICONS.relatorios },
    ],
  },
  {
    label: 'Pastejo',
    items: [
      { label: 'Controle de Pasto', href: '/controle-pasto', icon: ICONS.controlePasto },
      { label: 'Rebanho por pasto', href: '/relatorio-rebanho-por-pasto', icon: ICONS.rebanhoPorPasto },
    ],
  },
  {
    label: 'Áreas',
    items: [{ label: 'Gestão de áreas', href: '/gestao-areas', icon: ICONS.areas }],
  },
]

const PLACEHOLDERS: NavItem[] = [
  { label: 'Financeiro', href: '#', icon: ICONS.financeiro },
  { label: 'Configurações', href: '#', icon: ICONS.configuracoes },
]

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-r-control border-l-[3px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
                    active
                      ? 'border-brand-500 bg-white/8 text-white font-semibold'
                      : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}

      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-3">
        {PLACEHOLDERS.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] font-medium text-white/35"
          >
            {item.icon}
            {item.label}
            <span className="ml-auto text-[10px] font-normal text-white/30">em breve</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Sidebar() {
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

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-brand-900 md:flex">
        <div className="px-4 py-4">
          <span className="text-sm font-extrabold tracking-wide text-white">ORION AGRO</span>
        </div>
        <NavLinks pathname={pathname} />
      </aside>
    </>
  )
}
