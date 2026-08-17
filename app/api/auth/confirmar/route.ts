import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// troca o "code" que vem no link de recuperação de senha (enviado por
// e-mail via supabase.auth.resetPasswordForEmail) por uma sessão de
// verdade — precisa ser um Route Handler (fora do proxy de
// autenticação, que já exclui /api) porque nesse momento ainda não
// existe nenhuma sessão: é exatamente essa troca que cria uma
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?erro=link_invalido`)
}
