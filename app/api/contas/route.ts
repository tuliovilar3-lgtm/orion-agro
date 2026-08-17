import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ModuloId } from '@/lib/modulos'
import type { TipoLimiteConta } from '@/lib/conta-limites'

// checa sessão + suporte usando o cliente de servidor (lê o cookie de
// sessão) — mesmo padrão de exigirDono() em app/api/usuarios/route.ts,
// mas checando usuarios_app.suporte em vez de dono: só a equipe interna
// do fornecedor pode criar conta de cliente nova, não o dono de uma
// conta já existente.
async function exigirSuporte() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }

  const { data: perfil } = await supabase.from('usuarios_app').select('suporte').eq('id', user.id).single()
  if (!perfil?.suporte) {
    return { erro: NextResponse.json({ error: 'Só a equipe de Suporte pode criar contas novas.' }, { status: 403 }) }
  }

  return { user }
}

export async function POST(request: Request) {
  const checagem = await exigirSuporte()
  if (checagem.erro) return checagem.erro

  const body = await request.json()
  const { nomeConta, donoNome, donoEmail, donoSenha, modulos, limiteFazendas, limiteProprietarios } = body as {
    nomeConta?: string
    donoNome?: string
    donoEmail?: string
    donoSenha?: string
    modulos?: ModuloId[]
    limiteFazendas?: number
    limiteProprietarios?: number
  }
  if (!nomeConta || !donoNome || !donoEmail || !donoSenha) {
    return NextResponse.json(
      { error: 'Nome da conta, nome, e-mail e senha do administrador são obrigatórios.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // criado primeiro — se falhar, nada mais foi tocado. email_confirm:
  // true porque quem está criando é o próprio Suporte, não faz sentido
  // exigir confirmação por e-mail de uma senha que acabou de ser
  // definida (mesmo padrão de POST /api/usuarios)
  const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
    email: donoEmail,
    password: donoSenha,
    email_confirm: true,
  })
  if (erroCriar || !criado.user) {
    return NextResponse.json({ error: erroCriar?.message || 'Não foi possível criar o administrador.' }, { status: 400 })
  }

  // dispara as triggers de seed automático (configuracoes, migração
  // 046; categorias_animal + subtipos_uso_area, migração 049) — a conta
  // nasce pronta pra lançar algo sem nenhum passo manual extra
  const { data: contaCriada, error: erroConta } = await admin
    .from('contas')
    .insert({ nome: nomeConta })
    .select('id')
    .single()
  if (erroConta || !contaCriada) {
    await admin.auth.admin.deleteUser(criado.user.id)
    return NextResponse.json({ error: erroConta?.message || 'Não foi possível criar a conta.' }, { status: 500 })
  }
  const contaId = contaCriada.id as string

  if (modulos && modulos.length > 0) {
    const { error: erroModulos } = await admin
      .from('conta_modulos')
      .insert(modulos.map((modulo) => ({ conta_id: contaId, modulo, ativo: true })))
    if (erroModulos) return NextResponse.json({ error: erroModulos.message }, { status: 500 })
  }

  const limites: { conta_id: string; tipo_limite: TipoLimiteConta; valor: number }[] = []
  if (limiteFazendas !== undefined && limiteFazendas !== null) {
    limites.push({ conta_id: contaId, tipo_limite: 'fazendas', valor: limiteFazendas })
  }
  if (limiteProprietarios !== undefined && limiteProprietarios !== null) {
    limites.push({ conta_id: contaId, tipo_limite: 'proprietarios', valor: limiteProprietarios })
  }
  if (limites.length > 0) {
    const { error: erroLimites } = await admin.from('conta_limites').insert(limites)
    if (erroLimites) return NextResponse.json({ error: erroLimites.message }, { status: 500 })
  }

  const { error: erroPerfil } = await admin
    .from('usuarios_app')
    .insert({ id: criado.user.id, nome: donoNome, email: donoEmail, dono: true, modo: 'GESTAO', conta_id: contaId })
  if (erroPerfil) {
    // desfaz o login pra não sobrar uma conta órfã sem perfil — a conta
    // (com módulos/limites/categorias já seedadas) fica pra trás sem
    // administrador; caso raro, corrigido manualmente por Suporte
    await admin.auth.admin.deleteUser(criado.user.id)
    return NextResponse.json({ error: erroPerfil.message }, { status: 500 })
  }

  return NextResponse.json({ id: contaId })
}
