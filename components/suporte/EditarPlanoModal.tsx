'use client'

import { useEffect, useState } from 'react'
import { DOMINIOS, type DominioId } from '@/lib/modulos'
import { RECURSOS, type RecursoId } from '@/lib/conta-recursos'

// edita o plano de uma conta já existente — mesmo molde visual de
// CadastrarContaModal.tsx, só a parte de plano (sem nome da conta/
// administrador, que não fazem sentido editar aqui). Carrega o estado
// atual via GET /api/contas/[id] (precisa do cliente admin do lado do
// servidor — RLS de conta_modulos/conta_recursos/conta_limites não
// libera Suporte "em casa" ver linhas de uma conta que não a própria).
export default function EditarPlanoModal({
  contaId,
  contaNome,
  onClose,
  onSaved,
}: {
  contaId: string
  contaNome: string
  onClose: () => void
  onSaved: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [dominiosSelecionados, setDominiosSelecionados] = useState<Set<DominioId>>(new Set())
  const [recursosSelecionados, setRecursosSelecionados] = useState<Set<RecursoId>>(new Set())
  const [limitesAbertos, setLimitesAbertos] = useState(false)
  const [limiteFazendas, setLimiteFazendas] = useState('')
  const [limiteProprietarios, setLimiteProprietarios] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/contas/${contaId}`)
      .then((r) => r.json())
      .then((data) => {
        setDominiosSelecionados(new Set((data.dominios || []) as DominioId[]))
        setRecursosSelecionados(new Set((data.recursos || []) as RecursoId[]))
        setLimiteFazendas(data.limiteFazendas !== null && data.limiteFazendas !== undefined ? String(data.limiteFazendas) : '')
        setLimiteProprietarios(
          data.limiteProprietarios !== null && data.limiteProprietarios !== undefined ? String(data.limiteProprietarios) : ''
        )
        if (data.limiteFazendas !== null || data.limiteProprietarios !== null) setLimitesAbertos(true)
        setCarregando(false)
      })
  }, [contaId])

  const recursosDisponiveis = RECURSOS.filter((r) => dominiosSelecionados.has(r.dominio))

  function alternarDominio(id: DominioId) {
    const desmarcando = dominiosSelecionados.has(id)
    setDominiosSelecionados((prev) => {
      const novo = new Set(prev)
      if (desmarcando) novo.delete(id)
      else novo.add(id)
      return novo
    })
    // desmarcar um domínio poda os recursos que dependiam dele — evita
    // mandar um recurso de um domínio que não foi contratado
    if (desmarcando) {
      setRecursosSelecionados((prev) => new Set([...prev].filter((r) => RECURSOS.find((rc) => rc.id === r)?.dominio !== id)))
    }
  }

  function alternarRecurso(id: RecursoId) {
    setRecursosSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const resp = await fetch(`/api/contas/${contaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dominios: Array.from(dominiosSelecionados),
        recursos: Array.from(recursosSelecionados),
        limiteFazendas: limiteFazendas ? Number(limiteFazendas) : null,
        limiteProprietarios: limiteProprietarios ? Number(limiteProprietarios) : null,
      }),
    })
    setEnviando(false)
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      setErro(data.error || 'Não foi possível salvar o plano.')
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-bold text-text-primary">Editar plano — {contaNome}</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Desabilitar um módulo não apaga nenhum dado — só tira o acesso; os dados voltam a aparecer
          se o módulo for religado depois.
        </p>

        {carregando ? (
          <div className="mt-4 space-y-3">
            <div className="h-20 animate-pulse rounded-card bg-border" />
            <div className="h-20 animate-pulse rounded-card bg-border" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Módulos contratados</label>
              <div className="grid grid-cols-1 gap-1.5 rounded-control border border-border p-3 sm:grid-cols-2">
                {DOMINIOS.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-text-primary">
                    <input type="checkbox" checked={dominiosSelecionados.has(d.id)} onChange={() => alternarDominio(d.id)} />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>

            {recursosDisponiveis.length > 0 && (
              <div className="border-t border-border pt-4">
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Recursos adicionais</label>
                <div className="grid grid-cols-1 gap-1.5 rounded-control border border-border p-3 sm:grid-cols-2">
                  {recursosDisponiveis.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm text-text-primary">
                      <input type="checkbox" checked={recursosSelecionados.has(r.id)} onChange={() => alternarRecurso(r.id)} />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setLimitesAbertos((v) => !v)}
                className="flex w-full items-center justify-between text-left text-sm font-medium text-text-secondary"
              >
                <span>Limites</span>
                <span className="text-brand-500">{limitesAbertos ? '−' : '+'}</span>
              </button>
              {limitesAbertos && (
                <div className="mt-2.5 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">Limite de fazendas (Multifazendas)</label>
                    <input
                      type="number"
                      min={0}
                      value={limiteFazendas}
                      onChange={(e) => setLimiteFazendas(e.target.value)}
                      placeholder="Em branco = sem limite"
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Limite de proprietários (Multiproprietário)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={limiteProprietarios}
                      onChange={(e) => setLimiteProprietarios(e.target.value)}
                      placeholder="Em branco = sem limite"
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {erro && <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enviando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
              >
                {enviando ? 'Salvando...' : 'Salvar plano'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
