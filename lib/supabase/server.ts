import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// cliente Supabase pra uso em Server Components/proxy — lê/escreve a
// sessão via cookies em vez do localStorage usado pelo cliente de
// navegador (lib/supabase/client.ts)
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // chamado de dentro de um Server Component — ignorado porque
            // o proxy já renova a sessão a cada requisição
          }
        },
      },
    }
  )
}
