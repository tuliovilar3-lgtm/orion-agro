'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

type Conta = { id: string; nome: string; ativo: boolean }

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
  )
}

export default function SuportePage() {
  const { usuarioApp, contaSuporteAtiva, entrarNaConta, sairDoSuporte, loading: loadingAuth } = useAuth()
  const supabase = createClient()

  const [contas, setContas] = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [entrandoId, setEntrandoId] = useState<string | null>(null)
  const [saindo, setSaindo] = useState(false)

  useEffect(() => {
    if (loadingAuth) return
    if (!usuarioApp?.suporte) {
      setLoading(false)
      return
    }
    supabase
      .from('contas')
      .select('id, nome, ativo')
      .order('nome')
      .then(({ data }) => {
        setContas((data || []) as Conta[])
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingAuth, usuarioApp?.suporte])

  async function handleEntrar(contaId: string) {
    setEntrandoId(contaId)
    await entrarNaConta(contaId)
  }

  async function handleSair() {
    setSaindo(true)
    await sairDoSuporte()
  }

  if (loadingAuth || (loading && usuarioApp?.suporte)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8 md:px-10">
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (!usuarioApp?.suporte) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Acesso restrito</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Só a equipe de suporte pode acessar esta tela.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Suporte</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Escolha uma conta pra navegar o sistema com os dados dela. Toda entrada fica registrada em log de
        auditoria.
      </p>

      {contaSuporteAtiva && (
        <div className="mt-6 rounded-card border border-warning bg-warning-bg p-5">
          <p className="text-sm text-text-primary">
            Você está navegando na conta <span className="font-semibold">{contaSuporteAtiva.nome}</span> agora.
          </p>
          <button
            type="button"
            disabled={saindo}
            onClick={handleSair}
            className="mt-3 rounded-control border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg disabled:opacity-60"
          >
            {saindo ? 'Saindo...' : 'Sair dessa conta'}
          </button>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {contas.map((c) => {
          const ativa = c.id === contaSuporteAtiva?.id
          return (
            <div
              key={c.id}
              className={`flex items-center justify-between rounded-card border p-5 ${
                ativa ? 'border-brand-500 bg-brand-100' : 'border-border bg-surface'
              }`}
            >
              <div>
                <span className="font-semibold text-text-primary">{c.nome}</span>
                {!c.ativo && (
                  <span className="ml-2 rounded-control bg-error-bg px-2 py-0.5 text-xs font-semibold text-error">
                    Inativa
                  </span>
                )}
              </div>
              {ativa ? (
                <span className="text-xs font-semibold text-brand-700">Navegando agora</span>
              ) : (
                <button
                  type="button"
                  disabled={entrandoId === c.id}
                  onClick={() => handleEntrar(c.id)}
                  className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
                >
                  {entrandoId === c.id ? 'Entrando...' : 'Entrar'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
