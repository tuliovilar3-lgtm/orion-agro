'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import type { ModuloId } from '@/lib/modulos'
import { ICONS } from '@/lib/nav-icons'
import AlterarSenhaModal from '@/components/AlterarSenhaModal'

type NavItem = { label: string; href: string; icon: React.ReactNode; modulo?: ModuloId }
type NavGroup = { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: 'Gerenciamento',
    items: [
      { label: 'Fazendas', href: '/fazendas', icon: ICONS.fazendas, modulo: 'fazendas' },
      { label: 'Categorias', href: '/categorias', icon: ICONS.categorias, modulo: 'categorias' },
      { label: 'Causas de Morte', href: '/causas-morte', icon: ICONS.causasMorte, modulo: 'causas_morte' },
      { label: 'Pessoas e Empresas', href: '/pessoas', icon: ICONS.pessoas, modulo: 'pessoas' },
      {
        label: 'Produtos e Serviços',
        href: '/produtos-servicos',
        icon: ICONS.produtosServicos,
        modulo: 'produtos_servicos',
      },
      {
        label: 'Contas Bancárias',
        href: '/contas-bancarias',
        icon: ICONS.contasBancarias,
        modulo: 'contas_bancarias',
      },
      {
        label: 'Atividades Econômicas',
        href: '/atividades-economicas',
        icon: ICONS.atividadesEconomicas,
        modulo: 'atividades_economicas',
      },
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
      { label: 'Mudança de Pasto', href: '/controle-pasto', icon: ICONS.controlePasto, modulo: 'mudanca_pasto' },
      {
        label: 'Rebanho por pasto',
        href: '/relatorio-rebanho-por-pasto',
        icon: ICONS.rebanhoPorPasto,
        modulo: 'rebanho_por_pasto',
      },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      {
        label: 'Lançamentos Financeiros',
        href: '/financeiro',
        icon: ICONS.financeiro,
        modulo: 'lancamentos_financeiros',
      },
      {
        label: 'Plano de Contas',
        href: '/plano-contas',
        icon: ICONS.planoContas,
        modulo: 'plano_contas_financeiro',
      },
      {
        label: 'Contas a Pagar/Receber',
        href: '/contas-a-pagar-receber',
        icon: ICONS.contasPagarReceber,
        modulo: 'contas_pagar_receber',
      },
      {
        label: 'Relatórios Financeiros',
        href: '/relatorios-financeiros',
        icon: ICONS.relatoriosFinanceiros,
        modulo: 'relatorios_financeiros',
      },
    ],
  },
]

const PAINEL: NavItem = { label: 'Painel', href: '/', icon: ICONS.painel }
const USUARIOS: NavItem = { label: 'Usuários', href: '/usuarios', icon: ICONS.acesso }
const MODULOS_LINK: NavItem = { label: 'Módulos', href: '/modulos', icon: ICONS.modulos }

const PLACEHOLDERS: NavItem[] = [{ label: 'Configurações', href: '#', icon: ICONS.configuracoes }]

const GRUPOS_ABERTOS_STORAGE_KEY = 'orion.sidebarGruposAbertos'

function grupoDoPathname(pathname: string): string | null {
  const grupo = GROUPS.find((g) => g.items.some((item) => item.href === pathname))
  return grupo?.label ?? null
}

function ChevronGrupo({ aberto }: { aberto: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 ${aberto ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

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
  const [alterarSenhaAberto, setAlterarSenhaAberto] = useState(false)

  // acordeão por grupo — recolhido por padrão, exceto o grupo da página
  // ativa; estado persistido em localStorage (mesmo padrão já usado pro
  // collapse geral da sidebar). Carregado só depois de montar (evita
  // mismatch de hidratação) e sempre garante que o grupo ativo esteja
  // aberto, mesmo se o usuário chegou nessa página por um link fora da
  // sidebar (sem sobrescrever grupos que o usuário já abriu à mão).
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({})
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    let salvo: Record<string, boolean> = {}
    try {
      const raw = localStorage.getItem(GRUPOS_ABERTOS_STORAGE_KEY)
      if (raw) salvo = JSON.parse(raw)
    } catch {}
    const grupoAtivo = grupoDoPathname(pathname)
    if (grupoAtivo && !salvo[grupoAtivo]) salvo = { ...salvo, [grupoAtivo]: true }
    setGruposAbertos(salvo)
    setCarregado(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!carregado) return
    const grupoAtivo = grupoDoPathname(pathname)
    if (grupoAtivo) {
      setGruposAbertos((prev) => (prev[grupoAtivo] ? prev : { ...prev, [grupoAtivo]: true }))
    }
  }, [pathname, carregado])

  useEffect(() => {
    if (!carregado) return
    try {
      localStorage.setItem(GRUPOS_ABERTOS_STORAGE_KEY, JSON.stringify(gruposAbertos))
    } catch {}
  }, [gruposAbertos, carregado])

  function alternarGrupo(label: string) {
    setGruposAbertos((prev) => ({ ...prev, [label]: !prev[label] }))
  }

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

      {gruposVisiveis.map((group) => {
        const aberto = collapsed || !!gruposAbertos[group.label]
        return (
          <div key={group.label}>
            {!collapsed && (
              <button
                type="button"
                onClick={() => alternarGrupo(group.label)}
                className="flex w-full items-center justify-between px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/70"
                aria-expanded={aberto}
              >
                {group.label}
                <ChevronGrupo aberto={aberto} />
              </button>
            )}
            {aberto && (
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
            )}
          </div>
        )
      })}

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
          <Link
            href={MODULOS_LINK.href}
            onClick={onNavigate}
            title={collapsed ? MODULOS_LINK.label : undefined}
            className={`flex items-center gap-2.5 rounded-r-control border-l-[3px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
              pathname === MODULOS_LINK.href
                ? 'border-brand-500 bg-white/8 text-white font-semibold'
                : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
            }`}
          >
            {MODULOS_LINK.icon}
            {!collapsed && MODULOS_LINK.label}
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
              onClick={() => setAlterarSenhaAberto(true)}
              title="Alterar senha"
              aria-label="Alterar senha"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white/50 hover:bg-white/10 hover:text-white"
            >
              {ICONS.senha}
            </button>
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

      {alterarSenhaAberto && <AlterarSenhaModal onClose={() => setAlterarSenhaAberto(false)} />}
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
