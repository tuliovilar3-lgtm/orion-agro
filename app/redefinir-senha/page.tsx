'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'

// chegada via link de "esqueci minha senha" — quando esta página
// carrega, a sessão de recuperação já foi estabelecida por
// app/api/auth/confirmar/route.ts (troca do code do e-mail por
// sessão), então só falta definir a senha nova
export default function RedefinirSenhaPage() {
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)

  const router = useRouter()

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
      setErro(
        error.message.includes('session')
          ? 'Esse link de recuperação expirou ou já foi usado. Peça um novo em "Esqueci minha senha".'
          : error.message
      )
      return
    }
    setSucesso(true)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="text-lg font-extrabold tracking-wide text-brand-700">ORION AGRO</span>
        </div>

        <div className="rounded-card border border-border bg-surface p-6">
          <h1 className="text-lg font-bold text-text-primary">Redefinir senha</h1>

          {sucesso ? (
            <>
              <div className="mt-4 rounded-control bg-success-bg px-3 py-2.5 text-sm text-success">
                Senha alterada com sucesso.
              </div>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="mt-4 w-full rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover"
              >
                Entrar no sistema
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-3">
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
              <button
                type="submit"
                disabled={enviando}
                className="w-full rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
              >
                {enviando ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
