import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function exigirSuporte() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }

  const { data: perfil } = await supabase.from('usuarios_app').select('suporte').eq('id', user.id).single()
  if (!perfil?.suporte) {
    return { erro: NextResponse.json({ error: 'Só a equipe de Suporte pode gerenciar contas.' }, { status: 403 }) }
  }

  return { user }
}

// bug real encontrado ao testar o onboarding: a RLS de `contas` só
// libera SELECT pra suporte (migração 048, contas_visivel_suporte) —
// UPDATE continua restrito a `id = fn_conta_atual()`, então o toggle
// Ativar/Inativar de SuporteHome.tsx sempre falhava (silenciosamente,
// sem erro visível) pra qualquer conta que não fosse a própria do
// suporte. Nunca foi pego antes porque só existia "Conta Principal" —
// a única conta testável era sempre a própria. Corrigido roteando por
// aqui (cliente admin, bypassa RLS), mesmo padrão já usado pra criar
// conta/usuário — evita abrir uma policy de UPDATE ampla direto na
// tabela pra qualquer sessão de suporte.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checagem = await exigirSuporte()
  if (checagem.erro) return checagem.erro
  const { id } = await params

  const body = await request.json()
  const { ativo } = body as { ativo?: boolean }
  if (ativo === undefined) {
    return NextResponse.json({ error: 'Nada pra atualizar.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('contas').update({ ativo }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
