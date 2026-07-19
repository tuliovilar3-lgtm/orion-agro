'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatQuantidade, formatPeso } from '@/lib/format'

type Fazenda = { id: string; nome: string; saldo_inicial_confirmado: boolean }
type Categoria = { id: string; nome: string }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }

type LinhaPasto = { categoriaId: string; quantidade: string; pesoMedio: string }

function novaLinhaPasto(): LinhaPasto {
  return { categoriaId: '', quantidade: '', pesoMedio: '' }
}

type Movimentacao = {
  id: string
  data: string
  quantidade: number
  categoria_id: string
  categoria: { nome: string } | null
  fazenda_id: string
  fazenda: { nome: string } | null
  pasto_id: string
  pasto: { nome: string } | null
  pasto_destino_id: string
  pasto_destino: { nome: string } | null
  peso_medio_kg: number | null
  observacao: string | null
  grupo_lancamento_id: string | null
}

type ChecagemEdicao = {
  tem_movimentacoes_futuras: boolean
  saldo_ficaria_negativo: boolean
  data_saldo_negativo: string | null
  categoria_saldo_negativo: string | null
  pasto_saldo_negativo: string | null
  saldo_minimo: number | null
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-48 rounded bg-border" />
      <div className="mt-3 h-3 w-32 rounded bg-border" />
    </div>
  )
}

