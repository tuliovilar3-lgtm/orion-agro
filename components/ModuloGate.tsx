'use client'

import { useAuth } from '@/contexts/AuthContext'
import type { ModuloId } from '@/lib/modulos'

// guarda de acesso por página — some com o conteúdo (não só o link da
// Sidebar) quando o usuário logado não tem o módulo liberado. Checagem
// client-side, consistente com o resto do app (100% client components,
// sem RLS ainda) — não é a linha de defesa final, só evita que um
// funcionário sem permissão veja a tela abrindo uma URL direta. RLS
// reativado é o passo que fecha essa lacuna de verdade (ver memória
// deployment_roadmap).
export default function ModuloGate({ modulo, children }: { modulo: ModuloId; children: React.ReactNode }) {
  const { loading, podeAcessar, usuarioApp, emModoSuporte } = useAuth()

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <div className="h-40 animate-pulse rounded-card bg-border" />
      </div>
    )
  }

  if (!podeAcessar(modulo)) {
    // suporte "em casa" (não entrou em nenhuma conta ainda) barrado por
    // essa trava específica, não por falta de módulo comprado/liberado
    // — "fale com o administrador" não faz sentido pro próprio
    // administrador, então a mensagem muda pra apontar o caminho certo
    const suporteEmCasa = usuarioApp?.suporte && !emModoSuporte
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Acesso restrito</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            {suporteEmCasa
              ? 'Entre em uma conta pela tela de Suporte pra acessar este módulo.'
              : 'Você não tem permissão para acessar este módulo. Fale com o administrador do sistema se precisar dele.'}
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
