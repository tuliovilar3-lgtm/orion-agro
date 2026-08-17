import type { SupabaseClient } from '@supabase/supabase-js'

// tipos de limite numérico vendidos avulsos por conta (migração 047) —
// 'fazendas' é o módulo Multifazendas, 'proprietarios' é o módulo
// Multiproprietário. Ausência de linha em conta_limites pra um tipo
// significa sem limite (ilimitado) — decisão deliberada pra não exigir
// nenhum seed pra contas com uso irrestrito (ex.: a Conta Principal de
// hoje).
export type TipoLimiteConta = 'fazendas' | 'proprietarios'

export async function excedeuLimiteConta(
  supabase: SupabaseClient,
  tipoLimite: TipoLimiteConta,
  contagemAtual: number
): Promise<boolean> {
  const { data } = await supabase.from('conta_limites').select('valor').eq('tipo_limite', tipoLimite).maybeSingle()
  if (!data) return false
  return contagemAtual >= data.valor
}
