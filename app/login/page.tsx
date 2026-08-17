'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'

export default function LoginPage() {
  const [existeDono, setExisteDono] = useState<boolean | null>(null)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [avisoConfirmacao, setAvisoConfirmacao] = useState(false)
  const [avisoInativo, setAvisoInativo] = useState(false)
  const [modoRecuperarSenha, setModoRecuperarSenha] = useState(false)
  const [emailRecuperacao, setEmailRecuperacao] = useState('')
  const [avisoRecuperacaoEnviada, setAvisoRecuperacaoEnviada] = useState(false)

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    supabase.rpc('fn_existe_dono').then(({ data, error }) => {
      if (!error) setExisteDono(Boolean(data))
    })
    // lido do próprio window (não useSearchParams) pra não exigir um
    // Suspense boundary só por causa desse aviso pontual
    if (new URLSearchParams(window.location.search).get('inativo') === '1') setAvisoInativo(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleEntrar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    if (error) {
      setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
      return
    }
    router.push('/')
    router.refresh()
  }

  async function handleRecuperarSenha(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(emailRecuperacao, {
      redirectTo: `${window.location.origin}/api/auth/confirmar?next=/redefinir-senha`,
    })
    setEnviando(false)
    if (error) {
      setErro(error.message)
      return
    }
    setAvisoRecuperacaoEnviada(true)
  }

  async function handleCriarConta(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setAvisoConfirmacao(false)
    setEnviando(true)

    const { data, error } = await supabase.auth.signUp({ email, password: senha })
    if (error) {
      setEnviando(false)
      setErro(error.message)
      return
    }
    const novoUsuario = data.user
    if (!novoUsuario) {
      setEnviando(false)
      setErro('Não foi possível criar a conta. Tente novamente.')
      return
    }

    const { error: erroPerfil } = await supabase
      .from('usuarios_app')
      .insert({ id: novoUsuario.id, nome, email, dono: true })
    setEnviando(false)
    if (erroPerfil) {
      setErro(erroPerfil.message)
      return
    }

    if (data.session) {
      router.push('/')
      router.refresh()
    } else {
      setAvisoConfirmacao(true)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="text-lg font-extrabold tracking-wide text-brand-700">ORION AGRO</span>
        </div>

        <div className="rounded-card border border-border bg-surface p-6">
          {existeDono === null ? (
            <div className="animate-pulse space-y-3">
              <div className="h-9 rounded-control bg-border" />
              <div className="h-9 rounded-control bg-border" />
              <div className="h-9 rounded-control bg-border" />
            </div>
          ) : existeDono ? (
            modoRecuperarSenha ? (
              <>
                <h1 className="text-lg font-bold text-text-primary">Esqueci minha senha</h1>
                {avisoRecuperacaoEnviada ? (
                  <>
                    <div className="mt-4 rounded-control bg-brand-100 px-3 py-2.5 text-sm text-brand-700">
                      Se {emailRecuperacao} tiver uma conta no sistema, enviamos um link pra redefinir a senha.
                      Verifique também a caixa de spam.
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setModoRecuperarSenha(false)
                        setAvisoRecuperacaoEnviada(false)
                        setErro(null)
                      }}
                      className="mt-4 text-sm font-medium text-brand-500 hover:underline"
                    >
                      Voltar pra tela de entrar
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-text-secondary">
                      Informe seu e-mail — enviamos um link pra você definir uma senha nova.
                    </p>
                    <form
                      onSubmit={handleRecuperarSenha}
                      onKeyDown={bloquearEnvioPorEnter}
                      className="mt-4 space-y-3"
                    >
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-text-secondary">E-mail</label>
                        <input
                          type="email"
                          required
                          autoFocus
                          value={emailRecuperacao}
                          onChange={(e) => setEmailRecuperacao(e.target.value)}
                          className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                        />
                      </div>
                      {erro && (
                        <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>
                      )}
                      <button
                        type="submit"
                        disabled={enviando}
                        className="w-full rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
                      >
                        {enviando ? 'Enviando...' : 'Enviar link de recuperação'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModoRecuperarSenha(false)
                          setErro(null)
                        }}
                        className="w-full text-center text-sm font-medium text-text-secondary hover:underline"
                      >
                        Cancelar
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              <>
                <h1 className="text-lg font-bold text-text-primary">Entrar</h1>
                {avisoInativo && (
                  <div className="mt-3 rounded-control bg-warning-bg px-3 py-2 text-xs text-warning">
                    Esse usuário foi inativado. Fale com o administrador do sistema se isso for um engano.
                  </div>
                )}
                <form onSubmit={handleEntrar} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">E-mail</label>
                    <input
                      type="email"
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">Senha</label>
                    <input
                      type="password"
                      required
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                  {erro && (
                    <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>
                  )}
                  <button
                    type="submit"
                    disabled={enviando}
                    className="w-full rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
                  >
                    {enviando ? 'Entrando...' : 'Entrar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModoRecuperarSenha(true)
                      setErro(null)
                    }}
                    className="w-full text-center text-sm font-medium text-brand-500 hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </form>
              </>
            )
          ) : (
            <>
              <h1 className="text-lg font-bold text-text-primary">Criar conta de administrador</h1>
              <p className="mt-1 text-sm text-text-secondary">
                Nenhuma conta existe ainda neste ORION — a primeira conta criada é a do administrador,
                com acesso total. Contas de funcionários são criadas depois, dentro do sistema.
              </p>
              {avisoConfirmacao ? (
                <div className="mt-4 rounded-control bg-brand-100 px-3 py-2.5 text-sm text-brand-700">
                  Conta criada. Verifique seu e-mail ({email}) pra confirmar antes de entrar.
                </div>
              ) : (
                <form onSubmit={handleCriarConta} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">Nome</label>
                    <input
                      required
                      autoFocus
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">E-mail</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">Senha</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                  {erro && (
                    <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>
                  )}
                  <button
                    type="submit"
                    disabled={enviando}
                    className="w-full rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
                  >
                    {enviando ? 'Criando...' : 'Criar conta de administrador'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
