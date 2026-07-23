export default function KpiCard({
  label,
  value,
  hint,
  corDestaque,
}: {
  label: string
  value: string
  hint?: string
  // liga o card à cor de uma série correspondente num gráfico (ex.:
  // legenda do Relatório de Lotação) — borda esquerda + bolinha, nunca
  // tingindo o card inteiro nem o número, pra manter os cards neutros
  // quando usados sem gráfico ao lado (Painel, Relatórios)
  corDestaque?: string
}) {
  return (
    <div
      className="rounded-card border border-border bg-surface p-5"
      style={corDestaque ? { borderLeft: `3px solid ${corDestaque}`, borderRadius: 12 } : undefined}
    >
      <div className="flex items-center gap-1.5 text-sm text-text-secondary">
        {corDestaque && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: corDestaque }} />}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  )
}
