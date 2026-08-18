import { ICONS } from '@/lib/nav-icons'

// catálogo de módulos de DOMÍNIO (migração 050) — o que uma conta
// contrata no nível mais alto (conta_modulos.dominio). Só "pecuaria"
// tem telas reais hoje; os demais ficam reservados pro catálogo já
// existir quando forem construídos, mesmo princípio já usado em
// tipo_utilizacao_modulo reservando 'AGRICULTURA' antes de existir
// talhão.
export type DominioId = 'pecuaria' | 'agricultura' | 'maquinas' | 'clima' | 'financeiro'

export const DOMINIOS: { id: DominioId; label: string }[] = [
  { id: 'pecuaria', label: 'Pecuária' },
  { id: 'agricultura', label: 'Agricultura' },
  { id: 'maquinas', label: 'Máquinas' },
  { id: 'clima', label: 'Clima' },
  { id: 'financeiro', label: 'Financeiro' },
]

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

type Modulo = {
  id: ModuloId
  dominio: DominioId
  label: string
  href: string
  icon: React.ReactNode
  somenteLeitura?: boolean
}

export const MODULOS: Modulo[] = [
  { id: 'fazendas', dominio: 'pecuaria', label: 'Fazendas', href: '/fazendas', icon: ICONS.fazendas },
  { id: 'categorias', dominio: 'pecuaria', label: 'Categorias', href: '/categorias', icon: ICONS.categorias },
  { id: 'pessoas', dominio: 'pecuaria', label: 'Pessoas e Empresas', href: '/pessoas', icon: ICONS.pessoas },
  {
    id: 'movimentacoes',
    dominio: 'pecuaria',
    label: 'Lançamento de Movimentações',
    href: '/movimentacoes',
    icon: ICONS.movimentacoes,
  },
  { id: 'pesagens', dominio: 'pecuaria', label: 'Pesagens', href: '/pesagens', icon: ICONS.pesagens },
  {
    id: 'resumo_movimentacao',
    dominio: 'pecuaria',
    label: 'Resumo de Movimentação de Rebanho',
    href: '/relatorio-movimentacao',
    icon: ICONS.relatorio,
    somenteLeitura: true,
  },
  {
    id: 'relatorios_movimentacoes',
    dominio: 'pecuaria',
    label: 'Relatórios de Movimentações',
    href: '/relatorios',
    icon: ICONS.relatorios,
    somenteLeitura: true,
  },
  {
    id: 'relatorio_lotacao',
    dominio: 'pecuaria',
    label: 'Relatório de Lotação',
    href: '/relatorio-lotacao',
    icon: ICONS.lotacao,
    somenteLeitura: true,
  },
  {
    id: 'mudanca_pasto',
    dominio: 'pecuaria',
    label: 'Mudança de Pasto',
    href: '/controle-pasto',
    icon: ICONS.controlePasto,
  },
  {
    id: 'rebanho_por_pasto',
    dominio: 'pecuaria',
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
