import type { DominioId } from '@/lib/modulos'

// catálogo de recursos vendidos avulsos por dentro de um domínio já
// contratado (migração 050) — flags independentes, combináveis
// livremente, por cima do básico do domínio (ex.: "controle por pasto"
// dentro de Pecuária). Diferente de conta_limites (que é numérico),
// aqui é só liga/desliga.
//
// Sem helper de leitura em runtime: nenhuma tela lê conta_recursos
// diretamente hoje — 'controle_pasto' só alimenta
// configuracoes.controla_pasto no momento em que é concedido (ver
// app/api/contas/route.ts), e configuracoes.controla_pasto continua
// sendo o que todo o resto do app já lê. Esta lista existe só pra
// onboarding (CadastrarContaModal) saber o que oferecer.
export type RecursoId = 'controle_pasto'

export const RECURSOS: { id: RecursoId; dominio: DominioId; label: string }[] = [
  { id: 'controle_pasto', dominio: 'pecuaria', label: 'Controle por pasto' },
]
