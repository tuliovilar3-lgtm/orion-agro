'use client'

// modal "Movimentação de Lotes" — aberto ao arrastar um selo de um pasto pra outro no mapa de
// distribuição do rebanho (ver MapaDistribuicaoRebanho, prop onArrastarPasto). Reaproveita a
// mesma lógica de gravação já usada em app/controle-pasto/page.tsx (mesmo tipo MUDANCA_PASTO,
// mesmo formato de payload, mesma trigger de saldo no banco) — é só uma porta de entrada mais
// rápida pro mesmo lançamento, sem abrir mão de nenhuma validação já existente. Só cobre
// lançamento NOVO (nunca edição), então não precisa da checagem de trajetória que a tela cheia
// usa pra reabrir um lançamento já existente.
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade, formatPeso } from '@/lib/format'
import { formatarDataBr } from '@/components/relatorios/tipos'

type Modulo = { id: string; fazenda_id: string; nome: string; ativo: boolean; ordem: number }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }
type Proprietario = { id: string; nome: string }

type LinhaLote = {
  categoriaId: string
  categoriaNome: string
  quantidadeDisponivel: number
  quantidade: string
  pesoAtual: number | null
  pesoNovo: string
  pesoEditavel: boolean
  proprietarioId: string
}

function IconEditar() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="M15 5l4 4" />
    </svg>
  )
}

