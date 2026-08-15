import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// checa sessão + dono usando o cliente de servidor (lê o cookie de
// sessão) — repetido nos dois handlers porque cada Route Handler
// precisa validar por conta própria (não passa pelo proxy)
async function exigirDono() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }

  const { data: perfil } = await supabase.from('usuarios_app').select('dono').eq('id', user.id).single()
  if (!perfil?.dono) return { erro: NextResponse.json({ error: 'Só o administrador pode gerenciar usuários.' }, { status: 403 }) }

  return { user }
}

export async function GET() {
  const checagem = await exigirDono()
  if (checagem.erro) return checagem.erro

  const supabase = await createClient()
  const [{ data: usuarios, error: erroUsuarios }, { data: modulos, error: erroModulos }] = await Promise.all([
    supabase.from('usuarios_app').select('id, nome, email, dono, ativo, modo, created_at').order('created_at'),
    supabase.from('usuario_modulos').select('usuario_id, modulo'),
  ])
  if (erroUsuarios) return NextResponse.json({ error: erroUsuarios.message }, { status: 500 })
  if (erroModulos) return NextResponse.json({ error: erroModulos.message }, { status: 500 })

  const modulosPorUsuario = new Map<string, string[]>()
  for (const m of modulos || []) {
    const lista = modulosPorUsuario.get(m.usuario_id) || []
    lista.push(m.modulo)
    modulosPorUsuario.set(m.usuario_id, lista)
  }

  return NextResponse.json({
    usuarios: (usuarios || []).map((u) => ({ ...u, modulos: modulosPorUsuario.get(u.id) || [] })),
  })
}

export async function POST(request: Request) {
  const checagem = await exigirDono()
  if (checagem.erro) return checagem.erro

  const body = await request.json()
  const { nome, email, senha, modulos, modo } = body as {
    nome?: string
    email?: string
    senha?: string
    modulos?: string[]
    modo?: 'CAMPO' | 'GESTAO'
  }
  if (!nome || !email || !senha) {
    return NextResponse.json({ error: 'Nome, e-mail e senha são obrigatórios.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // e-mail já confirmado — quem cria a conta é o dono, então não faz
  // sentido exigir que o próprio funcionário confirme por e-mail antes
  // de conseguir entrar com a senha que o dono acabou de definir
  const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  })
  if (erroCriar || !criado.user) {
    return NextResponse.json({ error: erroCriar?.message || 'Não foi possível criar o usuário.' }, { status: 400 })
  }

  const { error: erroPerfil } = await admin
    .from('usuarios_app')
    .insert({ id: criado.user.id, nome, email, dono: false, modo: modo || 'GESTAO' })
  if (erroPerfil) {
    // desfaz a criação do login pra não sobrar uma conta órfã sem perfil
    await admin.auth.admin.deleteUser(criado.user.id)
    return NextResponse.json({ error: erroPerfil.message }, { status: 500 })
  }

  if (modulos && modulos.length > 0) {
    const { error: erroModulos } = await admin
      .from('usuario_modulos')
      .insert(modulos.map((modulo) => ({ usuario_id: criado.user.id, modulo })))
    if (erroModulos) {
      return NextResponse.json({ error: erroModulos.message }, { status: 500 })
    }
  }

  return NextResponse.json({ id: criado.user.id })
}
