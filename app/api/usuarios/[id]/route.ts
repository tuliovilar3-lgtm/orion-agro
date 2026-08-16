import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function exigirDono() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }

  const { data: perfil } = await supabase.from('usuarios_app').select('dono, conta_id').eq('id', user.id).single()
  if (!perfil?.dono) return { erro: NextResponse.json({ error: 'Só o administrador pode gerenciar usuários.' }, { status: 403 }) }

  return { user, contaId: perfil.conta_id as string }
}

const SENHA_PADRAO = '123456'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checagem = await exigirDono()
  if (checagem.erro) return checagem.erro
  const { id } = await params

  const body = await request.json()
  const { nome, ativo, modo, modulos, resetSenha } = body as {
    nome?: string
    ativo?: boolean
    modo?: 'CAMPO' | 'GESTAO' | 'CONSULTA'
    modulos?: string[]
    resetSenha?: boolean
  }

  const admin = createAdminClient()

  if (resetSenha) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: SENHA_PADRAO })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const camposUpdate: Record<string, unknown> = {}
  if (nome !== undefined) camposUpdate.nome = nome
  if (ativo !== undefined) camposUpdate.ativo = ativo
  if (modo !== undefined) camposUpdate.modo = modo

  if (Object.keys(camposUpdate).length > 0) {
    const { error } = await admin.from('usuarios_app').update(camposUpdate).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // módulos são substituídos por completo (apaga e reinsere) — mesmo
  // princípio já usado em outros pontos do app pra sincronizar uma lista
  // filha inteira, mais simples que calcular um diff
  if (modulos !== undefined) {
    const { error: erroDelete } = await admin.from('usuario_modulos').delete().eq('usuario_id', id)
    if (erroDelete) return NextResponse.json({ error: erroDelete.message }, { status: 500 })

    if (modulos.length > 0) {
      // conta_id explícito — mesmo motivo do POST em route.ts (cliente
      // admin bypassa RLS e o valor padrão automático de conta_id)
      const { error: erroInsert } = await admin
        .from('usuario_modulos')
        .insert(modulos.map((modulo) => ({ usuario_id: id, modulo, conta_id: checagem.contaId })))
      if (erroInsert) return NextResponse.json({ error: erroInsert.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checagem = await exigirDono()
  if (checagem.erro) return checagem.erro
  const { id } = await params

  const supabase = await createClient()
  const { data: alvo } = await supabase.from('usuarios_app').select('dono').eq('id', id).single()
  if (alvo?.dono) {
    return NextResponse.json({ error: 'Não é possível excluir a conta de administrador.' }, { status: 400 })
  }

  const admin = createAdminClient()
  // apaga o login em auth.users — o "on delete cascade" das FKs
  // (usuarios_app.id -> auth.users, usuario_modulos.usuario_id ->
  // usuarios_app) já limpa o perfil e os módulos junto, sem código extra
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
