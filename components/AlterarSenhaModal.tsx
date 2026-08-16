'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'

export default function AlterarSenhaModal({ onClose }: { onClose: () => void }) {
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    if (novaSenha.length < 6) {
      setErro('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (novaSenha !== confirmarSenha) {
      setErro('As senhas não coincidem.')
      return
    }

    setEnviando(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    setEnviando(false)
    if (error) {
      setErro(error.message)
      return
    }
    setSucesso(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-bold text-text-primary">Alterar minha senha</h2>

        {sucesso ? (
          <>
            <div className="mt-4 rounded-control bg-success-bg px-3 py-2.5 text-sm text-success">
              Senha alterada com sucesso.
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover"
              >
                Fechar
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Nova senha
                <Required />
              </label>
              <input
                type="password"
                required
                autoFocus
                minLength={6}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Confirmar nova senha
                <Required />
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              />
            </div>

            {erro && <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-control border border-border px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enviando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
              >
                {enviando ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
