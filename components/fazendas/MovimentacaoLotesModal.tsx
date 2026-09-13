'use client'

// modal "Mudança de Pasto" (nome interno do arquivo/componente ficou como
// MovimentacaoLotesModal por já estar em uso — só o título visível mudou) — aberto tanto ao
// arrastar um selo de um pasto pra outro no mapa de distribuição do rebanho (ver
// MapaDistribuicaoRebanho, prop onArrastarPasto) quanto pelo botão "Mudança de Pasto" do
// DetalhePastoModal (nesse caso sem destino sugerido — o usuário escolhe no seletor). Reaproveita
// a mesma lógica de gravação já usada em app/controle-pasto/page.tsx (mesmo tipo MUDANCA_PASTO,
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
  chave: string // categoriaId + proprietarioId — categoria sozinha não é mais única quando dividida
  categoriaId: string
  categoriaNome: string
  quantidadeDisponivel: number
  quantidade: string
  pesoAtual: number | null
  pesoNovo: string
  pesoEditavel: boolean
  proprietarioId: string
  // nome pra exibir na linha quando a categoria está de fato dividida entre 2+ donos nesse
  // pasto (null = não dividida, não precisa rotular) — "Sem proprietário" quando é o resto não
  // atribuído a nenhum dono conhecido
  proprietarioNome: string | null
  // true só pro "resto sem proprietário" de uma categoria dividida, quando a conta já tem 2+
  // proprietários cadastrados — precisa de escolha explícita antes de mover (mesmo princípio já
  // usado nas outras telas pra lote sem dono atribuído)
  precisaEscolherProprietario: boolean
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
  // o lançamento, 1 é atribuído sozinho sem seletor. Diferente das outras telas, com 2+
  // proprietários o dono de cada linha já vem resolvido pelo saldo real do pasto (ver
  // montarLinhas abaixo) — só precisa de escolha explícita quando sobra um resto sem dono
  // conhecido (linha.precisaEscolherProprietario).
  const bloqueadoPorSemProprietario = proprietarios.length === 0

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      const [{ data: mods }, { data: pst }, { data: prop }] = await Promise.all([
        supabase.from('modulos').select('id, fazenda_id, nome, ativo, ordem').eq('ativo', true).order('ordem'),
        supabase
          .from('pastos')
          .select('id, modulo_id, nome, ativo, modulo:modulos!modulo_id(fazenda_id)')
          .eq('ativo', true)
          .order('nome'),
        supabase.from('pessoa_papeis').select('pessoa:pessoas!pessoa_id(id, nome)').eq('papel', 'PROPRIETARIO'),
      ])
      if (cancelado) return
      const proprietariosCarregados: Proprietario[] = ((prop || []) as any[])
        .map((r) => r.pessoa)
        .filter(Boolean)
        .sort((a: Proprietario, b: Proprietario) => a.nome.localeCompare(b.nome))
      setModulos(mods || [])
      setPastos((pst as unknown as Pasto[]) || [])
      setProprietarios(proprietariosCarregados)

      // saldo total (sem filtro) + saldo de cada proprietário conhecido, pra descobrir se
      // alguma categoria desse pasto está de fato dividida entre donos diferentes — ver
      // "Selos do Rebanho — Fase 3: divisão por proprietário" no CLAUDE.md
      const [totalResp, ...porProprietarioResps] = await Promise.all([
        supabase.rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fazendaId, p_data: hoje }),
        ...proprietariosCarregados.map((p) =>
          supabase.rpc('fn_relatorio_rebanho_por_pasto', {
            p_fazenda_id: fazendaId,
            p_data: hoje,
            p_proprietario_ids: [p.id],
          })
        ),
      ])
      if (cancelado) return

      const linhasTotais = ((totalResp.data || []) as any[]).filter((l) => l.pasto_id === pastoOrigemId)
      const porProprietario = porProprietarioResps.map((r) =>
        ((r.data || []) as any[]).filter((l) => l.pasto_id === pastoOrigemId)
      )

      const linhasMontadas: LinhaLote[] = []
      for (const l of linhasTotais) {
        type Bucket = { proprietarioId: string; proprietarioNome: string | null; quantidade: number }
        const buckets: Bucket[] = []

        if (proprietariosCarregados.length <= 1) {
          // 0 ou 1 proprietário cadastrado — nunca há o que dividir, mesmo comportamento de
          // sempre (0 bloqueia o avançar via bloqueadoPorSemProprietario, 1 é atribuído sozinho)
          buckets.push({ proprietarioId: proprietariosCarregados[0]?.id ?? '', proprietarioNome: null, quantidade: l.quantidade })
        } else {
          let restante = l.quantidade
          proprietariosCarregados.forEach((p, i) => {
            const qtd = porProprietario[i].find((x) => x.categoria_id === l.categoria_id)?.quantidade ?? 0
            if (qtd > 0) {
              buckets.push({ proprietarioId: p.id, proprietarioNome: p.nome, quantidade: qtd })
              restante -= qtd
            }
          })
          if (restante > 0) {
            buckets.push({ proprietarioId: '', proprietarioNome: 'Sem proprietário', quantidade: restante })
          }
        }

        const dividida = buckets.length > 1
        for (const b of buckets) {
          linhasMontadas.push({
            chave: `${l.categoria_id}::${b.proprietarioId || 'sem'}`,
            categoriaId: l.categoria_id,
            categoriaNome: l.categoria_nome,
            quantidadeDisponivel: b.quantidade,
            quantidade: String(b.quantidade),
            pesoAtual: l.peso_medio_kg,
            pesoNovo: '',
            pesoEditavel: false,
            proprietarioId: b.proprietarioId,
            proprietarioNome: dividida ? b.proprietarioNome : null,
            precisaEscolherProprietario: dividida && b.proprietarioId === '',
          })
        }
      }
      setLinhas(linhasMontadas)
      setCarregando(false)
    }
    carregar()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId, pastoOrigemId])

  function atualizarLinha(chave: string, patch: Partial<LinhaLote>) {
    setLinhas((prev) => prev.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))
  }

  function removerLinha(chave: string) {
    setLinhas((prev) => prev.filter((l) => l.chave !== chave))
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
    if (linhas.some((l) => l.precisaEscolherProprietario && !l.proprietarioId)) {
      setErro('Selecione o proprietário nas categorias marcadas com "Sem proprietário".')
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
      proprietario_id: l.proprietarioId || null,
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
          <h2 className="text-lg font-bold text-text-primary">Mudança de Pasto</h2>
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
                    <div key={l.chave} className="rounded-control border border-border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-medium text-text-primary">
                          {l.categoriaNome}
                          {/* só rotula com o dono quando a categoria está de fato dividida nesse
                              pasto — no caso comum (1 dono só) fica idêntico a antes */}
                          {l.proprietarioNome && (
                            <span className="font-normal text-text-secondary"> — {l.proprietarioNome}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-error underline"
                          onClick={() => removerLinha(l.chave)}
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
                                onChange={(e) => atualizarLinha(l.chave, { quantidade: e.target.value })}
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
                              onChange={(e) => atualizarLinha(l.chave, { pesoNovo: e.target.value })}
                              onBlur={() => {
                                if (!l.pesoNovo) atualizarLinha(l.chave, { pesoEditavel: false })
                              }}
                            />
                          ) : (
                            <div className="flex items-center gap-2 rounded-control border border-border bg-bg px-2 py-1.5 text-sm text-text-secondary">
                              <span className="flex-1 tabular-nums">
                                {l.pesoAtual != null ? formatPeso(l.pesoAtual) : '—'}
                              </span>
                              <button
                                type="button"
                                onClick={() => atualizarLinha(l.chave, { pesoEditavel: true })}
                                className="shrink-0 text-text-secondary hover:text-brand-500"
                                title="Editar peso"
                              >
                                <IconEditar />
                              </button>
                            </div>
                          )}
                        </div>

                        {l.precisaEscolherProprietario && (
                          <div>
                            <label className="mb-1 block text-xs text-text-secondary">
                              Proprietário
                              <Required />
                            </label>
                            <select
                              className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500"
                              value={l.proprietarioId}
                              onChange={(e) => atualizarLinha(l.chave, { proprietarioId: e.target.value })}
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
