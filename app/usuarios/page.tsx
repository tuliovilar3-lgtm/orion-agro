'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MODULOS, type ModuloId } from '@/lib/modulos'
import CadastrarUsuarioModal from '@/components/usuarios/CadastrarUsuarioModal'

type UsuarioLinha = {
  id: string
  nome: string
  email: string
  dono: boolean
  ativo: boolean
  modo: 'CAMPO' | 'GESTAO'
  modulos: ModuloId[]
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
  )
}

export default function UsuariosPage() {
  const { isDono, loading: loadingAuth } = useAuth()
  const [usuarios, setUsuarios] = useState<UsuarioLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modalAberto, setModalAberto] = useState(false)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)

  async function carregar() {
    setLoading(true)
    setErro(null)
    const resp = await fetch('/api/usuarios')
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      setErro(data.error || 'Não foi possível carregar os usuários.')
      setLoading(false)
      return
    }
    const data = await resp.json()
    setUsuarios(data.usuarios || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!loadingAuth && isDono) carregar()
    else if (!loadingAuth) setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingAuth, isDono])

  async function handleToggleAtivo(u: UsuarioLinha) {
    setSalvandoId(u.id)
    await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !u.ativo }),
    })
    setSalvandoId(null)
    carregar()
  }

  async function handleToggleModulo(u: UsuarioLinha, modulo: ModuloId) {
    const novosModulos = u.modulos.includes(modulo)
      ? u.modulos.filter((m) => m !== modulo)
      : [...u.modulos, modulo]
    setSalvandoId(u.id)
    await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulos: novosModulos }),
    })
    setSalvandoId(null)
    carregar()
  }

  if (loadingAuth || (loading && isDono)) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (!isDono) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Acesso restrito</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Só o administrador do sistema pode gerenciar usuários.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-text-primary">Usuários</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Crie contas pra sua equipe e escolha quais módulos cada pessoa pode acessar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover"
        >
          + Novo usuário
        </button>
      </div>

      {erro && <p className="mt-4 text-sm text-error">Erro: {erro}</p>}

      <div className="mt-6 space-y-3">
        {usuarios.map((u) => (
          <div key={u.id} className="rounded-card border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-text-primary">{u.nome}</span>
                {u.dono && (
                  <span className="ml-2 rounded-control bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    Administrador
                  </span>
                )}
                {!u.ativo && (
                  <span className="ml-2 rounded-control bg-error-bg px-2 py-0.5 text-xs font-semibold text-error">
                    Inativo
                  </span>
                )}
                <div className="text-sm text-text-secondary">{u.email}</div>
              </div>
              {!u.dono && (
                <button
                  type="button"
                  disabled={salvandoId === u.id}
                  onClick={() => handleToggleAtivo(u)}
                  className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg disabled:opacity-60"
                >
                  {u.ativo ? 'Inativar' : 'Ativar'}
                </button>
              )}
            </div>

            {!u.dono && (
              <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-border pt-3 sm:grid-cols-2">
                {MODULOS.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      disabled={salvandoId === u.id}
                      checked={u.modulos.includes(m.id)}
                      onChange={() => handleToggleModulo(u, m.id)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {modalAberto && (
        <CadastrarUsuarioModal
          onClose={() => setModalAberto(false)}
          onSaved={() => {
            setModalAberto(false)
            carregar()
          }}
        />
      )}
    </div>
  )
}
