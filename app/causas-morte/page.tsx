'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import Required from '@/components/Required'

type CausaMorte = { id: string; nome: string; ativo: boolean; ordem: number }

const SELECT_CLASS =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-text-secondary'

export default function CausasMortePage() {
  const supabase = createClient()

  const [causas, setCausas] = useState<CausaMorte[]>([])
  const [loading, setLoading] = useState(true)
  const [novaCausaNome, setNovaCausaNome] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function carregarCausas() {
    setLoading(true)
    const { data } = await supabase.from('causas_morte').select('id, nome, ativo, ordem').order('ordem').order('nome')
    setCausas((data || []) as CausaMorte[])
    setLoading(false)
  }

  useEffect(() => {
    carregarCausas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCriarCausa(e: React.FormEvent) {
    e.preventDefault()
    const nome = novaCausaNome.trim()
    if (!nome) return
    setSalvando(true)
    const { error } = await supabase.from('causas_morte').insert({ nome })
    setSalvando(false)
    if (error) {
      alert('Erro ao criar: ' + error.message)
      return
    }
    setNovaCausaNome('')
    await carregarCausas()
  }

  async function handleAlternarAtivo(c: CausaMorte) {
    const { error } = await supabase.from('causas_morte').update({ ativo: !c.ativo }).eq('id', c.id)
    if (error) alert('Erro: ' + error.message)
    else await carregarCausas()
  }

  return (
    <ModuloGate modulo="causas_morte">
      <div className="mx-auto max-w-lg px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Causas de Morte</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Catálogo padronizado usado no lançamento de Morte — as causas já registradas aparecem aqui
          automaticamente, e novas podem ser criadas direto na tela de lançamento. Inative as que não fizerem
          mais sentido.
        </p>

        <form onSubmit={handleCriarCausa} onKeyDown={bloquearEnvioPorEnter} className="mt-6 mb-4 flex items-end gap-2">
          <div className="flex-1">
            <label className={LABEL_CLASS}>
              Nova causa<Required />
            </label>
            <input required value={novaCausaNome} onChange={(e) => setNovaCausaNome(e.target.value)} className={SELECT_CLASS} />
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
        ) : causas.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface px-5 py-6 text-center">
            <p className="text-sm font-semibold text-text-primary">Nenhuma causa cadastrada ainda</p>
            <p className="mt-1 text-sm text-text-secondary">
              Cadastre acima, ou lance uma Morte com "+ Nova causa..." — ela aparece aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {causas.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-card border border-border bg-surface p-3">
                <p className="text-sm font-semibold text-text-primary">{c.nome}</p>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-control px-2 py-0.5 text-xs font-semibold ${c.ativo ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}
                  >
                    {c.ativo ? 'Ativa' : 'Inativa'}
                  </span>
                  <button type="button" onClick={() => handleAlternarAtivo(c)} className="text-xs font-medium text-brand-500 hover:underline">
                    {c.ativo ? 'Inativar' : 'Ativar'}
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
