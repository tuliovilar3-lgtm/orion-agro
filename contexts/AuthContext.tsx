'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ModuloId } from '@/lib/modulos'

type UsuarioApp = {
  id: string
  nome: string
  email: string
  dono: boolean
  ativo: boolean
  modo: 'CAMPO' | 'GESTAO'
}

type AuthValue = {
  user: User | null
  usuarioApp: UsuarioApp | null
  modulosPermitidos: Set<ModuloId>
  isDono: boolean
  loading: boolean
  podeAcessar: (modulo: ModuloId) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [usuarioApp, setUsuarioApp] = useState<UsuarioApp | null>(null)
  const [modulosPermitidos, setModulosPermitidos] = useState<Set<ModuloId>>(new Set())
  const [loading, setLoading] = useState(true)

  const supabase = createClient()
  const router = useRouter()

  async function carregarDadosApp(u: User) {
    const [{ data: perfil }, { data: modulos }] = await Promise.all([
      supabase.from('usuarios_app').select('id, nome, email, dono, ativo, modo').eq('id', u.id).maybeSingle(),
      supabase.from('usuario_modulos').select('modulo').eq('usuario_id', u.id),
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
      window.location.href = '/login?inativo=1'
      return
    }

    setUsuarioApp(perfil as UsuarioApp | null)
    setModulosPermitidos(new Set((modulos || []).map((m) => m.modulo as ModuloId)))
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
      }
    })

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDono = usuarioApp?.dono === true

  function podeAcessar(modulo: ModuloId) {
    return isDono || modulosPermitidos.has(modulo)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <AuthContext.Provider value={{ user, usuarioApp, modulosPermitidos, isDono, loading, podeAcessar, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa ser usado dentro de AuthProvider')
  return ctx
}