export default function ControlePastoPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [pastos, setPastos] = useState<Pasto[]>([])
  const [controlaPasto, setControlaPasto] = useState(false)
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [data, setData] = useState('')
  const [fazendaId, setFazendaId] = useState('')
  const [pastoId, setPastoId] = useState('')
  const [pastoDestinoId, setPastoDestinoId] = useState('')
  const [observacao, setObservacao] = useState('')
  const [linhas, setLinhas] = useState<LinhaPasto[]>([novaLinhaPasto()])
  const [saldosLinhas, setSaldosLinhas] = useState<Record<number, number | null>>({})
  const [salvando, setSalvando] = useState(false)

  const [editandoGrupoLinhasOriginais, setEditandoGrupoLinhasOriginais] = useState<Movimentacao[]>([])
  const [avisoEdicaoFutura, setAvisoEdicaoFutura] = useState<{
    payloads: Record<string, unknown>[]
    idsAntigos: string[]
    mensagem: string
  } | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const estaEditando = editandoGrupoLinhasOriginais.length > 0
  const pastosOrigemDisponiveis = pastos.filter((p) => p.modulo?.fazenda_id === fazendaId)
  const bloqueadoPorPastoInsuficiente = !!fazendaId && (!controlaPasto || pastosOrigemDisponiveis.length < 2)
  const pastosDestinoDisponiveis = pastosOrigemDisponiveis.filter((p) => p.id !== pastoId)

  const fazendaSelecionada = fazendas.find((f) => f.id === fazendaId)
  const bloqueadoPorSaldoInicial = !estaEditando && !!fazendaSelecionada && !fazendaSelecionada.saldo_inicial_confirmado

  async function carregarAuxiliares() {
    const [{ data: f }, { data: c }, { data: p }, { data: cfg }] = await Promise.all([
      supabase.from('fazendas').select('id, nome, saldo_inicial_confirmado').eq('ativo', true).order('nome'),
      supabase.from('categorias_animal').select('id, nome').eq('ativa', true).order('nome'),
      supabase
        .from('pastos')
        .select('id, modulo_id, nome, ativo, modulo:modulos!modulo_id(fazenda_id)')
        .eq('ativo', true)
        .order('nome'),
      supabase.from('configuracoes').select('controla_pasto').single(),
    ])
    setFazendas(f || [])
    setCategorias(c || [])
    setPastos((p as unknown as Pasto[]) || [])
    setControlaPasto(cfg?.controla_pasto ?? false)
  }

  async function carregarMovimentacoes() {
    setLoading(true)
    const { data: rows, error } = await supabase
      .from('movimentacoes_rebanho')
      .select(
        `
        id, data, quantidade, categoria_id, fazenda_id, pasto_id, pasto_destino_id, peso_medio_kg, observacao, grupo_lancamento_id,
        categoria:categorias_animal!categoria_id(nome),
        fazenda:fazendas!fazenda_id(nome),
        pasto:pastos!pasto_id(nome),
        pasto_destino:pastos!pasto_destino_id(nome)
      `
      )
      .eq('tipo', 'MUDANCA_PASTO')
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      setErro(error.message)
    } else {
      setMovimentacoes((rows as unknown as Movimentacao[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    carregarAuxiliares()
    carregarMovimentacoes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // trocar de fazenda invalida o pasto de origem/destino escolhidos
  useEffect(() => {
    setPastoId('')
    setPastoDestinoId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  useEffect(() => {
    if (pastoDestinoId === pastoId) setPastoDestinoId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastoId])

  // saldo por linha é sempre checado no pasto de origem, já que é de lá
  // que os animais estão saindo — best-effort aqui (preview), quem
  // garante mesmo é a trigger fn_validar_saldo_categoria no banco
  useEffect(() => {
    if (!fazendaId || !pastoId || !data) {
      setSaldosLinhas({})
      return
    }
    let cancelado = false
    Promise.all(
      linhas.map((linha, i) =>
        linha.categoriaId
          ? supabase
              .rpc('fn_saldo_categoria_pasto', {
                p_fazenda_id: fazendaId,
                p_categoria_id: linha.categoriaId,
                p_pasto_id: pastoId,
                p_data: data,
              })
              .then(({ data: saldo, error }) => [i, error ? null : saldo] as const)
          : Promise.resolve([i, null] as const)
      )
    ).then((pares) => {
      if (!cancelado) setSaldosLinhas(Object.fromEntries(pares))
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, pastoId, data, JSON.stringify(linhas.map((l) => l.categoriaId))])

  function limparFormulario() {
    setData('')
    setFazendaId('')
    setPastoId('')
    setPastoDestinoId('')
    setObservacao('')
    setLinhas([novaLinhaPasto()])
    setSaldosLinhas({})
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, novaLinhaPasto()])
  }

  function removerLinha(index: number) {
    setLinhas((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  function atualizarLinha(index: number, patch: Partial<LinhaPasto>) {
    setLinhas((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function iniciarEdicao(rows: Movimentacao[]) {
    const primeira = rows[0]
    setEditandoGrupoLinhasOriginais(rows)
    setData(primeira.data)
    setFazendaId(primeira.fazenda_id)
    setPastoId(primeira.pasto_id)
    setPastoDestinoId(primeira.pasto_destino_id)
    setObservacao(primeira.observacao || '')
    setLinhas(
      rows.map((r) => ({
        categoriaId: r.categoria_id,
        quantidade: String(r.quantidade),
        pesoMedio: r.peso_medio_kg != null ? String(r.peso_medio_kg) : '',
      }))
    )
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() {
    setEditandoGrupoLinhasOriginais([])
    setAvisoEdicaoFutura(null)
    limparFormulario()
  }

  // insere as novas linhas (e, se idsAntigos vier preenchido, apaga as
  // linhas antigas do grupo antes) — mesmo caminho compartilhado entre
  // criar um lançamento novo e salvar a edição de um grupo existente,
  // igual ao padrão já usado em Movimentações
  async function finalizarSalvar(payloads: Record<string, unknown>[], idsAntigos: string[]) {
    setSalvando(true)

    if (idsAntigos.length > 0) {
      const { error: delError } = await supabase.from('movimentacoes_rebanho').delete().in('id', idsAntigos)
      if (delError) {
        alert('Erro ao salvar: ' + delError.message)
        setSalvando(false)
        return
      }
    }

    const { error } = await supabase.from('movimentacoes_rebanho').insert(payloads)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setEditandoGrupoLinhasOriginais([])
      setAvisoEdicaoFutura(null)
      limparFormulario()
      await carregarMovimentacoes()
    }
    setSalvando(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!data || !fazendaId) return

    if (bloqueadoPorPastoInsuficiente) {
      alert('Essa fazenda só tem um pasto ativo — não há como mudar de pasto.')
      return
    }
    if (!pastoId) {
      alert('Selecione o pasto de origem.')
      return
    }
    if (!pastoDestinoId || pastoDestinoId === pastoId) {
      alert('Selecione um pasto de destino diferente do de origem.')
      return
    }

    const linhasIncompletas = linhas.some((l) => (l.categoriaId || l.quantidade) && (!l.categoriaId || !l.quantidade))
    if (linhasIncompletas) {
      alert('Preencha categoria e quantidade em todas as linhas (ou remova a linha incompleta).')
      return
    }
    const linhasValidas = linhas.filter((l) => l.categoriaId && l.quantidade)
    if (linhasValidas.length === 0) return

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i]
      if (!linha.categoriaId || !linha.quantidade) continue
      const saldo = saldosLinhas[i]
      if (saldo != null && parseInt(linha.quantidade, 10) > saldo) {
        alert('Saldo indisponível de uma das categorias selecionadas nesse pasto para a data desejada.')
        return
      }
    }

    const grupoId =
      linhasValidas.length > 1 ? editandoGrupoLinhasOriginais[0]?.grupo_lancamento_id ?? crypto.randomUUID() : null

    const payloads = linhasValidas.map((linha) => ({
      data,
      tipo: 'MUDANCA_PASTO',
      fazenda_id: fazendaId,
      fazenda_origem_id: null,
      fazenda_destino_id: null,
      categoria_id: linha.categoriaId,
      categoria_destino_id: null,
      quantidade: parseInt(linha.quantidade, 10),
      // opcional — se não informado, o lote continua com o último peso
      // conhecido (peso_total_kg é sempre derivado no banco quando
      // peso_medio_kg vem preenchido, ver fn_calcular_peso_total_movimentacao)
      peso_medio_kg: linha.pesoMedio ? parseFloat(linha.pesoMedio) : null,
      peso_total_kg: null,
      peso_morto_kg: null,
      rendimento_carcaca_pct: null,
      valor_arroba: null,
      valor_cabeca: null,
      valor_kg: null,
      valor_total: null,
      cliente_fornecedor_id: null,
      causa_morte: null,
      subtipo_consumo_doacao: null,
      pasto_id: pastoId,
      pasto_destino_id: pastoDestinoId,
      observacao: observacao.trim() || null,
      grupo_lancamento_id: grupoId,
    }))

    if (!estaEditando) {
      await finalizarSalvar(payloads, [])
      return
    }

    // editando um lançamento existente: checa a trajetória de cada linha
    // antiga (mesma checagem já usada em Movimentações) antes de apagá-las
    setSalvando(true)
    let futuraEncontrada = false
    for (const r of editandoGrupoLinhasOriginais) {
      const { data: check, error: checkError } = await supabase.rpc('fn_checar_edicao_movimentacao', {
        p_id: r.id,
        p_tipo: 'MUDANCA_PASTO',
        p_fazenda_id: r.fazenda_id,
        p_fazenda_origem_id: null,
        p_fazenda_destino_id: null,
        p_categoria_id: r.categoria_id,
        p_categoria_destino_id: null,
        p_pasto_id: r.pasto_id,
        p_pasto_destino_id: r.pasto_destino_id,
        p_data: r.data,
        p_quantidade: r.quantidade,
      })
      if (checkError) {
        alert('Erro ao validar edição: ' + checkError.message)
        setSalvando(false)
        return
      }
      const resultado: ChecagemEdicao | undefined = Array.isArray(check) ? check[0] : check
      if (resultado?.saldo_ficaria_negativo) {
        alert(
          `Não é possível editar: o saldo de ${resultado.categoria_saldo_negativo} no pasto ${resultado.pasto_saldo_negativo} ficaria negativo (${resultado.saldo_minimo}) em ${resultado.data_saldo_negativo}.`
        )
        setSalvando(false)
        return
      }
      if (resultado?.tem_movimentacoes_futuras) futuraEncontrada = true
    }
    setSalvando(false)

    const idsAntigos = editandoGrupoLinhasOriginais.map((r) => r.id)
    if (futuraEncontrada) {
      setAvisoEdicaoFutura({
        payloads,
        idsAntigos,
        mensagem: 'Existem movimentações posteriores dessas categorias. Confirma a edição mesmo assim?',
      })
      return
    }

    await finalizarSalvar(payloads, idsAntigos)
  }

  // agrupa linhas com o mesmo grupo_lancamento_id numa única entrada —
  // lançamentos avulsos (grupo_lancamento_id null) viram um "grupo" de
  // uma linha só, sem mudança visual nenhuma (mesmo padrão de Movimentações)
  type Grupo = { groupId: string | null; movimentacoes: Movimentacao[] }
  const grupos: Grupo[] = []
  {
    const indicePorGrupo = new Map<string, number>()
    movimentacoes.forEach((m) => {
      if (!m.grupo_lancamento_id) {
        grupos.push({ groupId: null, movimentacoes: [m] })
        return
      }
      const idx = indicePorGrupo.get(m.grupo_lancamento_id)
      if (idx === undefined) {
        indicePorGrupo.set(m.grupo_lancamento_id, grupos.length)
        grupos.push({ groupId: m.grupo_lancamento_id, movimentacoes: [m] })
      } else {
        grupos[idx].movimentacoes.push(m)
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Mudança de Pasto</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Lançamento de mudança de pasto do rebanho.{' '}
        <Link href="/relatorio-rebanho-por-pasto" className="font-medium text-brand-500 underline">
          Ver distribuição atual do rebanho por pasto
        </Link>
        .
      </p>

      <form
        onSubmit={handleSubmit}
        onKeyDown={bloquearEnvioPorEnter}
        className="mt-6 space-y-4 rounded-card border border-border bg-surface p-6"
      >
        <h2 className="text-sm font-semibold text-text-primary">
          {estaEditando ? 'Editar mudança de pasto' : 'Lançar mudança de pasto'}
        </h2>

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
              required
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
              required
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

        {bloqueadoPorSaldoInicial && (
          <div className="rounded-control border border-error bg-error-bg px-4 py-3 text-sm text-error">
            {'A fazenda "' + fazendaSelecionada!.nome + '" ainda não teve o saldo inicial preenchido e confirmado.'}{' '}
            Isso precisa ser feito antes de lançar qualquer outra movimentação.{' '}
            <a href="/fazendas" className="font-medium underline">
              Ir para Fazendas
            </a>
          </div>
        )}

        {bloqueadoPorPastoInsuficiente && (
          <div className="rounded-control border border-error bg-error-bg px-4 py-3 text-sm text-error">
            Essa fazenda só tem um pasto ativo — não há como mudar de pasto. Ligue o controle de rebanho por pasto e/ou
            cadastre outro pasto em "Fazendas" primeiro.
          </div>
        )}

        {!!fazendaId && !bloqueadoPorPastoInsuficiente && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Pasto origem
                <Required />
              </label>
              <select
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={pastoId}
                onChange={(e) => setPastoId(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {pastosOrigemDisponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Pasto destino
                <Required />
              </label>
              <select
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={pastoDestinoId}
                onChange={(e) => setPastoDestinoId(e.target.value)}
                disabled={!pastoId}
                required
              >
                <option value="">Selecione...</option>
                {pastosDestinoDisponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {!!fazendaId && !bloqueadoPorPastoInsuficiente && !!pastoId && !!pastoDestinoId && (
          <div className="rounded-control border border-border p-3">
            <div className="mb-2 text-sm font-medium text-text-secondary">
              Categorias
              <Required />
            </div>
            <div className="space-y-2">
              {linhas.map((linha, i) => {
                const saldo = saldosLinhas[i]
                const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : null
                return (
                  <div key={i} className="rounded-control border border-border p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Linha {i + 1}</span>
                      {linhas.length > 1 && (
                        <button
                          type="button"
                          className="text-xs text-error underline"
                          onClick={() => removerLinha(i)}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-xs text-text-secondary">
                          Categoria
                          <Required />
                        </label>
                        <select
                          className="w-full rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
                          value={linha.categoriaId}
                          onChange={(e) => atualizarLinha(i, { categoriaId: e.target.value })}
                        >
                          <option value="">Selecione...</option>
                          {categorias.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-secondary">
                          Quantidade
                          <Required />
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="w-full rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
                          value={linha.quantidade}
                          onChange={(e) => atualizarLinha(i, { quantidade: e.target.value })}
                        />
                        {linha.categoriaId && (
                          <p
                            className={`mt-1 text-xs ${
                              saldo != null && quantidadeNum && quantidadeNum > saldo ? 'text-error' : 'text-text-secondary'
                            }`}
                          >
                            {saldo != null
                              ? `Saldo nesse pasto: ${formatQuantidade(saldo)} cabeça(s)${
                                  quantidadeNum && quantidadeNum > saldo ? ' — saldo indisponível para a data' : ''
                                }`
                              : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="mb-1 block text-xs text-text-secondary">Peso médio (kg) — opcional</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="w-full rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
                        value={linha.pesoMedio}
                        onChange={(e) => atualizarLinha(i, { pesoMedio: e.target.value })}
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        Se não informado, o lote continua com o último peso conhecido.
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
            <button type="button" className="mt-2 text-sm text-brand-500 underline" onClick={adicionarLinha}>
              + Adicionar categoria
            </button>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Observação</label>
          <textarea
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={salvando || bloqueadoPorSaldoInicial || bloqueadoPorPastoInsuficiente}
            className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : estaEditando ? 'Salvar edição' : 'Salvar mudança de pasto'}
          </button>
          {estaEditando && (
            <button
              type="button"
              className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
              onClick={cancelarEdicao}
            >
              Cancelar edição
            </button>
          )}
        </div>
      </form>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-text-primary">Últimas mudanças de pasto</h2>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : erro ? (
        <p className="text-sm text-error">Erro: {erro}</p>
      ) : grupos.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Nenhuma mudança de pasto lançada ainda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Lance a primeira mudança de pasto acima para começar a movimentar o rebanho entre pastos.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map((grupo) => {
            const primeira = grupo.movimentacoes[0]
            const somaQuantidade = grupo.movimentacoes.reduce((s, m) => s + m.quantidade, 0)
            return (
              <div key={grupo.groupId ?? primeira.id} className="rounded-card border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-text-primary">
                      {primeira.fazenda?.nome ?? '—'} · {primeira.pasto?.nome ?? '—'} → {primeira.pasto_destino?.nome ?? '—'}
                    </div>
                    <div className="mt-0.5 text-sm text-text-secondary">{primeira.data}</div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-brand-500 underline"
                    onClick={() => iniciarEdicao(grupo.movimentacoes)}
                  >
                    Editar
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {grupo.movimentacoes.map((m) => (
                    <li key={m.id} className="text-sm text-text-secondary">
                      <span className="font-medium text-text-primary">{m.categoria?.nome ?? '—'}</span> —{' '}
                      {formatQuantidade(m.quantidade)} cab.
                      {m.peso_medio_kg != null ? ` · ${formatPeso(m.peso_medio_kg)} kg/cab` : ''}
                    </li>
                  ))}
                </ul>
                {grupo.movimentacoes.length > 1 && (
                  <div className="mt-1.5 text-sm font-medium text-text-primary">
                    Total: {formatQuantidade(somaQuantidade)} cab.
                  </div>
                )}
                {primeira.observacao && <div className="mt-1 text-sm italic text-text-muted">{primeira.observacao}</div>}
              </div>
            )
          })}
        </div>
      )}

      {avisoEdicaoFutura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">Confirmar edição</h2>
            <p className="text-sm text-text-secondary">{avisoEdicaoFutura.mensagem}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                onClick={() => setAvisoEdicaoFutura(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                onClick={() => finalizarSalvar(avisoEdicaoFutura.payloads, avisoEdicaoFutura.idsAntigos)}
              >
                {salvando ? 'Salvando...' : 'Confirmar edição'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
