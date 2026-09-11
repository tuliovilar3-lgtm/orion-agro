'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import Required from '@/components/Required'

type AtividadeEconomica = { id: string; nome: string; sistema: boolean; ativo: boolean; ordem: number }

const SELECT_CLASS =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-text-secondary'

export default function AtividadesEconomicasPage() {
  const supabase = createClient()

  const [atividades, setAtividades] = useState<AtividadeEconomica[]>([])
  const [loading, setLoading] = useState(true)
  const [novaAtividadeNome, setNovaAtividadeNome] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function carregarAtividades() {
    setLoading(true)
    const { data } = await supabase.from('atividades_economicas').select('id, nome, sistema, ativo, ordem').order('ordem')
    setAtividades((data || []) as AtividadeEconomica[])
    setLoading(false)
  }

  useEffect(() => {
    carregarAtividades()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCriarAtividade(e: React.FormEvent) {
    e.preventDefault()
    const nome = novaAtividadeNome.trim()
    if (!nome) return
    setSalvando(true)
    const { error } = await supabase.from('atividades_economicas').insert({ nome })
    setSalvando(false)
    if (error) {
      alert('Erro ao criar: ' + error.message)
      return
    }
    setNovaAtividadeNome('')
    await carregarAtividades()
  }

  async function handleAlternarAtivo(a: AtividadeEconomica) {
    const { error } = await supabase.from('atividades_economicas').update({ ativo: !a.ativo }).eq('id', a.id)
    if (error) alert('Erro: ' + error.message)
    else await carregarAtividades()
  }

  return (
    <ModuloGate modulo="atividades_economicas">
      <div className="mx-auto max-w-lg px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Atividades Econômicas</h1>
        <p className="mt-1 text-sm text-text-secondary">
          A qual negócio um lançamento financeiro pertence — útil quando a fazenda/família opera mais
          de uma atividade ao mesmo tempo. Ative só as que fazem sentido pra você.
        </p>

        <form onSubmit={handleCriarAtividade} onKeyDown={bloquearEnvioPorEnter} className="mt-6 mb-4 flex items-end gap-2">
          <div className="flex-1">
            <label className={LABEL_CLASS}>
              Nova atividade<Required />
            </label>
            <input required value={novaAtividadeNome} onChange={(e) => setNovaAtividadeNome(e.target.value)} className={SELECT_CLASS} />
          </div>
          <button
            type="submit"
            disabled={salvando}
            className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
          >
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </form>

        {loading ? (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-card bg-border" />
            <div className="h-14 animate-pulse rounded-card bg-border" />
          </div>
        ) : (
          <div className="space-y-2">
            {atividades.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-card border border-border bg-surface p-3">
                <p className="text-sm font-semibold text-text-primary">{a.nome}</p>
                <div className="flex items-center gap-3">
                  <span className={`rounded-control px-2 py-0.5 text-xs font-semibold ${a.ativo ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}>
                    {a.ativo ? 'Ativa' : 'Inativa'}
                  </span>
                  <button type="button" onClick={() => handleAlternarAtivo(a)} className="text-xs font-medium text-brand-500 hover:underline">
                    {a.ativo ? 'Inativar' : 'Ativar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModuloGate>
  )
}
