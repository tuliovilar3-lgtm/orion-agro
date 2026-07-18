'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ERAS, Era, FAIXA_ETARIA_GRUPO, GRUPO_FAIXA_ETARIA_POR_ERA, PAPEIS_BEZERRO_MAMANDO } from '@/lib/faixa-etaria'
import { safraSugeridaParaData, extrairAnoSafraDigitado, formatSafraInput } from '@/lib/periodo'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatQuantidade, formatPeso } from '@/lib/format'

type Fazenda = {
  id: string
  nome: string
  saldo_inicial_confirmado: boolean
  saldo_inicial_confirmado_em: string | null
}

type LinhaSaldo = {
  categoriaId: string
  categoriaNome: string
  categoriaEhBezerro: boolean
  existingId: string | null
  quantidade: string
  pesoMedio: string
  // lote de nascimento (safra) — só se aplica quando a categoria é
  // bezerro. Sugerida a partir da data de referência (regra
  // julho-junho), sempre editável.
  safraNascimento: string
}

type Sexo = 'MACHO' | 'FEMEA'
type GrupoCategoriaPapel = { id: string; nome: string; sexo: Sexo | null }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export default function SaldoInicialPage() {
  return (
    <Suspense fallback={<div className="p-8">Carregando...</div>}>
      <SaldoInicialContent />
    </Suspense>
  )
}

