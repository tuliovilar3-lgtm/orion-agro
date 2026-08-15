import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// cliente com a service_role key — ignora RLS e pode chamar a Admin API
// (criar/editar usuário de autenticação). Só pode ser importado de
// código que roda no servidor (Route Handlers) — o import 'server-only'
// acima faz o build falhar se algum componente client tentar importar
// este arquivo, então nenhuma chave privada vaza pro navegador.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
