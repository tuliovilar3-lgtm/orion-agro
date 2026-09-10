'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'

type Classe = {
  id: string
  numero: number
  nome: string
  tipo: 'CREDITO' | 'DEBITO'
  ativo: boolean
}

type Centro = {
  id: string
  classe_financeira_id: string
  numero: number | null
  nome: string
  sistema: boolean
  ativo: boolean
}

type Subcentro = {
  id: string
  centro_custo_id: string
  numero: number | null
  nome: string
  sistema: boolean
  ativo: boolean
}

function IconToggle() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export default function PlanoContasPage() {
  const [classes, setClasses] = useState<Classe[]>([])
  const [centros, setCentros] = useState<Centro[]>([])
  const [subcentros, setSubcentros] = useState<Subcentro[]>([])
  const [loading, setLoading] = useState(true)

  const [classesAbertas, setClassesAbertas] = useState<Set<string>>(new Set())
  const [novoCentroNome, setNovoCentroNome] = useState<Record<string, string>>({})
  const [novoSubcentroNome, setNovoSubcentroNome] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  const supabase = createClient()

  async function carregarTudo() {
    setLoading(true)
    const [{ data: c1 }, { data: c2 }, { data: c3 }] = await Promise.all([
      supabase.from('classes_financeiras').select('id, numero, nome, tipo, ativo').order('numero'),
      supabase.from('centros_custo').select('id, classe_financeira_id, numero, nome, sistema, ativo').order('numero'),
      supabase.from('subcentros_custo').select('id, centro_custo_id, numero, nome, sistema, ativo').order('numero'),
    ])
    setClasses((c1 || []) as Classe[])
    setCentros((c2 || []) as Centro[])
    setSubcentros((c3 || []) as Subcentro[])
    setLoading(false)
  }

  useEffect(() => {
    carregarTudo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function alternarClasseAberta(id: string) {
    setClassesAbertas((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  async function handleCriarCentro(classeId: string) {
    const nome = (novoCentroNome[classeId] || '').trim()
    if (!nome) return
    setSalvando(true)
    const doClasse = centros.filter((c) => c.classe_financeira_id === classeId)
    const proximoNumero = doClasse.length ? Math.max(...doClasse.map((c) => c.numero || 0)) + 1 : 1
    const { error } = await supabase
      .from('centros_custo')
      .insert({ classe_financeira_id: classeId, nome, numero: proximoNumero })
    if (error) {
      alert('Erro ao criar centro de custo: ' + error.message)
    } else {
      setNovoCentroNome((prev) => ({ ...prev, [classeId]: '' }))
      await carregarTudo()
    }
    setSalvando(false)
  }

  async function handleCriarSubcentro(centroId: string) {
    const nome = (novoSubcentroNome[centroId] || '').trim()
    if (!nome) return
    setSalvando(true)
    const doCentro = subcentros.filter((s) => s.centro_custo_id === centroId)
    const proximoNumero = doCentro.length ? Math.max(...doCentro.map((s) => s.numero || 0)) + 1 : 1
    const { error } = await supabase
      .from('subcentros_custo')
      .insert({ centro_custo_id: centroId, nome, numero: proximoNumero })
    if (error) {
      alert('Erro ao criar subcentro: ' + error.message)
    } else {
      setNovoSubcentroNome((prev) => ({ ...prev, [centroId]: '' }))
      await carregarTudo()
    }
    setSalvando(false)
  }

  async function handleAlternarAtivoCentro(c: Centro) {
    const { error } = await supabase.from('centros_custo').update({ ativo: !c.ativo }).eq('id', c.id)
    if (error) alert('Erro: ' + error.message)
    else setCentros((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativo: !x.ativo } : x)))
  }

  async function handleAlternarAtivoSubcentro(s: Subcentro) {
    const { error } = await supabase.from('subcentros_custo').update({ ativo: !s.ativo }).eq('id', s.id)
    if (error) alert('Erro: ' + error.message)
    else setSubcentros((prev) => prev.map((x) => (x.id === s.id ? { ...x, ativo: !x.ativo } : x)))
  }

  return (
    <ModuloGate modulo="plano_contas_financeiro">
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Plano de Contas</h1>
        <p className="mt-1 text-sm text-text-secondary">Classe → Centro de Custo → Subcentro de Custo, o catálogo do módulo Financeiro.</p>

        {loading ? (
          <div className="mt-6 space-y-3">
            <div className="h-16 animate-pulse rounded-card bg-border" />
            <div className="h-16 animate-pulse rounded-card bg-border" />
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {classes.map((cl) => {
              const centrosDaClasse = centros.filter((c) => c.classe_financeira_id === cl.id)
              const aberta = classesAbertas.has(cl.id)
              return (
                <div key={cl.id} className="rounded-card border border-border bg-surface">
                  <button
                    type="button"
                    onClick={() => alternarClasseAberta(cl.id)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <span className="text-text-muted">{cl.numero}</span> {cl.nome}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded-control px-2 py-0.5 text-xs font-semibold ${
                          cl.tipo === 'CREDITO' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
                        }`}
                      >
                        {cl.tipo === 'CREDITO' ? 'Crédito' : 'Débito'}
                      </span>
                      <span className="text-text-muted">{aberta ? '−' : '+'}</span>
                    </span>
                  </button>

                  {aberta && (
                    <div className="border-t border-border p-4 pt-3">
                      {centrosDaClasse.length === 0 && (
                        <p className="text-sm text-text-muted">Nenhum centro de custo ainda.</p>
                      )}
                      <div className="space-y-3">
                        {centrosDaClasse.map((c) => {
                          const subsDoCentro = subcentros.filter((s) => s.centro_custo_id === c.id)
                          return (
                            <div key={c.id} className="rounded-control border border-border p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-sm font-medium ${!c.ativo ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                                  {cl.numero}.{c.numero} — {c.nome}
                                </span>
                                <button
                                  type="button"
                                  title={c.ativo ? 'Inativar' : 'Ativar'}
                                  onClick={() => handleAlternarAtivoCentro(c)}
                                  className={c.ativo ? 'text-success' : 'text-text-muted'}
                                >
                                  <IconToggle />
                                </button>
                              </div>
                              <div className="mt-2 space-y-1 pl-4">
                                {subsDoCentro.map((s) => (
                                  <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className={!s.ativo ? 'text-text-muted line-through' : 'text-text-secondary'}>
                                      {cl.numero}.{c.numero}.{s.numero} — {s.nome}
                                    </span>
                                    <button
                                      type="button"
                                      title={s.ativo ? 'Inativar' : 'Ativar'}
                                      onClick={() => handleAlternarAtivoSubcentro(s)}
                                      className={s.ativo ? 'text-success' : 'text-text-muted'}
                                    >
                                      <IconToggle />
                                    </button>
                                  </div>
                                ))}
                                <div className="flex gap-2 pt-1">
                                  <input
                                    value={novoSubcentroNome[c.id] || ''}
                                    onChange={(e) => setNovoSubcentroNome((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                    placeholder="Novo subcentro..."
                                    className="w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500"
                                  />
                                  <button
                                    type="button"
                                    disabled={salvando}
                                    onClick={() => handleCriarSubcentro(c.id)}
                                    className="shrink-0 rounded-control border border-border px-3 py-1.5 text-sm text-text-primary"
                                  >
                                    + Adicionar
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          value={novoCentroNome[cl.id] || ''}
                          onChange={(e) => setNovoCentroNome((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                          placeholder="Novo centro de custo..."
                          className="w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500"
                        />
                        <button
                          type="button"
                          disabled={salvando}
                          onClick={() => handleCriarCentro(cl.id)}
                          className="shrink-0 rounded-control border border-border px-3 py-1.5 text-sm text-text-primary"
                        >
                          + Adicionar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ModuloGate>
  )
}
