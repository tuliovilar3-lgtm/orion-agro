import { ICONS } from '@/lib/nav-icons'

// catálogo de módulos pra permissão por usuário (migração 042) — cada id
// corresponde a uma rota da Sidebar. O Painel (`/`) fica de fora de
// propósito: é só uma visão geral somente-leitura, sempre acessível a
// qualquer usuário logado, dono ou funcionário — sem isso, um
// funcionário sem nenhum módulo liberado não teria pra onde ir depois
// de entrar.
export type ModuloId =
  | 'fazendas'
  | 'categorias'
  | 'pessoas'
  | 'movimentacoes'
  | 'pesagens'
  | 'resumo_movimentacao'
  | 'relatorios_movimentacoes'
  | 'relatorio_lotacao'
  | 'mudanca_pasto'
  | 'rebanho_por_pasto'

type Modulo = { id: ModuloId; label: string; href: string; icon: React.ReactNode; somenteLeitura?: boolean }

export const MODULOS: Modulo[] = [
  { id: 'fazendas', label: 'Fazendas', href: '/fazendas', icon: ICONS.fazendas },
  { id: 'categorias', label: 'Categorias', href: '/categorias', icon: ICONS.categorias },
  { id: 'pessoas', label: 'Pessoas e Empresas', href: '/pessoas', icon: ICONS.pessoas },
  { id: 'movimentacoes', label: 'Lançamento de Movimentações', href: '/movimentacoes', icon: ICONS.movimentacoes },
  { id: 'pesagens', label: 'Pesagens', href: '/pesagens', icon: ICONS.pesagens },
  {
    id: 'resumo_movimentacao',
    label: 'Resumo de Movimentação de Rebanho',
    href: '/relatorio-movimentacao',
    icon: ICONS.relatorio,
    somenteLeitura: true,
  },
  {
    id: 'relatorios_movimentacoes',
    label: 'Relatórios de Movimentações',
    href: '/relatorios',
    icon: ICONS.relatorios,
    somenteLeitura: true,
  },
  {
    id: 'relatorio_lotacao',
    label: 'Relatório de Lotação',
    href: '/relatorio-lotacao',
    icon: ICONS.lotacao,
    somenteLeitura: true,
  },
  { id: 'mudanca_pasto', label: 'Mudança de Pasto', href: '/controle-pasto', icon: ICONS.controlePasto },
  {
    id: 'rebanho_por_pasto',
    label: 'Rebanho por pasto',
    href: '/relatorio-rebanho-por-pasto',
    icon: ICONS.rebanhoPorPasto,
    somenteLeitura: true,
  },
]

// módulos que o Modo Consulta pode liberar — os únicos 4 que já são
// 100% somente-leitura hoje (nenhum tem botão de salvar/editar/criar).
// Não é um bloqueio novo de "somente leitura" dentro das telas: é só
// uma curadoria de quais módulos fazem sentido pra esse modo, no
// mesmo mecanismo de permissão por módulo já existente.
export const MODULOS_CONSULTA: ModuloId[] = MODULOS.filter((m) => m.somenteLeitura).map((m) => m.id)
