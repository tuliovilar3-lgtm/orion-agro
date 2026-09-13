'use client'

// modal de lançamento embutido, aberto pelos botões Nascimento/Morte/Mudança de Categoria/
// Desmame do DetalhePastoModal — mesma ideia da MovimentacaoLotesModal (Mudança de Pasto), só
// que cobrindo os outros 4 tipos simples do card. Ver "Selos do Rebanho — Fase 4 (lançamento
// embutido)" no CLAUDE.md pro desenho completo (por que cada tipo tem um formato de card
// diferente, por que a lista real de categorias do pasto precisa vir de
// fn_relatorio_rebanho_por_pasto e nunca de pasto.categorias do mapa, etc.).
//
// Nascimento não tem card nenhum — é a única ação que cria uma categoria nova no pasto, então
// não tem "linha existente" pra listar; é um formulário único. Morte/Mudança de Categoria/
// Desmame mostram uma lista vertical (não carrossel — mesmo padrão já usado em
// MovimentacaoLotesModal) de cards, um por categoria real presente no pasto, cada um salvando
// de forma independente (sem um "Avançar" único pro conjunto) — o caso comum é agir só numa ou
// duas categorias específicas, não em todas de uma vez.
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade, formatPeso } from '@/lib/format'
import { formatarDataBr } from '@/components/relatorios/tipos'
import { PAPEIS_BEZERRO_MAMANDO } from '@/lib/faixa-etaria'
import { safraSugeridaParaData, formatSafraInput, extrairAnoSafraDigitado } from '@/lib/periodo'

export type TipoLancamentoRapido = 'NASCIMENTO' | 'MORTE' | 'MUDANCA_CATEGORIA' | 'DESMAME'

type Sexo = 'MACHO' | 'FEMEA'
type CategoriaCatalogo = {
  id: string
  nome: string
  sexo: Sexo
  era: string | null
  grupoNome: string | null
  papelNome: string | null
}
type Proprietario = { id: string; nome: string }
type CausaMorte = { id: string; nome: string }
type LoteDisponivel = { safra: number; saldo: number }

const NOVA_CAUSA_MORTE = '__nova__'

type CartaoCategoria = {
  chave: string // categoriaId + proprietarioId — categoria sozinha não é única quando dividida
  categoriaId: string
  categoriaNome: string
  sexo: Sexo
  quantidadeDisponivel: number
  eraBezerro: boolean
  proprietarioIdFixo: string | null // já resolvido (0 ou 1 proprietário cadastrado)
  proprietarioNomeExibicao: string | null // só quando a categoria está de fato dividida
  precisaEscolherProprietario: boolean
}

const TITULOS: Record<TipoLancamentoRapido, string> = {
  NASCIMENTO: 'Nascimento',
  MORTE: 'Morte',
  MUDANCA_CATEGORIA: 'Mudança de Categoria',
  DESMAME: 'Desmame',
}

const inputClass =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const inputSmClass =
  'w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500'
const labelClass = 'mb-1.5 block text-sm font-medium text-text-secondary'
const labelSmClass = 'mb-1 block text-xs text-text-secondary'

function categoriaEhBezerroPapel(c: { papelNome: string | null } | undefined | null) {
  return !!c?.papelNome && PAPEIS_BEZERRO_MAMANDO.includes(c.papelNome)
}

function payloadBase(overrides: Record<string, unknown>) {
  return {
    fazenda_id: null,
    fazenda_origem_id: null,
    fazenda_destino_id: null,
    categoria_destino_id: null,
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
    pasto_destino_id: null,
    proprietario_id: null,
    safra_nascimento_ano_inicio: null,
    grupo_lancamento_id: null,
    ...overrides,
  }
}

