export default function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="text-sm text-text-secondary">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  )
}
