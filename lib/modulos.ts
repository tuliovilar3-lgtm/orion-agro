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

export const MODULOS: { id: ModuloId; label: string; href: string }[] = [
  { id: 'fazendas', label: 'Fazendas', href: '/fazendas' },
  { id: 'categorias', label: 'Categorias', href: '/categorias' },
  { id: 'pessoas', label: 'Pessoas e Empresas', href: '/pessoas' },
  { id: 'movimentacoes', label: 'Lançamento de Movimentações', href: '/movimentacoes' },
  { id: 'pesagens', label: 'Pesagens', href: '/pesagens' },
  { id: 'resumo_movimentacao', label: 'Resumo de Movimentação de Rebanho', href: '/relatorio-movimentacao' },
  { id: 'relatorios_movimentacoes', label: 'Relatórios de Movimentações', href: '/relatorios' },
  { id: 'relatorio_lotacao', label: 'Relatório de Lotação', href: '/relatorio-lotacao' },
  { id: 'mudanca_pasto', label: 'Mudança de Pasto', href: '/controle-pasto' },
  { id: 'rebanho_por_pasto', label: 'Rebanho por pasto', href: '/relatorio-rebanho-por-pasto' },
]