export default function LancamentoRapidoModal({
  tipo,
  fazendaId,
  pastoId,
  pastoNome,
  onClose,
  onSalvo,
}: {
  tipo: TipoLancamentoRapido
  fazendaId: string
  pastoId: string
  pastoNome: string
  onClose: () => void
  onSalvo: () => void
}) {
  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const [carregando, setCarregando] = useState(true)
  const [categoriasTodas, setCategoriasTodas] = useState<CategoriaCatalogo[]>([])
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
  const [causasMorte, setCausasMorte] = useState<CausaMorte[]>([])
  const [cartoes, setCartoes] = useState<CartaoCategoria[]>([])
  const [data, setData] = useState(hoje)

  // criada aqui (não dentro de cada card) pra uma causa nova cadastrada num card já ficar
  // disponível pros demais cards de Morte da mesma sessão do modal, sem precisar recarregar
  async function criarCausaMorte(nome: string): Promise<CausaMorte | null> {
    const { data: nova, error } = await supabase.from('causas_morte').insert({ nome }).select('id, nome').single()
    if (error) {
      alert('Erro ao cadastrar causa: ' + error.message)
      return null
    }
    setCausasMorte((prev) => [...prev, nova].sort((a, b) => a.nome.localeCompare(b.nome)))
    return nova
  }

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      const [{ data: cats }, { data: prop }, { data: cm }] = await Promise.all([
        supabase
          .from('categorias_animal')
          .select('id, nome, sexo, era, grupo:grupos_categoria(nome), papel:grupos_categoria_papel(nome)')
          .eq('ativa', true)
          .order('nome'),
        supabase.from('pessoa_papeis').select('pessoa:pessoas!pessoa_id(id, nome)').eq('papel', 'PROPRIETARIO'),
        supabase.from('causas_morte').select('id, nome').eq('ativo', true).order('nome'),
      ])
      if (cancelado) return
      setCausasMorte((cm || []) as CausaMorte[])

      const categoriasCarregadas: CategoriaCatalogo[] = ((cats || []) as any[]).map((c) => ({
        id: c.id,
        nome: c.nome,
        sexo: c.sexo,
        era: c.era,
        grupoNome: c.grupo?.nome ?? null,
        papelNome: c.papel?.nome ?? null,
      }))
      const proprietariosCarregados: Proprietario[] = ((prop || []) as any[])
        .map((r) => r.pessoa)
        .filter(Boolean)
        .sort((a: Proprietario, b: Proprietario) => a.nome.localeCompare(b.nome))
      setCategoriasTodas(categoriasCarregadas)
      setProprietarios(proprietariosCarregados)

      if (tipo !== 'NASCIMENTO') {
        const catalogoPorId = new Map(categoriasCarregadas.map((c) => [c.id, c]))
        const totalResp = await supabase.rpc('fn_relatorio_rebanho_por_pasto', { p_fazenda_id: fazendaId, p_data: hoje })
        if (cancelado) return
        let linhasPasto = ((totalResp.data || []) as any[]).filter((l) => l.pasto_id === pastoId)

        if (tipo === 'MUDANCA_CATEGORIA') {
          // bezerro nunca pode ser origem de Mudança de Categoria — bloqueado pelo banco
          linhasPasto = linhasPasto.filter((l) => !categoriaEhBezerroPapel(catalogoPorId.get(l.categoria_id)))
        }
        if (tipo === 'DESMAME') {
          // Desmame só parte de categoria do grupo faixa etária Bezerro (mesmo critério da
          // tela cheia — grupo, não papel, então "Outros" com era 00-08 também qualifica)
          linhasPasto = linhasPasto.filter((l) => catalogoPorId.get(l.categoria_id)?.grupoNome === 'BEZERRO')
        }

        // MORTE com 2+ proprietários cadastrados: decompor cada categoria em baldes por dono
        // (mesmo princípio já usado em MovimentacaoLotesModal — uma categoria pode estar
        // dividida entre 2 donos no mesmo pasto, e matar/remover precisa saber de qual balde)
        let porProprietario: any[][] = []
        if (tipo === 'MORTE' && proprietariosCarregados.length > 1) {
          const resps = await Promise.all(
            proprietariosCarregados.map((p) =>
              supabase.rpc('fn_relatorio_rebanho_por_pasto', {
                p_fazenda_id: fazendaId,
                p_data: hoje,
                p_proprietario_ids: [p.id],
              })
            )
          )
          if (cancelado) return
          porProprietario = resps.map((r) => ((r.data || []) as any[]).filter((l) => l.pasto_id === pastoId))
        }

        const cartoesMontados: CartaoCategoria[] = []
        for (const l of linhasPasto) {
          const cat = catalogoPorId.get(l.categoria_id)
          const eraBezerro = categoriaEhBezerroPapel(cat)
          if (tipo === 'MORTE' && proprietariosCarregados.length > 1) {
            let restante = l.quantidade
            const buckets: { proprietarioId: string; proprietarioNome: string | null; quantidade: number }[] = []
            proprietariosCarregados.forEach((p, i) => {
              const qtd = porProprietario[i].find((x) => x.categoria_id === l.categoria_id)?.quantidade ?? 0
              if (qtd > 0) {
                buckets.push({ proprietarioId: p.id, proprietarioNome: p.nome, quantidade: qtd })
                restante -= qtd
              }
            })
            if (restante > 0) buckets.push({ proprietarioId: '', proprietarioNome: 'Sem proprietário', quantidade: restante })
            const dividida = buckets.length > 1
            for (const b of buckets) {
              cartoesMontados.push({
                chave: `${l.categoria_id}::${b.proprietarioId || 'sem'}`,
                categoriaId: l.categoria_id,
                categoriaNome: l.categoria_nome,
                sexo: cat?.sexo ?? 'MACHO',
                quantidadeDisponivel: b.quantidade,
                eraBezerro,
                proprietarioIdFixo: b.proprietarioId || null,
                proprietarioNomeExibicao: dividida ? b.proprietarioNome : null,
                precisaEscolherProprietario: dividida && !b.proprietarioId,
              })
            }
          } else {
            cartoesMontados.push({
              chave: l.categoria_id,
              categoriaId: l.categoria_id,
              categoriaNome: l.categoria_nome,
              sexo: cat?.sexo ?? 'MACHO',
              quantidadeDisponivel: l.quantidade,
              eraBezerro,
              proprietarioIdFixo: proprietariosCarregados.length === 1 ? proprietariosCarregados[0].id : null,
              proprietarioNomeExibicao: null,
              precisaEscolherProprietario: false,
            })
          }
        }
        setCartoes(cartoesMontados)
      }
      setCarregando(false)
    }
    carregar()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, fazendaId, pastoId])

  function definirDataAtalho(diasAtras: number) {
    const d = new Date()
    d.setDate(d.getDate() - diasAtras)
    setData(d.toISOString().slice(0, 10))
  }

  const bloqueadoPorSemProprietario = (tipo === 'NASCIMENTO' || tipo === 'MORTE') && proprietarios.length === 0

  return (
    // z-[1100]: mesmo teto já usado em DetalhePastoModal/MovimentacaoLotesModal, acima de
    // qualquer camada interna do Leaflet
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{TITULOS[tipo]}</h2>
            <p className="text-xs text-text-secondary">{pastoNome}</p>
          </div>
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
            <div className="mt-4 max-w-xs">
              <label className={labelClass}>Data</label>
              <input
                type="date"
                max={hoje}
                className={inputClass}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
              <div className="mt-1.5 flex gap-3">
                <button type="button" onClick={() => definirDataAtalho(0)} className="text-xs font-medium text-brand-500 underline">
                  Hoje
                </button>
                <button type="button" onClick={() => definirDataAtalho(1)} className="text-xs font-medium text-brand-500 underline">
                  Ontem
                </button>
              </div>
            </div>

            {bloqueadoPorSemProprietario && (
              <div className="mt-4 rounded-control border border-error bg-error-bg px-4 py-3 text-sm text-error">
                Nenhum proprietário cadastrado ainda — todo animal precisa ter um dono atribuído. Cadastre pelo menos
                um proprietário em Pessoas e Empresas antes de lançar.
              </div>
            )}

            <div className="mt-4">
              {tipo === 'NASCIMENTO' ? (
                <FormularioNascimento
                  fazendaId={fazendaId}
                  pastoId={pastoId}
                  data={data}
                  categorias={categoriasTodas.filter((c) => c.grupoNome === 'BEZERRO')}
                  proprietarios={proprietarios}
                  bloqueado={bloqueadoPorSemProprietario}
                  onClose={onClose}
                  onSalvo={onSalvo}
                />
              ) : cartoes.length === 0 ? (
                <p className="text-sm text-text-muted">Nenhuma categoria elegível nesse pasto pra {TITULOS[tipo].toLowerCase()}.</p>
              ) : (
                <div className="space-y-3">
                  {cartoes.map((c) =>
                    tipo === 'MORTE' ? (
                      <CardMorte
                        key={c.chave}
                        cartao={c}
                        fazendaId={fazendaId}
                        pastoId={pastoId}
                        data={data}
                        proprietarios={proprietarios}
                        causasMorte={causasMorte}
                        onCriarCausaMorte={criarCausaMorte}
                        bloqueado={bloqueadoPorSemProprietario}
                        onSalvo={onSalvo}
                      />
                    ) : tipo === 'MUDANCA_CATEGORIA' ? (
                      <CardMudancaCategoria
                        key={c.chave}
                        cartao={c}
                        fazendaId={fazendaId}
                        pastoId={pastoId}
                        data={data}
                        categoriasDestino={categoriasTodas.filter(
                          (cat) => !categoriaEhBezerroPapel(cat) && cat.id !== c.categoriaId && cat.sexo === c.sexo
                        )}
                        onSalvo={onSalvo}
                      />
                    ) : (
                      <CardDesmame
                        key={c.chave}
                        cartao={c}
                        fazendaId={fazendaId}
                        pastoId={pastoId}
                        data={data}
                        categoriasDestino={categoriasTodas.filter((cat) => cat.era === '08-12' && cat.sexo === c.sexo)}
                        onSalvo={onSalvo}
                      />
                    )
                  )}
                </div>
              )}
            </div>

            {tipo !== 'NASCIMENTO' && (
              <div className="mt-6 flex justify-end border-t border-border pt-4">
                <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm">
                  Fechar
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nascimento — formulário único (não é um card sobre estoque existente, é a
// única ação que cria uma categoria nova no pasto)
// ---------------------------------------------------------------------------
function FormularioNascimento({
  fazendaId,
  pastoId,
  data,
  categorias,
  proprietarios,
  bloqueado,
  onClose,
  onSalvo,
}: {
  fazendaId: string
  pastoId: string
  data: string
  categorias: CategoriaCatalogo[]
  proprietarios: Proprietario[]
  bloqueado: boolean
  onClose: () => void
  onSalvo: () => void
}) {
  const supabase = createClient()
  const [categoriaId, setCategoriaId] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [pesoMedio, setPesoMedio] = useState('')
  const [safraInput, setSafraInput] = useState('')
  const [proprietarioEscolhido, setProprietarioEscolhido] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const mostrarSeletorProprietario = proprietarios.length > 1
  function resolverProprietarioId() {
    if (proprietarios.length === 1) return proprietarios[0].id
    return proprietarioEscolhido || null
  }

  async function handleSalvar() {
    setErro(null)
    const qtd = parseInt(quantidade, 10)
    const peso = parseFloat(pesoMedio)
    if (!categoriaId) return setErro('Selecione a categoria.')
    if (!Number.isFinite(qtd) || qtd <= 0) return setErro('Informe a quantidade.')
    if (!Number.isFinite(peso) || peso <= 0) return setErro('Informe o peso médio.')
    if (mostrarSeletorProprietario && !proprietarioEscolhido) return setErro('Selecione o proprietário do lote.')

    setSalvando(true)
    const { error } = await supabase.from('movimentacoes_rebanho').insert(
      payloadBase({
        data,
        tipo: 'NASCIMENTO',
        fazenda_id: fazendaId,
        categoria_id: categoriaId,
        quantidade: qtd,
        peso_medio_kg: peso,
        pasto_id: pastoId,
        proprietario_id: resolverProprietarioId(),
        safra_nascimento_ano_inicio: safraInput ? parseInt(safraInput, 10) : safraSugeridaParaData(data),
        observacao: observacao.trim() || null,
      })
    )
    setSalvando(false)
    if (error) return setErro(error.message)
    onSalvo()
    onClose()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>
            Categoria
            <Required />
          </label>
          <select className={inputClass} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Selecione...</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Quantidade
            <Required />
          </label>
          <input
            type="number"
            min="1"
            step="1"
            className={inputClass}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>
            Peso médio (kg)
            <Required />
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={inputClass}
            value={pesoMedio}
            onChange={(e) => setPesoMedio(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>
            Safra do bezerro
            <Required />
          </label>
          <input
            type="text"
            inputMode="numeric"
            className={inputClass}
            value={formatSafraInput(safraInput || String(safraSugeridaParaData(data)))}
            onChange={(e) => setSafraInput(extrairAnoSafraDigitado(e.target.value))}
            onFocus={(e) => e.target.select()}
          />
        </div>
      </div>

      {mostrarSeletorProprietario && (
        <div>
          <label className={labelClass}>
            Proprietário do lote
            <Required />
          </label>
          <select className={inputClass} value={proprietarioEscolhido} onChange={(e) => setProprietarioEscolhido(e.target.value)}>
            <option value="">Selecione...</option>
            {proprietarios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelClass}>Observação</label>
        <textarea className={inputClass} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>

      {erro && <div className="rounded-control bg-error-bg px-3 py-2 text-sm text-error">{erro}</div>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm">
          Cancelar
        </button>
        <button
          type="button"
          disabled={salvando || bloqueado}
          onClick={handleSalvar}
          className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// hook pequeno, compartilhado pelos cards que precisam de lote (safra) — Morte e Desmame
function useLotesDisponiveis(fazendaId: string, categoriaId: string, data: string, ativo: boolean) {
  const supabase = createClient()
  const [lotes, setLotes] = useState<LoteDisponivel[]>([])
  useEffect(() => {
    if (!ativo) return
    let cancelado = false
    supabase
      .rpc('fn_lotes_nascimento_disponiveis', { p_fazenda_id: fazendaId, p_categoria_id: categoriaId, p_data: data })
      .then(({ data: lotesResp, error }) => {
        if (!cancelado) setLotes(error ? [] : ((lotesResp as LoteDisponivel[]) || []))
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, fazendaId, categoriaId, data])
  return lotes
}

function CabecalhoCartao({ nome, quantidade, nomeDono }: { nome: string; quantidade: number; nomeDono: string | null }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="font-medium text-text-primary">
        {nome}
        {nomeDono && <span className="font-normal text-text-secondary"> — {nomeDono}</span>}
      </span>
      <span className="shrink-0 text-xs text-text-secondary">{formatQuantidade(quantidade)} cab.</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Morte
// ---------------------------------------------------------------------------
function CardMorte({
  cartao,
  fazendaId,
  pastoId,
  data,
  proprietarios,
  causasMorte,
  onCriarCausaMorte,
  bloqueado,
  onSalvo,
}: {
  cartao: CartaoCategoria
  fazendaId: string
  pastoId: string
  data: string
  proprietarios: Proprietario[]
  causasMorte: CausaMorte[]
  onCriarCausaMorte: (nome: string) => Promise<CausaMorte | null>
  bloqueado: boolean
  onSalvo: () => void
}) {
  const supabase = createClient()
  const lotes = useLotesDisponiveis(fazendaId, cartao.categoriaId, data, cartao.eraBezerro)
  const [quantidade, setQuantidade] = useState('')
  const [pesoMedio, setPesoMedio] = useState('')
  const [causaMorteId, setCausaMorteId] = useState('')
  const [novaCausaMorteNome, setNovaCausaMorteNome] = useState('')
  const [safraSelecionada, setSafraSelecionada] = useState('')
  const [proprietarioEscolhido, setProprietarioEscolhido] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handleSalvar() {
    setErro(null)
    const qtd = parseInt(quantidade, 10)
    const peso = parseFloat(pesoMedio)
    if (!Number.isFinite(qtd) || qtd <= 0 || qtd > cartao.quantidadeDisponivel) {
      return setErro(`Quantidade inválida (disponível: ${cartao.quantidadeDisponivel}).`)
    }
    if (!Number.isFinite(peso) || peso <= 0) return setErro('Informe o peso médio.')
    if (!causaMorteId) return setErro('Selecione a causa da morte.')
    if (causaMorteId === NOVA_CAUSA_MORTE && !novaCausaMorteNome.trim()) return setErro('Informe o nome da nova causa.')
    if (cartao.eraBezerro && !safraSelecionada) return setErro('Selecione a safra de nascimento.')
    if (cartao.precisaEscolherProprietario && !proprietarioEscolhido) return setErro('Selecione o proprietário.')

    setSalvando(true)
    let causaMorteNome: string | null
    if (causaMorteId === NOVA_CAUSA_MORTE) {
      const nova = await onCriarCausaMorte(novaCausaMorteNome.trim())
      causaMorteNome = nova?.nome ?? null
    } else {
      causaMorteNome = causasMorte.find((c) => c.id === causaMorteId)?.nome ?? null
    }
    if (!causaMorteNome) {
      setSalvando(false)
      return setErro('Não foi possível salvar a causa da morte.')
    }

    const proprietarioId = cartao.precisaEscolherProprietario ? proprietarioEscolhido : cartao.proprietarioIdFixo
    const { error } = await supabase.from('movimentacoes_rebanho').insert(
      payloadBase({
        data,
        tipo: 'MORTE',
        fazenda_id: fazendaId,
        categoria_id: cartao.categoriaId,
        quantidade: qtd,
        peso_medio_kg: peso,
        causa_morte: causaMorteNome,
        pasto_id: pastoId,
        proprietario_id: proprietarioId || null,
        safra_nascimento_ano_inicio: cartao.eraBezerro ? parseInt(safraSelecionada, 10) : null,
        observacao: observacao.trim() || null,
      })
    )
    setSalvando(false)
    if (error) return setErro(error.message)
    setSalvo(true)
    onSalvo()
  }

  if (salvo) {
    return (
      <div className="flex items-center gap-2 rounded-control border border-success bg-success-bg px-3 py-3 text-sm text-success">
        <span>✓</span>
        <span>
          {formatQuantidade(parseInt(quantidade, 10))} cabeça(s) de {cartao.categoriaNome} registrada(s) como morte.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-control border border-border p-3">
      <CabecalhoCartao nome={cartao.categoriaNome} quantidade={cartao.quantidadeDisponivel} nomeDono={cartao.proprietarioNomeExibicao} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelSmClass}>
            Quantidade
            <Required />
          </label>
          <input
            type="number"
            min="1"
            max={cartao.quantidadeDisponivel}
            step="1"
            className={inputSmClass}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
          <p className="mt-1 text-xs text-text-secondary">Disponível: {formatQuantidade(cartao.quantidadeDisponivel)}</p>
        </div>
        <div>
          <label className={labelSmClass}>
            Peso médio (kg)
            <Required />
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={inputSmClass}
            value={pesoMedio}
            onChange={(e) => setPesoMedio(e.target.value)}
          />
        </div>
        <div>
          <label className={labelSmClass}>
            Causa da morte
            <Required />
          </label>
          <select className={inputSmClass} value={causaMorteId} onChange={(e) => setCausaMorteId(e.target.value)}>
            <option value="">Selecione...</option>
            {causasMorte.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
            <option value={NOVA_CAUSA_MORTE}>+ Nova causa...</option>
          </select>
          {causaMorteId === NOVA_CAUSA_MORTE && (
            <input
              type="text"
              className={`mt-1 ${inputSmClass}`}
              placeholder="Nome da causa"
              value={novaCausaMorteNome}
              onChange={(e) => setNovaCausaMorteNome(e.target.value)}
            />
          )}
        </div>
        {cartao.eraBezerro && (
          <div>
            <label className={labelSmClass}>
              Safra
              <Required />
            </label>
            <select className={inputSmClass} value={safraSelecionada} onChange={(e) => setSafraSelecionada(e.target.value)}>
              <option value="">Selecione...</option>
              {lotes.map((l) => (
                <option key={l.safra} value={l.safra}>
                  {l.safra}/{l.safra + 1} (disp. {formatQuantidade(l.saldo)})
                </option>
              ))}
            </select>
          </div>
        )}
        {cartao.precisaEscolherProprietario && (
          <div>
            <label className={labelSmClass}>
              Proprietário
              <Required />
            </label>
            <select className={inputSmClass} value={proprietarioEscolhido} onChange={(e) => setProprietarioEscolhido(e.target.value)}>
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
      <div className="mt-2">
        <label className={labelSmClass}>Observação</label>
        <textarea className={inputSmClass} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      {erro && <div className="mt-2 rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={salvando || bloqueado}
          onClick={handleSalvar}
          className="rounded-control bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mudança de Categoria — uma origem por card, "+" divide em vários destinos
// ---------------------------------------------------------------------------
type LinhaDestino = { id: string; categoriaDestinoId: string; quantidade: string; pesoMedio: string }

function novaLinhaDestino(quantidade = ''): LinhaDestino {
  return { id: crypto.randomUUID(), categoriaDestinoId: '', quantidade, pesoMedio: '' }
}

function CardMudancaCategoria({
  cartao,
  fazendaId,
  pastoId,
  data,
  categoriasDestino,
  onSalvo,
}: {
  cartao: CartaoCategoria
  fazendaId: string
  pastoId: string
  data: string
  categoriasDestino: CategoriaCatalogo[]
  onSalvo: () => void
}) {
  const supabase = createClient()
  // quantidade da primeira linha já vem preenchida com o total disponível (caso mais comum é
  // converter o lote inteiro) — editável livremente, inclusive pra abrir espaço e dividir em
  // outro destino via "+"
  const [linhas, setLinhas] = useState<LinhaDestino[]>([novaLinhaDestino(String(cartao.quantidadeDisponivel))])
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function atualizarLinha(id: string, patch: Partial<LinhaDestino>) {
    setLinhas((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }
  function removerLinha(id: string) {
    setLinhas((prev) => prev.filter((l) => l.id !== id))
  }

  const somaQuantidade = linhas.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)
  const restante = cartao.quantidadeDisponivel - somaQuantidade

  async function handleSalvar() {
    setErro(null)
    if (linhas.length === 0) return setErro('Adicione ao menos uma categoria destino.')
    for (const l of linhas) {
      const qtd = parseInt(l.quantidade, 10)
      const peso = parseFloat(l.pesoMedio)
      if (!l.categoriaDestinoId) return setErro('Selecione a categoria destino em todas as linhas.')
      if (!Number.isFinite(qtd) || qtd <= 0) return setErro('Informe a quantidade em todas as linhas.')
      if (!Number.isFinite(peso) || peso <= 0) return setErro('Informe o peso médio em todas as linhas.')
    }
    if (somaQuantidade > cartao.quantidadeDisponivel) {
      return setErro(`A soma das linhas (${somaQuantidade}) passa do disponível (${cartao.quantidadeDisponivel}).`)
    }

    setSalvando(true)
    const grupoId = linhas.length > 1 ? crypto.randomUUID() : null
    const payloads = linhas.map((l) =>
      payloadBase({
        data,
        tipo: 'MUDANCA_CATEGORIA',
        fazenda_id: fazendaId,
        categoria_id: cartao.categoriaId,
        categoria_destino_id: l.categoriaDestinoId,
        quantidade: parseInt(l.quantidade, 10),
        peso_medio_kg: parseFloat(l.pesoMedio),
        pasto_id: pastoId,
        observacao: observacao.trim() || null,
        grupo_lancamento_id: grupoId,
      })
    )
    const { error } = await supabase.from('movimentacoes_rebanho').insert(payloads)
    setSalvando(false)
    if (error) return setErro(error.message)
    setSalvo(true)
    onSalvo()
  }

  if (salvo) {
    return (
      <div className="flex items-center gap-2 rounded-control border border-success bg-success-bg px-3 py-3 text-sm text-success">
        <span>✓</span>
        <span>
          {formatQuantidade(somaQuantidade)} cabeça(s) de {cartao.categoriaNome} mudaram de categoria.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-control border border-border p-3">
      <CabecalhoCartao nome={cartao.categoriaNome} quantidade={cartao.quantidadeDisponivel} nomeDono={null} />
      <div className="space-y-2">
        {linhas.map((l) => (
          <div key={l.id} className="grid grid-cols-3 items-end gap-2">
            <div>
              <label className={labelSmClass}>
                Quantidade
                <Required />
              </label>
              <input
                type="number"
                min="1"
                step="1"
                className={inputSmClass}
                value={l.quantidade}
                onChange={(e) => atualizarLinha(l.id, { quantidade: e.target.value })}
              />
            </div>
            <div>
              <label className={labelSmClass}>
                Categoria destino
                <Required />
              </label>
              <select
                className={inputSmClass}
                value={l.categoriaDestinoId}
                onChange={(e) => atualizarLinha(l.id, { categoriaDestinoId: e.target.value })}
              >
                <option value="">Selecione...</option>
                {categoriasDestino.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-1">
              <div className="flex-1">
                <label className={labelSmClass}>
                  Peso médio (kg)
                  <Required />
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputSmClass}
                  value={l.pesoMedio}
                  onChange={(e) => atualizarLinha(l.id, { pesoMedio: e.target.value })}
                />
              </div>
              {linhas.length > 1 && (
                <button
                  type="button"
                  onClick={() => removerLinha(l.id)}
                  className="mb-1.5 shrink-0 text-xs text-error underline"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setLinhas((prev) => [...prev, novaLinhaDestino()])}
          className="text-xs font-semibold text-brand-500 underline"
        >
          + Dividir em outro destino
        </button>
        <span className="text-xs text-text-secondary">Restante: {formatQuantidade(Math.max(restante, 0))}</span>
      </div>
      <div className="mt-2">
        <label className={labelSmClass}>Observação</label>
        <textarea className={inputSmClass} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      {erro && <div className="mt-2 rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={salvando}
          onClick={handleSalvar}
          className="rounded-control bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desmame — categoria destino fixa por card, "+" adiciona linhas de safra
// ---------------------------------------------------------------------------
type LinhaSafra = { id: string; safra: string; quantidade: string; pesoMedio: string }

function novaLinhaSafra(): LinhaSafra {
  return { id: crypto.randomUUID(), safra: '', quantidade: '', pesoMedio: '' }
}

function CardDesmame({
  cartao,
  fazendaId,
  pastoId,
  data,
  categoriasDestino,
  onSalvo,
}: {
  cartao: CartaoCategoria
  fazendaId: string
  pastoId: string
  data: string
  categoriasDestino: CategoriaCatalogo[]
  onSalvo: () => void
}) {
  const supabase = createClient()
  const lotes = useLotesDisponiveis(fazendaId, cartao.categoriaId, data, true)
  const [categoriaDestinoId, setCategoriaDestinoId] = useState('')
  const [linhas, setLinhas] = useState<LinhaSafra[]>([novaLinhaSafra()])
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function atualizarLinha(id: string, patch: Partial<LinhaSafra>) {
    setLinhas((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }
  function removerLinha(id: string) {
    setLinhas((prev) => prev.filter((l) => l.id !== id))
  }

  async function handleSalvar() {
    setErro(null)
    if (!categoriaDestinoId) return setErro('Selecione a categoria destino.')
    for (const l of linhas) {
      const qtd = parseInt(l.quantidade, 10)
      const peso = parseFloat(l.pesoMedio)
      const lote = lotes.find((x) => String(x.safra) === l.safra)
      if (!l.safra) return setErro('Selecione a safra em todas as linhas.')
      if (!Number.isFinite(qtd) || qtd <= 0 || (lote && qtd > lote.saldo)) {
        return setErro(`Quantidade inválida pra safra ${l.safra} (disponível: ${lote?.saldo ?? 0}).`)
      }
      if (!Number.isFinite(peso) || peso <= 0) return setErro('Informe o peso médio em todas as linhas.')
    }

    setSalvando(true)
    const grupoId = linhas.length > 1 ? crypto.randomUUID() : null
    const payloads = linhas.map((l) =>
      payloadBase({
        data,
        tipo: 'DESMAME',
        fazenda_id: fazendaId,
        categoria_id: cartao.categoriaId,
        categoria_destino_id: categoriaDestinoId,
        quantidade: parseInt(l.quantidade, 10),
        peso_medio_kg: parseFloat(l.pesoMedio),
        pasto_id: pastoId,
        safra_nascimento_ano_inicio: parseInt(l.safra, 10),
        observacao: observacao.trim() || null,
        grupo_lancamento_id: grupoId,
      })
    )
    const { error } = await supabase.from('movimentacoes_rebanho').insert(payloads)
    setSalvando(false)
    if (error) return setErro(error.message)
    setSalvo(true)
    onSalvo()
  }

  const totalDesmamado = linhas.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)

  if (salvo) {
    return (
      <div className="flex items-center gap-2 rounded-control border border-success bg-success-bg px-3 py-3 text-sm text-success">
        <span>✓</span>
        <span>
          {formatQuantidade(totalDesmamado)} cabeça(s) de {cartao.categoriaNome} desmamadas.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-control border border-border p-3">
      <CabecalhoCartao nome={cartao.categoriaNome} quantidade={cartao.quantidadeDisponivel} nomeDono={null} />
      <div className="mb-2">
        <label className={labelSmClass}>
          Categoria destino
          <Required />
        </label>
        <select className={inputSmClass} value={categoriaDestinoId} onChange={(e) => setCategoriaDestinoId(e.target.value)}>
          <option value="">Selecione...</option>
          {categoriasDestino.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        {linhas.map((l) => {
          const lote = lotes.find((x) => String(x.safra) === l.safra)
          return (
            <div key={l.id} className="grid grid-cols-3 items-end gap-2">
              <div>
                <label className={labelSmClass}>
                  Safra
                  <Required />
                </label>
                <select className={inputSmClass} value={l.safra} onChange={(e) => atualizarLinha(l.id, { safra: e.target.value })}>
                  <option value="">Selecione...</option>
                  {lotes.map((lo) => (
                    <option key={lo.safra} value={lo.safra}>
                      {lo.safra}/{lo.safra + 1} (disp. {formatQuantidade(lo.saldo)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelSmClass}>
                  Quantidade
                  <Required />
                </label>
                <input
                  type="number"
                  min="1"
                  max={lote?.saldo}
                  step="1"
                  className={inputSmClass}
                  value={l.quantidade}
                  onChange={(e) => atualizarLinha(l.id, { quantidade: e.target.value })}
                />
              </div>
              <div className="flex items-end gap-1">
                <div className="flex-1">
                  <label className={labelSmClass}>
                    Peso médio (kg)
                    <Required />
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={inputSmClass}
                    value={l.pesoMedio}
                    onChange={(e) => atualizarLinha(l.id, { pesoMedio: e.target.value })}
                  />
                </div>
                {linhas.length > 1 && (
                  <button type="button" onClick={() => removerLinha(l.id)} className="mb-1.5 shrink-0 text-xs text-error underline">
                    Remover
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => setLinhas((prev) => [...prev, novaLinhaSafra()])}
        className="mt-2 text-xs font-semibold text-brand-500 underline"
      >
        + Adicionar safra
      </button>
      <div className="mt-2">
        <label className={labelSmClass}>Observação</label>
        <textarea className={inputSmClass} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      {erro && <div className="mt-2 rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={salvando}
          onClick={handleSalvar}
          className="rounded-control bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
