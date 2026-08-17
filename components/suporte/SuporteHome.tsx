'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

type Conta = { id: string; nome: string; ativo: boolean }

// abas da home de Suporte — hoje só "Contas"; indicadores técnicos por
// conta entram aqui depois, como aba nova, sem mexer no resto
const ABAS = [{ id: 'contas', label: 'Contas' }] as const
type AbaId = (typeof ABAS)[number]['id']

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
  )
}

// home de quem tem usuarios_app.suporte = true e não "entrou" em
// nenhuma conta ainda — renderizada por app/page.tsx no lugar do
// PainelDashboard, nunca mostra dado de nenhuma conta de cliente
export default function SuporteHome() {
  const { contaSuporteAtiva, entrarNaConta } = useAuth()
  const supabase = createClient()

  const [abaSelecionada, setAbaSelecionada] = useState<AbaId>('contas')
  const [contas, setContas] = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [entrandoId, setEntrandoId] = useState<string | null>(null)
  const [alternandoId, setAlternandoId] = useState<string | null>(null)

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function carregar() {
    setLoading(true)
    supabase
      .from('contas')
      .select('id, nome, ativo')
      .order('nome')
      .then(({ data }) => {
        setContas((data || []) as Conta[])
        setLoading(false)
      })
  }

  async function handleEntrar(contaId: string) {
    setEntrandoId(contaId)
    await entrarNaConta(contaId)
  }

  async function handleAlternarAtivo(c: Conta) {
    setAlternandoId(c.id)
    await supabase.from('contas').update({ ativo: !c.ativo }).eq('id', c.id)
    setAlternandoId(null)
    carregar()
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Suporte</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Área da equipe interna — nenhum dado de conta de cliente aparece aqui. Entre numa conta pra
        navegar o sistema com os dados dela.
      </p>

      <div className="mt-6 flex gap-1 border-b border-border">
        {ABAS.map((aba) => {
          const ativa = aba.id === abaSelecionada
          return (
            <button
              key={aba.id}
              type="button"
              onClick={() => setAbaSelecionada(aba.id)}
              className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                ativa
                  ? 'border-brand-500 text-brand-500 font-semibold'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {aba.label}
            </button>
          )
        })}
      </div>

      {abaSelecionada === 'contas' &&
        (loading ? (
          <div className="mt-6 space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {contas.map((c) => {
              const ativaAgora = c.id === contaSuporteAtiva?.id
              return (
                <div
                  key={c.id}
                  className={`flex items-center justify-between rounded-card border p-5 ${
                    ativaAgora ? 'border-brand-500 bg-brand-100' : 'border-border bg-surface'
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={alternandoId === c.id}
                      onClick={() => handleAlternarAtivo(c)}
                      className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg disabled:opacity-60"
                    >
                      {c.ativo ? 'Inativar' : 'Ativar'}
                    </button>
                    {ativaAgora ? (
                      <span className="px-2 text-xs font-semibold text-brand-700">Navegando agora</span>
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
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}
