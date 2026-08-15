import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checagem = await exigirDono()
  if (checagem.erro) return checagem.erro
  const { id } = await params

  const body = await request.json()
  const { nome, ativo, modo, modulos } = body as {
    nome?: string
    ativo?: boolean
    modo?: 'CAMPO' | 'GESTAO'
    modulos?: string[]
  }

  const admin = createAdminClient()

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
      const { error: erroInsert } = await admin
        .from('usuario_modulos')
        .insert(modulos.map((modulo) => ({ usuario_id: id, modulo })))
      if (erroInsert) return NextResponse.json({ error: erroInsert.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
