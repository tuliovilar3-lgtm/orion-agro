'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import Required from '@/components/Required'

type ContaBancaria = { id: string; nome: string; especie: boolean; sistema: boolean; ativo: boolean; ordem: number }

const SELECT_CLASS =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-text-secondary'

export default function ContasBancariasPage() {
  const supabase = createClient()

  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([])
  const [loading, setLoading] = useState(true)
  const [novaContaNome, setNovaContaNome] = useState('')
  const [salvandoConta, setSalvandoConta] = useState(false)

  async function carregarContasBancarias() {
    setLoading(true)
    const { data } = await supabase.from('contas_bancarias').select('id, nome, especie, sistema, ativo, ordem').order('ordem')
    setContasBancarias((data || []) as ContaBancaria[])
    setLoading(false)
  }

  useEffect(() => {
    carregarContasBancarias()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCriarContaBancaria(e: React.FormEvent) {
    e.preventDefault()
    const nome = novaContaNome.trim()
    if (!nome) return
    setSalvandoConta(true)
    const { error } = await supabase.from('contas_bancarias').insert({ nome })
    setSalvandoConta(false)
    if (error) {
      alert('Erro ao criar: ' + error.message)
      return
    }
    setNovaContaNome('')
    await carregarContasBancarias()
  }

  async function handleAlternarAtivoConta(c: ContaBancaria) {
    const { error } = await supabase.from('contas_bancarias').update({ ativo: !c.ativo }).eq('id', c.id)
    if (error) alert('Erro: ' + error.message)
    else await carregarContasBancarias()
  }

  return (
    <ModuloGate modulo="contas_bancarias">
      <div className="mx-auto max-w-lg px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Contas Bancárias</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Contas e "Dinheiro em espécie" usados pra registrar por onde entrou/saiu um pagamento.
        </p>

        <form onSubmit={handleCriarContaBancaria} onKeyDown={bloquearEnvioPorEnter} className="mt-6 mb-4 flex items-end gap-2">
          <div className="flex-1">
            <label className={LABEL_CLASS}>
              Nova conta<Required />
            </label>
            <input required value={novaContaNome} onChange={(e) => setNovaContaNome(e.target.value)} className={SELECT_CLASS} />
          </div>
          <button
            type="submit"
            disabled={salvandoConta}
            className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
          >
            {salvandoConta ? 'Salvando...' : 'Adicionar'}
          </button>
        </form>

        {loading ? (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-card bg-border" />
            <div className="h-14 animate-pulse rounded-card bg-border" />
          </div>
        ) : (
          <div className="space-y-2">
            {contasBancarias.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-card border border-border bg-surface p-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">{c.nome}</p>
                  {c.especie && <p className="text-xs text-text-muted">Dinheiro em espécie</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-control px-2 py-0.5 text-xs font-semibold ${c.ativo ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}>
                    {c.ativo ? 'Ativa' : 'Inativa'}
                  </span>
                  <button type="button" onClick={() => handleAlternarAtivoConta(c)} className="text-xs font-medium text-brand-500 hover:underline">
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