function SaldoInicialContent() {
  const searchParams = useSearchParams()
  const fazendaIdParam = searchParams.get('fazenda')

  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaId, setFazendaId] = useState('')
  const [fazendaSelecionada, setFazendaSelecionada] = useState<Fazenda | null>(null)
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhas, setLinhas] = useState<LinhaSaldo[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false)
  const [mostrarAvisoEdicao, setMostrarAvisoEdicao] = useState(false)

  const [papeis, setPapeis] = useState<GrupoCategoriaPapel[]>([])
  const [modalCategoriaAberto, setModalCategoriaAberto] = useState(false)
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('')
  const [novaCategoriaPapelId, setNovaCategoriaPapelId] = useState('')
  const [novaCategoriaSexo, setNovaCategoriaSexo] = useState<Sexo | ''>('')
  const [novaCategoriaEra, setNovaCategoriaEra] = useState<Era | ''>('')
  const [novaCategoriaPesoReferencia, setNovaCategoriaPesoReferencia] = useState('')
  const [salvandoCategoria, setSalvandoCategoria] = useState(false)

  const [pastos, setPastos] = useState<Pasto[]>([])
  const [controlaPasto, setControlaPasto] = useState(false)
  const [pastoId, setPastoId] = useState('')

  const supabase = createClient()

  const pastosDisponiveis = pastos.filter((p) => p.modulo?.fazenda_id === fazendaId)
  const mostrarSeletorPasto = controlaPasto && pastosDisponiveis.length > 1

  const papelSelecionado = papeis.find((p) => p.id === novaCategoriaPapelId)
  const sexoEhLivre = !!papelSelecionado && papelSelecionado.sexo === null
  const isBezerroPapel = !!papelSelecionado && PAPEIS_BEZERRO_MAMANDO.includes(papelSelecionado.nome)
  const eraEfetiva: Era | '' = isBezerroPapel ? '00-08' : novaCategoriaEra

  useEffect(() => {
    supabase
      .from('fazendas')
      .select('id, nome, saldo_inicial_confirmado, saldo_inicial_confirmado_em')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => {
        setFazendas(data || [])
        if (fazendaIdParam && (data || []).some((f) => f.id === fazendaIdParam)) {
          setFazendaId(fazendaIdParam)
        }
      })
    supabase
      .from('grupos_categoria_papel')
      .select('id, nome, sexo')
      .order('ordem')
      .then(({ data }) => setPapeis(data || []))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setNovaCategoriaSexo('')
    setNovaCategoriaEra('')
  }, [novaCategoriaPapelId])

  // pasto: some pro "Geral" sozinho quando o seletor está escondido
  // (grupo sem controla_pasto, ou só um pasto ativo) — mesmo princípio
  // já usado em Movimentações e Controle de Pasto
  useEffect(() => {
    if (!fazendaId) {
      setPastoId('')
      return
    }
    if (!mostrarSeletorPasto) {
      const geral = pastosDisponiveis.find((p) => p.nome === 'Geral') || pastosDisponiveis[0]
      setPastoId(geral ? geral.id : '')
    } else if (!pastosDisponiveis.some((p) => p.id === pastoId)) {
      setPastoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, mostrarSeletorPasto, pastos])

  async function handleCriarCategoria(e: React.FormEvent) {
    e.preventDefault()
    if (!novaCategoriaNome.trim() || !novaCategoriaPapelId) return
    if (sexoEhLivre && !novaCategoriaSexo) return
    if (!isBezerroPapel && !novaCategoriaEra) return

    setSalvandoCategoria(true)
    const { error } = await supabase.from('categorias_animal').insert({
      nome: novaCategoriaNome.trim(),
      grupo_categoria_papel_id: novaCategoriaPapelId,
      sexo: sexoEhLivre ? novaCategoriaSexo : null,
      era: eraEfetiva,
      peso_referencia_kg: novaCategoriaPesoReferencia ? parseFloat(novaCategoriaPesoReferencia) : null,
    })

    if (error) {
      alert('Erro ao salvar categoria: ' + error.message)
    } else {
      setModalCategoriaAberto(false)
      setNovaCategoriaNome('')
      setNovaCategoriaPapelId('')
      setNovaCategoriaSexo('')
      setNovaCategoriaEra('')
      setNovaCategoriaPesoReferencia('')
      if (fazendaId) await carregarLinhas(fazendaId)
    }
    setSalvandoCategoria(false)
  }

  async function carregarLinhas(fId: string) {
    setLoading(true)
    const [{ data: categorias }, { data: existentes }, { data: fazenda }] = await Promise.all([
      supabase
        .from('categorias_animal')
        .select('id, nome, ordem_ciclo, papel:grupos_categoria_papel(nome)')
        .eq('ativa', true)
        .order('ordem_ciclo')
        .order('nome'),
      supabase
        .from('movimentacoes_rebanho')
        .select('id, categoria_id, quantidade, peso_medio_kg, pasto_id, data, safra_nascimento_ano_inicio')
        .eq('fazenda_id', fId)
        .eq('tipo', 'SALDO_INICIAL'),
      supabase
        .from('fazendas')
        .select('id, nome, saldo_inicial_confirmado, saldo_inicial_confirmado_em')
        .eq('id', fId)
        .single(),
    ])

    setFazendaSelecionada(fazenda || null)

    const mapaExistentes = new Map((existentes || []).map((e) => [e.categoria_id, e]))
    const novasLinhas: LinhaSaldo[] = (categorias || []).map((c) => {
      const existente = mapaExistentes.get(c.id)
      const papelNome = (c as unknown as { papel: { nome: string } | null }).papel?.nome
      return {
        categoriaId: c.id,
        categoriaNome: c.nome,
        categoriaEhBezerro: !!papelNome && PAPEIS_BEZERRO_MAMANDO.includes(papelNome),
        existingId: existente ? existente.id : null,
        quantidade: existente ? String(existente.quantidade) : '',
        pesoMedio: existente && existente.peso_medio_kg != null ? String(existente.peso_medio_kg) : '',
        safraNascimento: existente?.safra_nascimento_ano_inicio != null ? String(existente.safra_nascimento_ano_inicio) : '',
      }
    })
    setLinhas(novasLinhas)

    const primeiraData = (existentes || [])[0]?.data
    if (primeiraData) setData(primeiraData)
    const primeiroPastoId = (existentes || [])[0]?.pasto_id
    if (primeiroPastoId) setPastoId(primeiroPastoId)

    setLoading(false)
  }

  useEffect(() => {
    if (fazendaId) {
      carregarLinhas(fazendaId)
    } else {
      setLinhas([])
      setFazendaSelecionada(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  function atualizarLinha(categoriaId: string, campo: 'quantidade' | 'pesoMedio' | 'safraNascimento', valor: string) {
    setLinhas((prev) => prev.map((l) => (l.categoriaId === categoriaId ? { ...l, [campo]: valor } : l)))
  }

  function handleSalvarClick() {
    if (!fazendaId) return

    const incompletas = linhas.filter((l) => (!!l.quantidade) !== (!!l.pesoMedio))
    if (incompletas.length > 0) {
      alert(
        `Preencha quantidade e peso médio juntos (ou deixe os dois em branco) em: ${incompletas
          .map((l) => l.categoriaNome)
          .join(', ')}`
      )
      return
    }

    if (!pastoId) {
      alert('Selecione o pasto.')
      return
    }

    if (confirmado) {
      setMostrarAvisoEdicao(true)
    } else {
      executarSalvar()
    }
  }

  async function executarSalvar() {
    if (!fazendaId) return

    setMostrarAvisoEdicao(false)
    setSalvando(true)

    for (const linha of linhas) {
      const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : 0
      const pesoMedioNum = linha.pesoMedio ? parseFloat(linha.pesoMedio) : 0
      const linhaCompleta = quantidadeNum > 0 && pesoMedioNum > 0
      const linhaVazia = !linha.quantidade && !linha.pesoMedio

      if (linhaCompleta) {
        const pesoTotal = round2(pesoMedioNum * quantidadeNum)
        const safraNascimento = linha.categoriaEhBezerro
          ? linha.safraNascimento
            ? parseInt(linha.safraNascimento, 10)
            : safraSugeridaParaData(data)
          : null
        if (linha.existingId) {
          await supabase
            .from('movimentacoes_rebanho')
            .update({
              quantidade: quantidadeNum,
              peso_medio_kg: pesoMedioNum,
              peso_total_kg: pesoTotal,
              pasto_id: pastoId,
              data,
              safra_nascimento_ano_inicio: safraNascimento,
            })
            .eq('id', linha.existingId)
        } else {
          await supabase.from('movimentacoes_rebanho').insert({
            fazenda_id: fazendaId,
            categoria_id: linha.categoriaId,
            tipo: 'SALDO_INICIAL',
            data,
            quantidade: quantidadeNum,
            peso_medio_kg: pesoMedioNum,
            peso_total_kg: pesoTotal,
            pasto_id: pastoId,
            safra_nascimento_ano_inicio: safraNascimento,
          })
        }
      } else if (linhaVazia && linha.existingId) {
        await supabase.from('movimentacoes_rebanho').delete().eq('id', linha.existingId)
      }
    }

    await carregarLinhas(fazendaId)
    setSalvando(false)
  }

  async function handleConfirmar() {
    if (!fazendaId) return
    setSalvando(true)
    const { error } = await supabase
      .from('fazendas')
      .update({ saldo_inicial_confirmado: true, saldo_inicial_confirmado_em: new Date().toISOString() })
      .eq('id', fazendaId)

    if (error) {
      alert('Erro ao confirmar: ' + error.message)
    } else {
      await carregarLinhas(fazendaId)
    }
    setMostrarConfirmacao(false)
    setSalvando(false)
  }

  const confirmado = fazendaSelecionada?.saldo_inicial_confirmado ?? false
  const totalCabecas = linhas.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)
  const totalPesoKg = linhas.reduce((s, l) => {
    const qtd = parseInt(l.quantidade, 10) || 0
    const peso = parseFloat(l.pesoMedio) || 0
    return s + qtd * peso
  }, 0)
  const pesoMedioPonderado = totalCabecas > 0 ? round2(totalPesoKg / totalCabecas) : null
  const existeCategoriaBezerro = linhas.some((l) => l.categoriaEhBezerro)

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Saldo inicial</h1>

      {fazendaIdParam && fazendaId === fazendaIdParam && (
        <div className="border border-blue-400 bg-blue-50 rounded p-3 text-sm text-blue-800 mb-4">
          Fazenda cadastrada com sucesso. Antes de lançar qualquer movimentação, preencha e confirme o saldo
          inicial dela abaixo.
        </div>
      )}

      <p className="text-sm text-gray-600 mb-6">
        Cadastre a quantidade de animais e o peso médio de cada categoria no momento em que a fazenda começou a
        usar o sistema. Depois de confirmado, o saldo inicial ainda pode ser corrigido se necessário, mas cada
        alteração pede uma confirmação extra — e nunca é permitido deixar o estoque negativo em nenhum momento.
      </p>

      <div className="flex flex-wrap gap-4 mb-6 border p-4 rounded">
        <div>
          <label className="block text-sm mb-1">
            Fazenda
            <Required />
          </label>
          <select
            className="border rounded px-3 py-2"
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
        <div>
          <label className="block text-sm mb-1">Data de referência</label>
          <input
            type="date"
            className="border rounded px-3 py-2"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        {mostrarSeletorPasto && (
          <div>
            <label className="block text-sm mb-1">
              Pasto
              <Required />
            </label>
            <select
              className="border rounded px-3 py-2"
              value={pastoId}
              onChange={(e) => setPastoId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {pastosDisponiveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!fazendaId ? (
        <p className="text-gray-500">Selecione uma fazenda.</p>
      ) : loading ? (
        <p>Carregando...</p>
      ) : (
        <>
          {confirmado && (
            <div className="border border-green-400 bg-green-50 rounded p-3 text-sm text-green-800 mb-4">
              Saldo inicial confirmado em{' '}
              {fazendaSelecionada?.saldo_inicial_confirmado_em
                ? new Date(fazendaSelecionada.saldo_inicial_confirmado_em).toLocaleString('pt-BR')
                : '—'}
              . Ainda pode ser ajustado, mas cada alteração pede uma confirmação extra.
            </div>
          )}

          <div className="flex justify-end mb-2">
            <button
              type="button"
              className="text-sm text-blue-600 underline"
              onClick={() => setModalCategoriaAberto(true)}
            >
              + Nova categoria
            </button>
          </div>

          <table className="text-sm border-collapse w-full mb-4">
            <thead>
              <tr>
                <th className="border p-2 text-left">Categoria</th>
                <th className="border p-2 text-right">Quantidade</th>
                <th className="border p-2 text-right">Peso médio (kg)</th>
                <th className="border p-2 text-right">Peso total (kg)</th>
                {existeCategoriaBezerro && <th className="border p-2 text-left">Safra do bezerro</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const qtd = parseInt(l.quantidade, 10) || 0
                const peso = parseFloat(l.pesoMedio) || 0
                const pesoTotal = qtd && peso ? round2(qtd * peso) : null
                return (
                  <tr key={l.categoriaId}>
                    <td className="border p-2">{l.categoriaNome}</td>
                    <td className="border p-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="border rounded px-2 py-1 w-24 text-right"
                        value={l.quantidade}
                        onChange={(e) => atualizarLinha(l.categoriaId, 'quantidade', e.target.value)}
                      />
                    </td>
                    <td className="border p-2 text-right">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="border rounded px-2 py-1 w-24 text-right"
                        value={l.pesoMedio}
                        onChange={(e) => atualizarLinha(l.categoriaId, 'pesoMedio', e.target.value)}
                      />
                    </td>
                    <td className="border p-2 text-right text-gray-500">
                      {pesoTotal != null ? formatPeso(pesoTotal) : '—'}
                    </td>
                    {existeCategoriaBezerro && (
                      <td className="border p-2">
                        {l.categoriaEhBezerro && (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="border rounded px-2 py-1 w-24"
                            value={formatSafraInput(l.safraNascimento || (data ? String(safraSugeridaParaData(data)) : ''))}
                            onChange={(e) => atualizarLinha(l.categoriaId, 'safraNascimento', extrairAnoSafraDigitado(e.target.value))}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border p-2">Total</td>
                <td className="border p-2 text-right">{formatQuantidade(totalCabecas)}</td>
                <td className="border p-2 text-right">
                  {pesoMedioPonderado != null ? formatPeso(pesoMedioPonderado) : '—'}
                </td>
                <td className="border p-2 text-right">
                  {totalCabecas > 0 ? formatPeso(round2(totalPesoKg)) : '—'}
                </td>
                {existeCategoriaBezerro && <td className="border p-2"></td>}
              </tr>
            </tfoot>
          </table>

          <div className="space-y-3">
            {!mostrarAvisoEdicao ? (
              <button
                type="button"
                disabled={salvando}
                onClick={handleSalvarClick}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            ) : (
              <div className="border border-amber-400 bg-amber-50 rounded p-3 text-sm">
                <p className="text-amber-800 mb-2">
                  O saldo inicial desta fazenda já foi confirmado. Alterar esses valores agora pode impactar
                  relatórios e apurações que já usaram esses números. O sistema não vai deixar o estoque ficar
                  negativo em nenhum momento, mas confirme que você realmente quer fazer esse ajuste.
                </p>
                <div className="flex gap-2">
                  <button type="button" className="px-4 py-2 rounded border" onClick={() => setMostrarAvisoEdicao(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={salvando}
                    className="bg-amber-600 text-white px-4 py-2 rounded disabled:opacity-50"
                    onClick={executarSalvar}
                  >
                    Sim, ajustar saldo inicial
                  </button>
                </div>
              </div>
            )}

            {!confirmado &&
              (!mostrarConfirmacao ? (
                <div>
                  <button
                    type="button"
                    className="text-sm text-gray-600 underline"
                    onClick={() => setMostrarConfirmacao(true)}
                  >
                    Confirmar saldo inicial
                  </button>
                </div>
              ) : (
                <div className="border border-gray-400 bg-gray-50 rounded p-3 text-sm">
                  <p className="text-gray-800 mb-2">
                    Confirma que esse é o saldo inicial correto desta fazenda? Você ainda poderá corrigi-lo depois,
                    mas cada alteração passará a pedir essa mesma confirmação.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-4 py-2 rounded border"
                      onClick={() => setMostrarConfirmacao(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={salvando}
                      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
                      onClick={handleConfirmar}
                    >
                      Sim, confirmar saldo inicial
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {modalCategoriaAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
            onSubmit={handleCriarCategoria}
            onKeyDown={bloquearEnvioPorEnter}
            className="bg-white p-4 rounded w-full max-w-sm space-y-3"
          >
            <h2 className="font-semibold">Nova categoria</h2>
            <div>
              <label className="block text-sm mb-1">
                Nome
                <Required />
              </label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={novaCategoriaNome}
                onChange={(e) => setNovaCategoriaNome(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1">
                Grupo Categoria
                <Required />
              </label>
              <select
                className="border rounded px-3 py-2 w-full"
                value={novaCategoriaPapelId}
                onChange={(e) => setNovaCategoriaPapelId(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {papeis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.sexo ? ` (${p.sexo === 'MACHO' ? 'Macho' : 'Fêmea'})` : ' (sexo livre)'}
                  </option>
                ))}
              </select>
            </div>

            {sexoEhLivre && (
              <div>
                <label className="block text-sm mb-1">
                  Sexo
                  <Required />
                </label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={novaCategoriaSexo}
                  onChange={(e) => setNovaCategoriaSexo(e.target.value as Sexo)}
                  required
                >
                  <option value="">Selecione...</option>
                  <option value="MACHO">Macho</option>
                  <option value="FEMEA">Fêmea</option>
                </select>
              </div>
            )}

            {novaCategoriaPapelId && (
              <div>
                <label className="block text-sm mb-1">
                  Era
                  {!isBezerroPapel && <Required />}
                </label>
                {isBezerroPapel ? (
                  <p className="text-sm text-gray-600 border rounded px-3 py-2 bg-gray-50">
                    00-08 (fixo para Bezerros/Bezerras Mamando)
                  </p>
                ) : (
                  <select
                    className="border rounded px-3 py-2 w-full"
                    value={novaCategoriaEra}
                    onChange={(e) => setNovaCategoriaEra(e.target.value as Era)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {ERAS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                )}
                {eraEfetiva && (
                  <p className="text-xs text-gray-500 mt-1">
                    Grupo Faixa Etária: {GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]}
                    {FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]
                      ? ` (${FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]})`
                      : ''}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm mb-1">Peso de referência (kg)</label>
              <input
                type="number"
                step="0.01"
                className="border rounded px-3 py-2 w-full"
                value={novaCategoriaPesoReferencia}
                onChange={(e) => setNovaCategoriaPesoReferencia(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={() => setModalCategoriaAberto(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoCategoria}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {salvandoCategoria ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
