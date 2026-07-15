'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade, formatPeso } from '@/lib/format'

type Fazenda = { id: string; nome: string }
type Categoria = { id: string; nome: string }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }
type ModoPesagem = 'CATEGORIA' | 'PASTO'

type LinhaDistribuicao = {
  pasto_id: string
  pasto_nome: string
  categoria_id: string
  categoria_nome: string
  quantidade: number
}

type Pesagem = {
  id: string
  data: string
  peso_medio_kg: number
  observacao: string | null
  fazenda: { nome: string } | null
  categoria: { nome: string } | null
  pasto: { nome: string } | null
}

// critério biológico: peso médio não pode ser zero, negativo ou não-numérico
function pesoValido(v: string) {
  const n = parseFloat(v)
  return Number.isFinite(n) && n > 0
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-48 rounded bg-border" />
      <div className="mt-3 h-3 w-32 rounded bg-border" />
    </div>
  )
}

export default function PesagensPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [pastos, setPastos] = useState<Pasto[]>([])
  const [controlaPasto, setControlaPasto] = useState(false)
  const [pesagens, setPesagens] = useState<Pesagem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [fazendaId, setFazendaId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [modo, setModo] = useState<ModoPesagem>('CATEGORIA')
  const [pastoId, setPastoId] = useState('')
  const [distribuicao, setDistribuicao] = useState<LinhaDistribuicao[]>([])
  const [loadingDistribuicao, setLoadingDistribuicao] = useState(false)
  const [pesoPorCategoria, setPesoPorCategoria] = useState<Record<string, string>>({})
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<string | null>(null)
  const [excluindoId, setExcluindoId] = useState<string | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const mostrarToggleModo = controlaPasto
  const pastosDaFazenda = pastos.filter((p) => p.modulo?.fazenda_id === fazendaId)
  const modoEfetivo: ModoPesagem = mostrarToggleModo ? modo : 'CATEGORIA'

  const categoriasExibidas =
    modoEfetivo === 'PASTO'
      ? distribuicao
          .filter((d) => d.pasto_id === pastoId)
          .map((d) => ({ id: d.categoria_id, nome: d.categoria_nome, quantidade: d.quantidade }))
      : categorias
          .map((c) => ({
            id: c.id,
            nome: c.nome,
            quantidade: distribuicao.filter((d) => d.categoria_id === c.id).reduce((s, d) => s + d.quantidade, 0),
          }))
          .filter((c) => c.quantidade > 0)

  async function carregarPesagens() {
    setLoading(true)
    const { data: rows, error } = await supabase
      .from('pesagens')
      .select(
        'id, data, peso_medio_kg, observacao, fazenda:fazendas!fazenda_id(nome), categoria:categorias_animal!categoria_id(nome), pasto:pastos!pasto_id(nome)'
      )
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      setErro(error.message)
    } else {
      setPesagens((rows as unknown as Pesagem[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    supabase
      .from('fazendas')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => setFazendas(data || []))
    supabase
      .from('categorias_animal')
      .select('id, nome')
      .eq('ativa', true)
      .order('nome')
      .then(({ data }) => setCategorias(data || []))
    supabase
      .from('pastos')
      .select('id, modulo_id, nome, ativo, modulo:modulos!modulo_id(fazenda_id)')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => setPastos((data as unknown as Pasto[]) || []))
    supabase
      .from('configuracoes')
      .select('controla_pasto')
      .single()
      .then(({ data }) => setControlaPasto(data?.controla_pasto ?? false))
    carregarPesagens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // reseta modo/pasto/pesos ao trocar de fazenda
  useEffect(() => {
    setModo('CATEGORIA')
    setPastoId('')
    setPesoPorCategoria({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  useEffect(() => {
    setPesoPorCategoria({})
  }, [modo, pastoId])

  // distribuição atual (fazenda × pasto × categoria) na data — usada tanto
  // pra filtrar as categorias do pasto escolhido (modo PASTO) quanto pra
  // saber em quais pastos uma categoria está, na hora de gravar em lote
  // no modo CATEGORIA (ver handleSalvar).
  useEffect(() => {
    if (!fazendaId || !data) {
      setDistribuicao([])
      return
    }
    let cancelado = false
    setLoadingDistribuicao(true)
    supabase
      .rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fazendaId, p_data: data })
      .then(({ data: rows, error }) => {
        if (cancelado) return
        setDistribuicao(error ? [] : rows || [])
        setLoadingDistribuicao(false)
      })
    return () => {
      cancelado = true
    }
  }, [fazendaId, data, supabase])

  function atualizarPeso(categoriaId: string, valor: string) {
    setPesoPorCategoria((prev) => ({ ...prev, [categoriaId]: valor }))
  }

  async function handleSalvar() {
    if (!fazendaId || !data) return
    if (modoEfetivo === 'PASTO' && !pastoId) return

    const entradas = Object.entries(pesoPorCategoria).filter(([, v]) => v.trim() !== '')
    if (entradas.length === 0) return

    if (entradas.some(([, v]) => !pesoValido(v))) {
      alert('Peso médio precisa ser um número maior que zero.')
      return
    }

    const registros: {
      fazenda_id: string
      categoria_id: string
      pasto_id: string
      data: string
      peso_medio_kg: number
      observacao: string | null
    }[] = []

    for (const [categoriaId, pesoStr] of entradas) {
      const peso = parseFloat(pesoStr)
      const obs = observacao.trim() || null

      if (modoEfetivo === 'PASTO') {
        registros.push({ fazenda_id: fazendaId, categoria_id: categoriaId, pasto_id: pastoId, data, peso_medio_kg: peso, observacao: obs })
      } else {
        // categoria mode: grava o mesmo peso em todos os pastos onde essa
        // categoria está nessa data — só aparecem categorias com saldo
        // (ver categoriasExibidas), então sempre há pelo menos um pasto.
        const pastosComCategoria = distribuicao.filter((d) => d.categoria_id === categoriaId).map((d) => d.pasto_id)
        for (const pId of pastosComCategoria) {
          registros.push({ fazenda_id: fazendaId, categoria_id: categoriaId, pasto_id: pId, data, peso_medio_kg: peso, observacao: obs })
        }
      }
    }

    if (registros.length === 0) return

    setSalvando(true)
    const { error } = await supabase.from('pesagens').insert(registros)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setPesoPorCategoria({})
      setObservacao('')
      await carregarPesagens()
    }
    setSalvando(false)
  }

  async function handleExcluir(id: string) {
    setExcluindoId(id)
    const { error } = await supabase.from('pesagens').delete().eq('id', id)
    if (error) {
      alert('Erro ao excluir: ' + error.message)
    } else {
      await carregarPesagens()
    }
    setConfirmandoExclusaoId(null)
    setExcluindoId(null)
  }

  const valoresPreenchidos = Object.values(pesoPorCategoria).filter((v) => v.trim() !== '')
  const podeSalvar =
    !!fazendaId &&
    !!data &&
    (modoEfetivo !== 'PASTO' || !!pastoId) &&
    valoresPreenchidos.length > 0 &&
    valoresPreenchidos.every(pesoValido)

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Pesagens</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Atribuição periódica de peso médio — alimenta o peso médio usado nos relatórios (ex.: Rebanho por pasto)
        até a próxima pesagem.
      </p>

      <div className="mt-6 space-y-4 rounded-card border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-text-primary">Nova pesagem</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Data
              <Required />
            </label>
            <input
              type="date"
              max={hoje}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Fazenda
              <Required />
            </label>
            <select
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={fazendaId}
              onChange={(e) => setFazendaId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {fazendas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        {fazendaId && mostrarToggleModo && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Tipo de pesagem</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModo('CATEGORIA')}
                className={`rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
                  modo === 'CATEGORIA'
                    ? 'border-brand-500 bg-brand-100 text-brand-700'
                    : 'border-border text-text-secondary'
                }`}
              >
                Por categoria
              </button>
              <button
                type="button"
                onClick={() => setModo('PASTO')}
                className={`rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
                  modo === 'PASTO' ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
                }`}
              >
                Por pasto
              </button>
            </div>
            {modo === 'CATEGORIA' && (
              <p className="mt-1.5 text-xs text-text-muted">
                O peso digitado é gravado em todos os pastos onde a categoria está nessa data.
              </p>
            )}
          </div>
        )}

        {fazendaId && modoEfetivo === 'PASTO' && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Pasto
              <Required />
            </label>
            <select
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={pastoId}
              onChange={(e) => setPastoId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {pastosDaFazenda.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {fazendaId && (modoEfetivo === 'CATEGORIA' || pastoId) && (
          <div>
            {loadingDistribuicao ? (
              <div className="animate-pulse h-24 rounded-control bg-border" />
            ) : categoriasExibidas.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {modoEfetivo === 'PASTO' ? 'Nenhuma categoria com rebanho nesse pasto nessa data.' : 'Nenhuma categoria cadastrada.'}
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border p-2 text-left font-medium text-text-secondary">Categoria</th>
                    <th className="border-b border-border p-2 text-right font-medium text-text-secondary">Quantidade</th>
                    <th className="border-b border-border p-2 text-right font-medium text-text-secondary">Peso médio (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriasExibidas.map((c) => {
                    const valor = pesoPorCategoria[c.id] || ''
                    const invalido = valor.trim() !== '' && !pesoValido(valor)
                    return (
                      <tr key={c.id}>
                        <td className="border-b border-border p-2 text-text-primary">{c.nome}</td>
                        <td className="border-b border-border p-2 text-right tabular-nums text-text-secondary">
                          {c.quantidade ? formatQuantidade(c.quantidade) : '—'}
                        </td>
                        <td className="border-b border-border p-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            className={`w-28 rounded-control border bg-surface px-2 py-1 text-right text-sm text-text-primary outline-none focus:border-brand-500 ${
                              invalido ? 'border-error' : 'border-border'
                            }`}
                            value={valor}
                            onChange={(e) => atualizarPeso(c.id, e.target.value)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {fazendaId && (modoEfetivo === 'CATEGORIA' || pastoId) && categoriasExibidas.length > 0 && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Observação</label>
            <textarea
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
            />
          </div>
        )}

        <button
          type="button"
          disabled={salvando || !podeSalvar}
          onClick={handleSalvar}
          className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar pesagens'}
        </button>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-text-primary">Pesagens recentes</h2>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : erro ? (
        <p className="text-sm text-error">Erro: {erro}</p>
      ) : pesagens.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Nenhuma pesagem registrada ainda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Lance a primeira pesagem acima para começar a alimentar o peso médio dos relatórios.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pesagens.map((p) => (
            <div key={p.id} className="rounded-card border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-text-primary">
                    {p.categoria?.nome ?? '—'} · {formatPeso(p.peso_medio_kg)} kg
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">
                    {p.fazenda?.nome ?? '—'}
                    {p.pasto?.nome && p.pasto.nome !== 'Geral' ? ` · ${p.pasto.nome}` : ''} · {p.data}
                  </div>
                  {p.observacao && <div className="mt-1 text-sm text-text-muted italic">{p.observacao}</div>}
                </div>
                {confirmandoExclusaoId === p.id ? (
                  <div className="flex shrink-0 items-center gap-2 rounded-control border border-warning bg-warning-bg px-3 py-1.5">
                    <span className="text-xs text-text-primary">Excluir esta pesagem?</span>
                    <button
                      type="button"
                      disabled={excluindoId === p.id}
                      className="text-xs font-semibold text-error underline disabled:opacity-50"
                      onClick={() => handleExcluir(p.id)}
                    >
                      {excluindoId === p.id ? 'Excluindo...' : 'Sim'}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-text-secondary underline"
                      onClick={() => setConfirmandoExclusaoId(null)}
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-text-secondary underline"
                    onClick={() => setConfirmandoExclusaoId(p.id)}
                  >
                    Excluir
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
