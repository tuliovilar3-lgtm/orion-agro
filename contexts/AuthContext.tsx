'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MODULOS, type ModuloId, type DominioId } from '@/lib/modulos'

type UsuarioApp = {
  id: string
  nome: string
  email: string
  dono: boolean
  ativo: boolean
  modo: 'CAMPO' | 'GESTAO' | 'CONSULTA'
  suporte: boolean
}

type ContaSuporteAtiva = { id: string; nome: string } | null

type AuthValue = {
  user: User | null
  usuarioApp: UsuarioApp | null
  modulosPermitidos: Set<ModuloId>
  dominiosDaConta: Set<DominioId>
  isDono: boolean
  // conta que um usuário de suporte está navegando agora (migração 048)
  // — null enquanto ele não "entrou" em nenhuma conta de cliente
  contaSuporteAtiva: ContaSuporteAtiva
  emModoSuporte: boolean
  entrarNaConta: (contaId: string) => Promise<void>
  sairDoSuporte: () => Promise<void>
  loading: boolean
  podeAcessar: (modulo: ModuloId) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [usuarioApp, setUsuarioApp] = useState<UsuarioApp | null>(null)
  const [modulosPermitidos, setModulosPermitidos] = useState<Set<ModuloId>>(new Set())
  // domínios que a CONTA (empresa cliente) contratou — migração 047,
  // reinterpretada como domínio (Pecuária/Agricultura/...) na migração
  // 050 (antes era por tela). A permissão final de uma tela é: o
  // domínio dela está contratado E (dono OU o usuário específico tem
  // essa tela liberada em modulosPermitidos) — mesmo o dono não vê
  // tela de um domínio que a própria conta não contratou.
  const [dominiosDaConta, setDominiosDaConta] = useState<Set<DominioId>>(new Set())
  const [contaSuporteAtiva, setContaSuporteAtiva] = useState<ContaSuporteAtiva>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()
  const router = useRouter()

  async function carregarDadosApp(u: User) {
    const [{ data: perfil }, { data: modulos }, { data: modulosConta }, { data: suporteAtivo }] = await Promise.all([
      supabase.from('usuarios_app').select('id, nome, email, dono, ativo, modo, suporte').eq('id', u.id).maybeSingle(),
      supabase.from('usuario_modulos').select('modulo').eq('usuario_id', u.id),
      supabase.from('conta_modulos').select('dominio').eq('ativo', true),
      supabase.from('suporte_conta_ativa').select('conta:contas(id, nome)').eq('usuario_id', u.id).maybeSingle(),
    ])

    // usuário inativado continua com login válido no Supabase Auth (só
    // desligar a flag não revoga a sessão) — sem essa checagem aqui, ele
    // continuaria acessando os módulos que tinha antes de ser inativado.
    // Navegação forçada (não router.push): garante uma montagem nova de
    // /login lendo o parâmetro, em vez de depender do cache de rota do
    // Next.js reaproveitar a página já montada.
    if (perfil && !perfil.ativo) {
      await supabase.auth.signOut()
      setUser(null)
      setUsuarioApp(null)
      setModulosPermitidos(new Set())
      setDominiosDaConta(new Set())
      setContaSuporteAtiva(null)
      window.location.href = '/login?inativo=1'
      return
    }

    setUsuarioApp(perfil as UsuarioApp | null)
    setModulosPermitidos(new Set((modulos || []).map((m) => m.modulo as ModuloId)))
    setDominiosDaConta(new Set((modulosConta || []).map((m) => m.dominio as DominioId)))
    setContaSuporteAtiva(((suporteAtivo as any)?.conta as ContaSuporteAtiva) || null)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u)
      if (u) {
        carregarDadosApp(u).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        carregarDadosApp(session.user)
      } else {
        setUsuarioApp(null)
        setModulosPermitidos(new Set())
        setDominiosDaConta(new Set())
        setContaSuporteAtiva(null)
      }
    })

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDono = usuarioApp?.dono === true
  // "navegando numa conta de cliente" — só true quando o usuário é
  // suporte E tem uma linha ativa em suporte_conta_ativa (fn_conta_atual()
  // já resolveu pra essa conta no banco; este flag só espelha isso pro
  // frontend saber quando mostrar o banner e liberar acesso total)
  const emModoSuporte = usuarioApp?.suporte === true && contaSuporteAtiva !== null

  function podeAcessar(modulo: ModuloId) {
    // suporte "em casa" (não entrou em nenhuma conta ainda) não enxerga
    // NENHUM módulo de conta nenhuma — nem a própria (o usuário pode
    // ser dono da própria Conta Principal e suporte ao mesmo tempo; os
    // dois chapéus exigem o mesmo gesto explícito de "Entrar", sem
    // exceção pra conta própria). Sem esse bloqueio, o fallback de
    // isDono/dominiosDaConta abaixo vazaria o dado da própria conta.
    if (usuarioApp?.suporte && !emModoSuporte) return false
    // suporte navegando numa conta de cliente enxerga tudo, sem passar
    // pela checagem normal de conta_modulos/usuario_modulos (que é
    // sobre o que aquele CLIENTE comprou/liberou, não sobre a equipe
    // interna do fornecedor)
    if (emModoSuporte) return true
    // o DOMÍNIO da tela precisa estar contratado pela conta (migração
    // 050 — antes era a tela em si, migração 047) E o usuário
    // específico precisa ter acesso a essa tela dentro da conta — dono
    // bypassa só a segunda checagem, nunca a primeira
    const dominio = MODULOS.find((m) => m.id === modulo)?.dominio
    return dominio !== undefined && dominiosDaConta.has(dominio) && (isDono || modulosPermitidos.has(modulo))
  }

  // as duas ações abaixo forçam um reload completo (não router.push) de
  // propósito: entrar/sair de uma conta muda o que fn_conta_atual()
  // resolve no banco pra toda query do app — um reload garante que
  // cada tela já montada refaça sua busca sob o novo escopo, em vez de
  // continuar mostrando dado da conta anterior até ser remontada
  async function entrarNaConta(contaId: string) {
    if (!usuarioApp) return
    await supabase.from('suporte_conta_ativa').upsert({ usuario_id: usuarioApp.id, conta_id: contaId })
    window.location.href = '/'
  }

  async function sairDoSuporte() {
    if (!usuarioApp) return
    await supabase.from('suporte_conta_ativa').delete().eq('usuario_id', usuarioApp.id)
    window.location.href = '/'
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        usuarioApp,
        modulosPermitidos,
        dominiosDaConta,
        isDono,
        contaSuporteAtiva,
        emModoSuporte,
        entrarNaConta,
        sairDoSuporte,
        loading,
        podeAcessar,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa ser usado dentro de AuthProvider')
  return ctx
}
