import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODULOS } from '@/lib/modulos'
import { RECURSOS } from '@/lib/conta-recursos'

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

// lê o plano atual de uma conta (domínios/recursos/limites) — precisa
// do cliente admin pelo mesmo motivo do PATCH abaixo: RLS dessas 3
// tabelas só libera conta_id = fn_conta_atual(), sem exceção pra
// Suporte "em casa" (diferente de `contas`, que já tem essa exceção
// desde a migração 048)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checagem = await exigirSuporte()
  if (checagem.erro) return checagem.erro
  const { id } = await params

  const admin = createAdminClient()
  const [{ data: dominiosRows }, { data: recursosRows }, { data: limitesRows }] = await Promise.all([
    admin.from('conta_modulos').select('dominio').eq('conta_id', id),
    admin.from('conta_recursos').select('recurso').eq('conta_id', id),
    admin.from('conta_limites').select('tipo_limite, valor').eq('conta_id', id),
  ])

  const limiteFazendas = limitesRows?.find((l) => l.tipo_limite === 'fazendas')?.valor ?? null
  const limiteProprietarios = limitesRows?.find((l) => l.tipo_limite === 'proprietarios')?.valor ?? null

  return NextResponse.json({
    dominios: (dominiosRows || []).map((r) => r.dominio),
    recursos: (recursosRows || []).map((r) => r.recurso),
    limiteFazendas,
    limiteProprietarios,
  })
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
  const { ativo, dominios, recursos, limiteFazendas, limiteProprietarios } = body as {
    ativo?: boolean
    dominios?: string[]
    recursos?: string[]
    limiteFazendas?: number | null
    limiteProprietarios?: number | null
  }
  if (
    ativo === undefined &&
    dominios === undefined &&
    recursos === undefined &&
    limiteFazendas === undefined &&
    limiteProprietarios === undefined
  ) {
    return NextResponse.json({ error: 'Nada pra atualizar.' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (ativo !== undefined) {
    const { error } = await admin.from('contas').update({ ativo }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // domínios: substituídos por completo (apaga e reinsere, mesmo
  // princípio já usado em usuario_modulos/pessoa_papeis) — domínio
  // removido também limpa usuario_modulos dessa conta pras telas
  // daquele domínio, pra não sobrar concessão "fantasma" se o domínio
  // for recontratado depois. Domínio adicionado não concede nada a
  // usuário nenhum sozinho — quem assigna telas por usuário continua
  // sendo o dono, em /usuarios.
  if (dominios !== undefined) {
    const { data: atuaisRows } = await admin.from('conta_modulos').select('dominio').eq('conta_id', id)
    const dominiosAtuais = new Set((atuaisRows || []).map((r) => r.dominio))
    const dominiosNovos = new Set(dominios)
    const removidos = [...dominiosAtuais].filter((d) => !dominiosNovos.has(d))

    const { error: erroDelete } = await admin.from('conta_modulos').delete().eq('conta_id', id)
    if (erroDelete) return NextResponse.json({ error: erroDelete.message }, { status: 500 })

    if (dominios.length > 0) {
      const { error: erroInsert } = await admin
        .from('conta_modulos')
        .insert(dominios.map((dominio) => ({ conta_id: id, dominio, ativo: true })))
      if (erroInsert) return NextResponse.json({ error: erroInsert.message }, { status: 500 })
    }

    if (removidos.length > 0) {
      const modulosRemovidos = MODULOS.filter((m) => removidos.includes(m.dominio)).map((m) => m.id)
      if (modulosRemovidos.length > 0) {
        const { error: erroUsuarioModulos } = await admin
          .from('usuario_modulos')
          .delete()
          .eq('conta_id', id)
          .in('modulo', modulosRemovidos)
        if (erroUsuarioModulos) return NextResponse.json({ error: erroUsuarioModulos.message }, { status: 500 })
      }
    }
  }

  // recursos: mesmo padrão apaga-e-reinsere; recurso que sai ou entra
  // espelha o mesmo efeito colateral que POST /api/contas já aplica na
  // criação (liga/desliga a coluna de efeito em configuracoes), só que
  // agora nos dois sentidos — conceder E revogar
  if (recursos !== undefined) {
    const recursosNovos = new Set(recursos)

    const { error: erroDelete } = await admin.from('conta_recursos').delete().eq('conta_id', id)
    if (erroDelete) return NextResponse.json({ error: erroDelete.message }, { status: 500 })

    if (recursos.length > 0) {
      const { error: erroInsert } = await admin.from('conta_recursos').insert(
        recursos.map((recurso) => ({
          conta_id: id,
          dominio: RECURSOS.find((r) => r.id === recurso)!.dominio,
          recurso,
          ativo: true,
        }))
      )
      if (erroInsert) return NextResponse.json({ error: erroInsert.message }, { status: 500 })
    }

    const { error: erroConfig } = await admin
      .from('configuracoes')
      .update({
        controla_pasto: recursosNovos.has('controle_pasto'),
        controla_contas_pagar_receber: recursosNovos.has('contas_a_pagar_receber'),
      })
      .eq('conta_id', id)
    if (erroConfig) return NextResponse.json({ error: erroConfig.message }, { status: 500 })
  }

  // limites: upsert quando vem um valor, delete quando vem null (=
  // "sem limite")
  if (limiteFazendas !== undefined) {
    const { error } =
      limiteFazendas === null
        ? await admin.from('conta_limites').delete().eq('conta_id', id).eq('tipo_limite', 'fazendas')
        : await admin
            .from('conta_limites')
            .upsert({ conta_id: id, tipo_limite: 'fazendas', valor: limiteFazendas }, { onConflict: 'conta_id,tipo_limite' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (limiteProprietarios !== undefined) {
    const { error } =
      limiteProprietarios === null
        ? await admin.from('conta_limites').delete().eq('conta_id', id).eq('tipo_limite', 'proprietarios')
        : await admin
            .from('conta_limites')
            .upsert({ conta_id: id, tipo_limite: 'proprietarios', valor: limiteProprietarios }, { onConflict: 'conta_id,tipo_limite' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
