// ícones de navegação compartilhados entre Sidebar (Modo Gestão) e
// ModoCampoShell (Modo Campo) — extraídos daqui pra não duplicar SVG
// entre os dois layouts de navegação
export function Icon({ children }: { children: React.ReactNode }) {
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

export const ICONS = {
  painel: (
    <Icon>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </Icon>
  ),
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
  pessoas: (
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
  lotacao: (
    <Icon>
      <path d="M4 18a8 8 0 0 1 16 0" />
      <path d="M12 18 15.5 11" />
      <path d="M12 18h.01" />
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
  collapse: (
    <Icon>
      <path d="M15 5l-7 7 7 7" />
      <path d="M9 5v14" />
    </Icon>
  ),
  expand: (
    <Icon>
      <path d="M9 5l7 7-7 7" />
      <path d="M15 5v14" />
    </Icon>
  ),
  acesso: (
    <Icon>
      <path d="M12 3 4 6.5v5c0 4.6 3.2 8.4 8 9.5 4.8-1.1 8-4.9 8-9.5v-5Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  suporte: (
    <Icon>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2" y="13" width="5" height="7" rx="1.5" />
      <rect x="17" y="13" width="5" height="7" rx="1.5" />
      <path d="M20 20v1a2 2 0 0 1-2 2h-3" />
    </Icon>
  ),
  sair: (
    <Icon>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  ),
  senha: (
    <Icon>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12 20 3" />
      <path d="M17 6l3 3" />
      <path d="M14 9l2.5 2.5" />
    </Icon>
  ),
}