export default function MovimentacaoLotesModal({
  fazendaId,
  pastoOrigemId,
  pastoOrigemNome,
  pastoDestinoSugeridoId,
  onClose,
  onSalvo,
}: {
  fazendaId: string
  pastoOrigemId: string
  pastoOrigemNome: string
  pastoDestinoSugeridoId: string
  onClose: () => void
  onSalvo: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [pastos, setPastos] = useState<Pasto[]>([])
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
  const [linhas, setLinhas] = useState<LinhaLote[]>([])

  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [dataEditavel, setDataEditavel] = useState(false)
  const [moverTudo, setMoverTudo] = useState(true)
  const [pastoDestinoId, setPastoDestinoId] = useState(pastoDestinoSugeridoId)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const modulosDaFazenda = modulos.filter((m) => m.fazenda_id === fazendaId)
  const pastosDaFazenda = pastos.filter((p) => p.modulo?.fazenda_id === fazendaId && p.id !== pastoOrigemId)

  // mesma regra já usada em Movimentações/Mudança de Pasto/Saldo Inicial: 0 cadastrados bloqueia
  // o lançamento, 1 é atribuído sozinho sem seletor, 2+ exige escolha por linha
  const mostrarSeletorProprietario = proprietarios.length > 1
  const bloqueadoPorSemProprietario = proprietarios.length === 0

  function resolverProprietarioId(escolhidoId: string) {
    if (proprietarios.length === 1) return proprietarios[0].id
    return escolhidoId || null
  }

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      const [{ data: mods }, { data: pst }, { data: prop }, { data: linhasRaw }] = await Promise.all([
        supabase.from('modulos').select('id, fazenda_id, nome, ativo, ordem').eq('ativo', true).order('ordem'),
        supabase
          .from('pastos')
          .select('id, modulo_id, nome, ativo, modulo:modulos!modulo_id(fazenda_id)')
          .eq('ativo', true)
          .order('nome'),
        supabase.from('pessoa_papeis').select('pessoa:pessoas!pessoa_id(id, nome)').eq('papel', 'PROPRIETARIO'),
        supabase.rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fazendaId, p_data: hoje }),
      ])
      if (cancelado) return
      setModulos(mods || [])
      setPastos((pst as unknown as Pasto[]) || [])
      setProprietarios(
        ((prop || []) as any[])
          .map((r) => r.pessoa)
          .filter(Boolean)
          .sort((a: Proprietario, b: Proprietario) => a.nome.localeCompare(b.nome))
      )
      const linhasPasto = ((linhasRaw || []) as any[]).filter((l) => l.pasto_id === pastoOrigemId)
      setLinhas(
        linhasPasto.map((l) => ({
          categoriaId: l.categoria_id,
          categoriaNome: l.categoria_nome,
          quantidadeDisponivel: l.quantidade,
          quantidade: String(l.quantidade),
          pesoAtual: l.peso_medio_kg,
          pesoNovo: '',
          pesoEditavel: false,
          proprietarioId: '',
        }))
      )
      setCarregando(false)
    }
    carregar()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, pastoOrigemId])

  function atualizarLinha(categoriaId: string, patch: Partial<LinhaLote>) {
    setLinhas((prev) => prev.map((l) => (l.categoriaId === categoriaId ? { ...l, ...patch } : l)))
  }

  function removerLinha(categoriaId: string) {
    setLinhas((prev) => prev.filter((l) => l.categoriaId !== categoriaId))
  }

  async function handleAvancar() {
    setErro(null)
    if (!data) {
      setErro('Informe a data.')
      return
    }
    if (!pastoDestinoId || pastoDestinoId === pastoOrigemId) {
      setErro('Selecione um pasto de destino diferente do de origem.')
      return
    }
    if (linhas.length === 0) {
      setErro('Nenhuma categoria pra mover — remova a linha errada ou cancele.')
      return
    }
    if (bloqueadoPorSemProprietario) {
      setErro('Nenhum proprietário cadastrado ainda — cadastre pelo menos um em Pessoas e Empresas.')
      return
    }
    if (!moverTudo) {
      for (const l of linhas) {
        const q = parseInt(l.quantidade, 10)
        if (!Number.isFinite(q) || q <= 0 || q > l.quantidadeDisponivel) {
          setErro(`Quantidade inválida para "${l.categoriaNome}" (disponível: ${l.quantidadeDisponivel}).`)
          return
        }
      }
    }
    if (mostrarSeletorProprietario && linhas.some((l) => !l.proprietarioId)) {
      setErro('Selecione o proprietário em todas as categorias.')
      return
    }

    setSalvando(true)
    const grupoId = linhas.length > 1 ? crypto.randomUUID() : null
    const payloads = linhas.map((l) => ({
      data,
      tipo: 'MUDANCA_PASTO',
      fazenda_id: fazendaId,
      fazenda_origem_id: null,
      fazenda_destino_id: null,
      categoria_id: l.categoriaId,
      categoria_destino_id: null,
      quantidade: moverTudo ? l.quantidadeDisponivel : parseInt(l.quantidade, 10),
      // opcional — se não informado, o lote continua com o último peso conhecido, mesmo
      // princípio já usado em Mudança de Pasto (peso_total_kg é sempre derivado no banco)
      peso_medio_kg: l.pesoEditavel && l.pesoNovo ? parseFloat(l.pesoNovo) : null,
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
      pasto_id: pastoOrigemId,
      pasto_destino_id: pastoDestinoId,
      proprietario_id: resolverProprietarioId(l.proprietarioId),
      observacao: null,
      grupo_lancamento_id: grupoId,
    }))

    const { error } = await supabase.from('movimentacoes_rebanho').insert(payloads)
    setSalvando(false)
    if (error) {
      setErro(error.message)
      return
    }
    onSalvo()
  }

  return (
    // z-[1100]: os controles internos do Leaflet chegam a z-index 1000 (ver leaflet.css) — um
    // z-50 comum fica por baixo deles mesmo com `isolate` no wrapper do mapa, então esse modal
    // (sempre aberto por cima de um mapa) precisa de um z-index bem acima desse teto
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-text-primary">Movimentação de Lotes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-text-secondary hover:bg-bg"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {carregando ? (
          <div className="mt-6 animate-pulse space-y-3">
            <div className="h-4 w-2/3 rounded bg-border" />
            <div className="h-24 rounded bg-border" />
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Data</label>
                {dataEditavel ? (
                  <input
                    type="date"
                    max={hoje}
                    autoFocus
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                    onBlur={() => setDataEditavel(false)}
                  />
                ) : (
                  <div className="flex items-center gap-2 rounded-control border border-border bg-bg px-3 py-2 text-sm text-text-primary">
                    <span className="flex-1">{formatarDataBr(data)}</span>
                    <button
                      type="button"
                      onClick={() => setDataEditavel(true)}
                      className="shrink-0 text-text-secondary hover:text-brand-500"
                      title="Editar data"
                    >
                      <IconEditar />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Mover todo o lote?</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMoverTudo(true)}
                    className={`flex-1 rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
                      moverTudo ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
                    }`}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoverTudo(false)}
                    className={`flex-1 rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
                      !moverTudo ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-border text-text-secondary'
                    }`}
                  >
                    Não
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Pasto de saída</label>
                <div className="rounded-control border border-border bg-bg px-3 py-2 text-sm text-text-secondary">
                  {pastoOrigemNome}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Pasto de entrada
                  <Required />
                </label>
                <select
                  className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={pastoDestinoId}
                  onChange={(e) => setPastoDestinoId(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {modulosDaFazenda.map((m) => {
                    const pastosDoModulo = pastosDaFazenda.filter((p) => p.modulo_id === m.id)
                    if (pastosDoModulo.length === 0) return null
                    return (
                      <optgroup key={m.id} label={m.nome}>
                        {pastosDoModulo.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>
            </div>

            {bloqueadoPorSemProprietario && (
              <div className="mt-4 rounded-control border border-error bg-error-bg px-4 py-3 text-sm text-error">
                Nenhum proprietário cadastrado ainda — todo animal precisa ter um dono atribuído. Cadastre pelo menos
                um proprietário antes de mover este lote.
              </div>
            )}

            <div className="mt-4">
              <div className="mb-2 text-sm font-medium text-text-secondary">Categorias</div>
              {linhas.length === 0 ? (
                <p className="text-sm text-text-muted">Sem rebanho nesse pasto.</p>
              ) : (
                <div className="space-y-2">
                  {linhas.map((l) => (
                    <div key={l.categoriaId} className="rounded-control border border-border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-medium text-text-primary">{l.categoriaNome}</span>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-error underline"
                          onClick={() => removerLinha(l.categoriaId)}
                        >
                          Remover
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs text-text-secondary">Quantidade</label>
                          {moverTudo ? (
                            <div className="rounded-control border border-border bg-bg px-2 py-1.5 text-sm tabular-nums text-text-secondary">
                              {formatQuantidade(l.quantidadeDisponivel)} (todo o lote)
                            </div>
                          ) : (
                            <>
                              <input
                                type="number"
                                min="1"
                                max={l.quantidadeDisponivel}
                                step="1"
                                className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500"
                                value={l.quantidade}
                                onChange={(e) => atualizarLinha(l.categoriaId, { quantidade: e.target.value })}
                              />
                              <p className="mt-1 text-xs text-text-secondary">
                                Disponível: {formatQuantidade(l.quantidadeDisponivel)}
                              </p>
                            </>
                          )}
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-text-secondary">Peso médio (kg)</label>
                          {l.pesoEditavel ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              autoFocus
                              className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500"
                              value={l.pesoNovo}
                              onChange={(e) => atualizarLinha(l.categoriaId, { pesoNovo: e.target.value })}
                              onBlur={() => {
                                if (!l.pesoNovo) atualizarLinha(l.categoriaId, { pesoEditavel: false })
                              }}
                            />
                          ) : (
                            <div className="flex items-center gap-2 rounded-control border border-border bg-bg px-2 py-1.5 text-sm text-text-secondary">
                              <span className="flex-1 tabular-nums">
                                {l.pesoAtual != null ? formatPeso(l.pesoAtual) : '—'}
                              </span>
                              <button
                                type="button"
                                onClick={() => atualizarLinha(l.categoriaId, { pesoEditavel: true })}
                                className="shrink-0 text-text-secondary hover:text-brand-500"
                                title="Editar peso"
                              >
                                <IconEditar />
                              </button>
                            </div>
                          )}
                        </div>

                        {mostrarSeletorProprietario && (
                          <div>
                            <label className="mb-1 block text-xs text-text-secondary">
                              Proprietário
                              <Required />
                            </label>
                            <select
                              className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500"
                              value={l.proprietarioId}
                              onChange={(e) => atualizarLinha(l.categoriaId, { proprietarioId: e.target.value })}
                            >
                              <option value="">Selecione...</option>
                              {proprietarios.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nome}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {erro && <div className="mt-4 rounded-control bg-error-bg px-3 py-2 text-sm text-error">{erro}</div>}

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando || linhas.length === 0}
                onClick={handleAvancar}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Avançar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
