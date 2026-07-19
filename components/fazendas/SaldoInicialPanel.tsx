'use client'

import { useEffect, useState } from 'react'
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
  safraNascimento: string
}

type Sexo = 'MACHO' | 'FEMEA'
type GrupoCategoriaPapel = { id: string; nome: string; sexo: Sexo | null }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export default function SaldoInicialPanel({ fazendaId }: { fazendaId: string }) {
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
    if (!mostrarSeletorPasto) {
      const geral = pastosDisponiveis.find((p) => p.nome === 'Geral') || pastosDisponiveis[0]
      setPastoId(geral ? geral.id : '')
    } else if (!pastosDisponiveis.some((p) => p.id === pastoId)) {
      setPastoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarSeletorPasto, pastos])

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
      await carregarLinhas()
    }
    setSalvandoCategoria(false)
  }

  async function carregarLinhas() {
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
        .eq('fazenda_id', fazendaId)
        .eq('tipo', 'SALDO_INICIAL'),
      supabase
        .from('fazendas')
        .select('id, nome, saldo_inicial_confirmado, saldo_inicial_confirmado_em')
        .eq('id', fazendaId)
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
    carregarLinhas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  function atualizarLinha(categoriaId: string, campo: 'quantidade' | 'pesoMedio' | 'safraNascimento', valor: string) {
    setLinhas((prev) => prev.map((l) => (l.categoriaId === categoriaId ? { ...l, [campo]: valor } : l)))
  }

  function handleSalvarClick() {
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

    await carregarLinhas()
    setSalvando(false)
  }

  async function handleConfirmar() {
    setSalvando(true)
    const { error } = await supabase
      .from('fazendas')
      .update({ saldo_inicial_confirmado: true, saldo_inicial_confirmado_em: new Date().toISOString() })
      .eq('id', fazendaId)

    if (error) {
      alert('Erro ao confirmar: ' + error.message)
    } else {
      await carregarLinhas()
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

  const inputClass =
    'rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500'

  return (
    <div>
      <p className="text-sm text-text-secondary">
        Cadastre a quantidade de animais e o peso médio de cada categoria no momento em que a fazenda começou a
        usar o sistema. Depois de confirmado, o saldo inicial ainda pode ser corrigido se necessário, mas cada
        alteração pede uma confirmação extra — e nunca é permitido deixar o estoque negativo em nenhum momento.
      </p>

      <div className="mt-4 flex flex-wrap gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Data de referência</label>
          <input type="date" className={inputClass} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        {mostrarSeletorPasto && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Pasto
              <Required />
            </label>
            <select className={inputClass} value={pastoId} onChange={(e) => setPastoId(e.target.value)}>
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

      {loading ? (
        <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
      ) : (
        <>
          {confirmado && (
            <div className="mt-4 rounded-control border border-success bg-success-bg px-4 py-3 text-sm text-text-primary">
              Saldo inicial confirmado em{' '}
              {fazendaSelecionada?.saldo_inicial_confirmado_em
                ? new Date(fazendaSelecionada.saldo_inicial_confirmado_em).toLocaleString('pt-BR')
                : '—'}
              . Ainda pode ser ajustado, mas cada alteração pede uma confirmação extra.
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="text-sm font-medium text-brand-500 underline"
              onClick={() => setModalCategoriaAberto(true)}
            >
              + Nova categoria
            </button>
          </div>

          <div className="mt-2 overflow-x-auto rounded-card border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="p-2.5 font-medium">Categoria</th>
                  <th className="p-2.5 text-right font-medium">Quantidade</th>
                  <th className="p-2.5 text-right font-medium">Peso médio (kg)</th>
                  <th className="p-2.5 text-right font-medium">Peso total (kg)</th>
                  {existeCategoriaBezerro && <th className="p-2.5 text-left font-medium">Safra do bezerro</th>}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const qtd = parseInt(l.quantidade, 10) || 0
                  const peso = parseFloat(l.pesoMedio) || 0
                  const pesoTotal = qtd && peso ? round2(qtd * peso) : null
                  return (
                    <tr key={l.categoriaId} className="border-b border-border last:border-0">
                      <td className="p-2.5 text-text-primary">{l.categoriaNome}</td>
                      <td className="p-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className={`w-24 text-right ${inputClass}`}
                          value={l.quantidade}
                          onChange={(e) => atualizarLinha(l.categoriaId, 'quantidade', e.target.value)}
                        />
                      </td>
                      <td className="p-2.5 text-right">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          className={`w-24 text-right ${inputClass}`}
                          value={l.pesoMedio}
                          onChange={(e) => atualizarLinha(l.categoriaId, 'pesoMedio', e.target.value)}
                        />
                      </td>
                      <td className="p-2.5 text-right tabular-nums text-text-secondary">
                        {pesoTotal != null ? formatPeso(pesoTotal) : '—'}
                      </td>
                      {existeCategoriaBezerro && (
                        <td className="p-2.5">
                          {l.categoriaEhBezerro && (
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`w-24 ${inputClass}`}
                              value={formatSafraInput(l.safraNascimento || (data ? String(safraSugeridaParaData(data)) : ''))}
                              onChange={(e) =>
                                atualizarLinha(l.categoriaId, 'safraNascimento', extrairAnoSafraDigitado(e.target.value))
                              }
                              onFocus={(e) => e.target.select()}
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
                  <td className="p-2.5 text-text-primary">Total</td>
                  <td className="p-2.5 text-right tabular-nums text-text-primary">{formatQuantidade(totalCabecas)}</td>
                  <td className="p-2.5 text-right tabular-nums text-text-primary">
                    {pesoMedioPonderado != null ? formatPeso(pesoMedioPonderado) : '—'}
                  </td>
                  <td className="p-2.5 text-right tabular-nums text-text-primary">
                    {totalCabecas > 0 ? formatPeso(round2(totalPesoKg)) : '—'}
                  </td>
                  {existeCategoriaBezerro && <td className="p-2.5"></td>}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4 space-y-3">
            {!mostrarAvisoEdicao ? (
              <button
                type="button"
                disabled={salvando}
                onClick={handleSalvarClick}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            ) : (
              <div className="rounded-control border border-warning bg-warning-bg p-3 text-sm">
                <p className="mb-2 text-text-primary">
                  O saldo inicial desta fazenda já foi confirmado. Alterar esses valores agora pode impactar
                  relatórios e apurações que já usaram esses números. O sistema não vai deixar o estoque ficar
                  negativo em nenhum momento, mas confirme que você realmente quer fazer esse ajuste.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-control border border-border px-4 py-2 text-text-primary"
                    onClick={() => setMostrarAvisoEdicao(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={salvando}
                    className="rounded-control bg-warning px-4 py-2 font-semibold text-white disabled:opacity-50"
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
                    className="text-sm text-text-secondary underline"
                    onClick={() => setMostrarConfirmacao(true)}
                  >
                    Confirmar saldo inicial
                  </button>
                </div>
              ) : (
                <div className="rounded-control border border-border bg-bg p-3 text-sm">
                  <p className="mb-2 text-text-primary">
                    Confirma que esse é o saldo inicial correto desta fazenda? Você ainda poderá corrigi-lo depois,
                    mas cada alteração passará a pedir essa mesma confirmação.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-control border border-border px-4 py-2 text-text-primary"
                      onClick={() => setMostrarConfirmacao(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={salvando}
                      className="rounded-control bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={handleCriarCategoria}
            onKeyDown={bloquearEnvioPorEnter}
            className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5"
          >
            <h2 className="text-sm font-semibold text-text-primary">Nova categoria</h2>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Nome
                <Required />
              </label>
              <input
                className={`w-full ${inputClass}`}
                value={novaCategoriaNome}
                onChange={(e) => setNovaCategoriaNome(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Grupo Categoria
                <Required />
              </label>
              <select
                className={`w-full ${inputClass}`}
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
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Sexo
                  <Required />
                </label>
                <select
                  className={`w-full ${inputClass}`}
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
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Era
                  {!isBezerroPapel && <Required />}
                </label>
                {isBezerroPapel ? (
                  <p className="rounded-control border border-border bg-bg px-3 py-2 text-sm text-text-secondary">
                    00-08 (fixo para Bezerros/Bezerras Mamando)
                  </p>
                ) : (
                  <select
                    className={`w-full ${inputClass}`}
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
                  <p className="mt-1 text-xs text-text-muted">
                    Grupo Faixa Etária: {GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]}
                    {FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]
                      ? ` (${FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]})`
                      : ''}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">Peso de referência (kg)</label>
              <input
                type="number"
                step="0.01"
                className={`w-full ${inputClass}`}
                value={novaCategoriaPesoReferencia}
                onChange={(e) => setNovaCategoriaPesoReferencia(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                onClick={() => setModalCategoriaAberto(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoCategoria}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
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
