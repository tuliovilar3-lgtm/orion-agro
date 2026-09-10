'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import Required from '@/components/Required'

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

type Produto = {
  id: string
  nome: string
  subcentro_custo_id: string | null
  sistema: boolean
  ativo: boolean
}

type Aba = 'plano' | 'produtos'

function IconToggle() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export default function PlanoContasPage() {
  const [abaSelecionada, setAbaSelecionada] = useState<Aba>('plano')

  const [classes, setClasses] = useState<Classe[]>([])
  const [centros, setCentros] = useState<Centro[]>([])
  const [subcentros, setSubcentros] = useState<Subcentro[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)

  const [classesAbertas, setClassesAbertas] = useState<Set<string>>(new Set())
  const [novoCentroNome, setNovoCentroNome] = useState<Record<string, string>>({})
  const [novoSubcentroNome, setNovoSubcentroNome] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  const [modalProdutoAberto, setModalProdutoAberto] = useState(false)
  const [produtoNome, setProdutoNome] = useState('')
  const [produtoClasseId, setProdutoClasseId] = useState('')
  const [produtoCentroId, setProdutoCentroId] = useState('')
  const [produtoSubcentroId, setProdutoSubcentroId] = useState('')

  const supabase = createClient()

  async function carregarTudo() {
    setLoading(true)
    const [{ data: c1 }, { data: c2 }, { data: c3 }, { data: p }] = await Promise.all([
      supabase.from('classes_financeiras').select('id, numero, nome, tipo, ativo').order('numero'),
      supabase.from('centros_custo').select('id, classe_financeira_id, numero, nome, sistema, ativo').order('numero'),
      supabase.from('subcentros_custo').select('id, centro_custo_id, numero, nome, sistema, ativo').order('numero'),
      supabase.from('produtos_financeiros').select('id, nome, subcentro_custo_id, sistema, ativo').order('nome'),
    ])
    setClasses((c1 || []) as Classe[])
    setCentros((c2 || []) as Centro[])
    setSubcentros((c3 || []) as Subcentro[])
    setProdutos((p || []) as Produto[])
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

  async function handleAlternarAtivoProduto(p: Produto) {
    const { error } = await supabase.from('produtos_financeiros').update({ ativo: !p.ativo }).eq('id', p.id)
    if (error) alert('Erro: ' + error.message)
    else setProdutos((prev) => prev.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)))
  }

  function abrirNovoProduto() {
    setProdutoNome('')
    setProdutoClasseId('')
    setProdutoCentroId('')
    setProdutoSubcentroId('')
    setModalProdutoAberto(true)
  }

  async function handleSalvarProduto(e: React.FormEvent) {
    e.preventDefault()
    if (!produtoNome.trim()) return
    setSalvando(true)
    const { error } = await supabase.from('produtos_financeiros').insert({
      nome: produtoNome.trim(),
      subcentro_custo_id: produtoSubcentroId || null,
    })
    setSalvando(false)
    if (error) {
      alert('Erro ao salvar produto: ' + error.message)
    } else {
      setModalProdutoAberto(false)
      await carregarTudo()
    }
  }

  function labelClassificacao(p: Produto): string {
    if (!p.subcentro_custo_id) return '—'
    const sc = subcentros.find((s) => s.id === p.subcentro_custo_id)
    if (!sc) return '—'
    const c = centros.find((c) => c.id === sc.centro_custo_id)
    const cl = c ? classes.find((cl) => cl.id === c.classe_financeira_id) : null
    return [cl?.nome, c?.nome, sc.nome].filter(Boolean).join(' › ')
  }

  const centrosDaClasseProduto = centros.filter((c) => c.classe_financeira_id === produtoClasseId)
  const subcentrosDoCentroProduto = subcentros.filter((s) => s.centro_custo_id === produtoCentroId)

  return (
    <ModuloGate modulo="plano_contas_financeiro">
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Plano de Contas</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Classe → Centro de Custo → Subcentro de Custo (catálogo do módulo Financeiro) e os
          Produtos/Serviços usados nos lançamentos.
        </p>

        <div className="mt-6 flex gap-1 border-b border-border">
          {(
            [
              { id: 'plano', label: 'Plano de Contas' },
              { id: 'produtos', label: 'Produtos e Serviços' },
            ] as { id: Aba; label: string }[]
          ).map((aba) => (
            <button
              key={aba.id}
              type="button"
              onClick={() => setAbaSelecionada(aba.id)}
              className={`border-b-2 px-4 py-2.5 text-sm ${
                abaSelecionada === aba.id
                  ? 'border-brand-500 font-semibold text-brand-700'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {aba.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 space-y-3">
            <div className="h-16 animate-pulse rounded-card bg-border" />
            <div className="h-16 animate-pulse rounded-card bg-border" />
          </div>
        ) : abaSelecionada === 'plano' ? (
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
        ) : (
          <div className="mt-6">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={abrirNovoProduto}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover"
              >
                + Novo Produto/Serviço
              </button>
            </div>

            {produtos.length === 0 ? (
              <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
                <p className="text-sm font-semibold text-text-primary">Nenhum produto ou serviço cadastrado</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Cadastre o primeiro pra poder lançar movimentações financeiras.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-card border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase text-text-muted">
                      <th className="px-4 py-2.5">Nome</th>
                      <th className="px-4 py-2.5">Classificação padrão</th>
                      <th className="w-10 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className={`px-4 py-2.5 ${!p.ativo ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                          {p.nome}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary">{labelClassificacao(p)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            title={p.ativo ? 'Inativar' : 'Ativar'}
                            onClick={() => handleAlternarAtivoProduto(p)}
                            className={p.ativo ? 'text-success' : 'text-text-muted'}
                          >
                            <IconToggle />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {modalProdutoAberto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-card border border-border bg-surface p-6">
              <h2 className="text-lg font-bold text-text-primary">Novo Produto/Serviço</h2>
              <form onSubmit={handleSalvarProduto} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Nome<Required />
                  </label>
                  <input
                    required
                    autoFocus
                    value={produtoNome}
                    onChange={(e) => setProdutoNome(e.target.value)}
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Classificação padrão (opcional)
                  </label>
                  <div className="space-y-2">
                    <select
                      value={produtoClasseId}
                      onChange={(e) => {
                        setProdutoClasseId(e.target.value)
                        setProdutoCentroId('')
                        setProdutoSubcentroId('')
                      }}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    >
                      <option value="">Classe...</option>
                      {classes.map((cl) => (
                        <option key={cl.id} value={cl.id}>
                          {cl.numero} — {cl.nome}
                        </option>
                      ))}
                    </select>
                    {produtoClasseId && (
                      <select
                        value={produtoCentroId}
                        onChange={(e) => {
                          setProdutoCentroId(e.target.value)
                          setProdutoSubcentroId('')
                        }}
                        className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                      >
                        <option value="">Centro de custo...</option>
                        {centrosDaClasseProduto.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    )}
                    {produtoCentroId && (
                      <select
                        value={produtoSubcentroId}
                        onChange={(e) => setProdutoSubcentroId(e.target.value)}
                        className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                      >
                        <option value="">Subcentro...</option>
                        {subcentrosDoCentroProduto.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-text-muted">
                    Escolher esse produto num lançamento novo preenche essa classificação sozinho.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalProdutoAberto(false)}
                    className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={salvando}
                    className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
                  >
                    {salvando ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ModuloGate>
  )
}
