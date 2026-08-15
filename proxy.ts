import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Next.js 16 renomeou Middleware pra Proxy (mesmo arquivo/convenção,
// nome novo) — este arquivo roda antes de toda página, renovando a
// sessão do Supabase e redirecionando quem não está logado pro /login.
// É uma checagem "otimista" (só lê o cookie de sessão, sem consultar o
// banco) — a checagem de qual módulo cada usuário pode ver continua
// sendo feita no app (AuthContext/ModuloGate), não aqui.
const ROTAS_PUBLICAS = ['/login']

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const rotaPublica = ROTAS_PUBLICAS.includes(path)

  if (!user && !rotaPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && rotaPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  // roda em toda rota, exceto assets estáticos, ícones/manifest do PWA e
  // as próprias rotas de API (cada Route Handler faz sua própria
  // checagem de autenticação/permissão — ver app/api/usuarios)
  matcher: [
    '/((?!_next/static|_next/image|api|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icon-192.png|icon-512.png|icon-512-maskable.png).*)',
  ],
}
