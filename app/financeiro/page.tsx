'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import ModuloGate from '@/components/ModuloGate'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatMoeda, formatQuantidade, formatArea } from '@/lib/format'
import Required from '@/components/Required'

type Fazenda = { id: string; nome: string; area_ha: number | null }
type Classe = { id: string; numero: number; nome: string; tipo: 'CREDITO' | 'DEBITO' }
type Centro = { id: string; classe_financeira_id: string; numero: number | null; nome: string }
type Subcentro = { id: string; centro_custo_id: string; numero: number | null; nome: string }
type Produto = { id: string; nome: string; subcentro_custo_id: string | null; ativo: boolean }
type Pessoa = { id: string; nome: string }
type ContaBancaria = { id: string; nome: string; especie: boolean }
type AtividadeEconomica = { id: string; nome: string }

type LancamentoBaixa = {
  id: string
  lancamento_id: string
  numero_parcela: number
  total_parcelas: number
  data_vencimento: string | null
  data_pagamento: string | null
  valor: number
  conta_bancaria_id: string | null
  conta_bancaria: { nome: string } | null
}

type Lancamento = {
  id: string
  fazenda_id: string
  descricao: string
  data: string
  valor: number
  tipo: 'CREDITO' | 'DEBITO'
  subcentro_id: string
  produto_id: string
  status: 'PENDENTE' | 'CONFIRMADO'
  movimentacao_id: string | null
  rateio_grupo_id: string | null
  pessoa_id: string | null
  proprietario_id: string | null
  numero_documento: string | null
  atividade_economica_id: string | null
  fazenda: { nome: string } | null
  produto: { nome: string } | null
  pessoa: { nome: string } | null
  proprietario: { nome: string } | null
  atividade: { nome: string } | null
  subcentro: {
    nome: string
    centro: { nome: string; classe: { numero: number; nome: string; tipo: string } | null } | null
  } | null
  baixas: LancamentoBaixa[]
}

const NOVO_PRODUTO = '__novo__'
const SELECT_CLASS = 'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-text-secondary'

function labelClassificacao(l: Lancamento): string {
  const cl = l.subcentro?.centro?.classe
  const c = l.subcentro?.centro
  if (!cl || !c || !l.subcentro) return '—'
  return `${cl.nome} › ${c.nome} › ${l.subcentro.nome}`
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function somarMeses(dataISO: string, meses: number): string {
  const d = new Date(dataISO + 'T00:00:00')
  d.setMonth(d.getMonth() + meses)
  return d.toISOString().slice(0, 10)
}

function statusBaixa(b: LancamentoBaixa): 'ABERTO' | 'VENCIDO' | 'PAGO' {
  if (b.data_pagamento) return 'PAGO'
  return b.data_vencimento && b.data_vencimento < hojeISO() ? 'VENCIDO' : 'ABERTO'
}

function BadgeStatusBaixa({ status }: { status: 'ABERTO' | 'VENCIDO' | 'PAGO' }) {
  const estilos =
    status === 'PAGO'
      ? 'bg-success-bg text-success'
      : status === 'VENCIDO'
        ? 'bg-error-bg text-error'
        : 'bg-bg text-text-secondary'
  const texto = status === 'PAGO' ? 'Pago' : status === 'VENCIDO' ? 'Vencido' : 'Aberto'
  return <span className={`rounded-control px-2 py-0.5 text-xs font-semibold ${estilos}`}>{texto}</span>
}

// resumo de pagamento de um lançamento, a partir das baixas já
// carregadas — usado só como linha de apoio na listagem de
// /financeiro (o detalhe completo, filtrável, vive em
// /contas-a-pagar-receber)
function resumoPagamento(l: Lancamento): string | null {
  if (l.baixas.length === 0) return null
  if (l.baixas.length === 1) {
    const b = l.baixas[0]
    const st = statusBaixa(b)
    const venc = b.data_vencimento ? b.data_vencimento.split('-').reverse().join('/') : null
    if (st === 'PAGO') return `Pago em ${b.data_pagamento!.split('-').reverse().join('/')}`
    return venc ? `Vence em ${venc}` : null
  }
  const pagas = l.baixas.filter((b) => b.data_pagamento).length
  return `${pagas} de ${l.baixas.length} parcelas pagas`
}

export default function FinanceiroPage() {
  const { usuarioApp } = useAuth()
  const supabase = createClient()

  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [classes, setClasses] = useState<Classe[]>([])
  const [centros, setCentros] = useState<Centro[]>([])
  const [subcentros, setSubcentros] = useState<Subcentro[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [proprietarios, setProprietarios] = useState<Pessoa[]>([])
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([])
  const [atividadesEconomicas, setAtividadesEconomicas] = useState<AtividadeEconomica[]>([])
  const [controlaContasPagarReceber, setControlaContasPagarReceber] = useState(false)
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(true)

  const [formularioAberto, setFormularioAberto] = useState(false)
  const [tipoLancamento, setTipoLancamento] = useState<'CREDITO' | 'DEBITO' | ''>('')
  const [fazendaId, setFazendaId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')

  const [produtoId, setProdutoId] = useState('')
  const [produtoNovoNome, setProdutoNovoNome] = useState('')
  const [classeId, setClasseId] = useState('')
  const [centroId, setCentroId] = useState('')
  const [subcentroId, setSubcentroId] = useState('')

  const [rateando, setRateando] = useState(false)
  const [rateioCriterio, setRateioCriterio] = useState<'POR_CABECA' | 'POR_AREA' | 'PERCENTUAL_FIXO'>('POR_CABECA')
  const [rateioFazendaIds, setRateioFazendaIds] = useState<Set<string>>(new Set())
  const [rateioPercentuais, setRateioPercentuais] = useState<Record<string, string>>({})
  // cabeças de hoje por fazenda, buscadas só quando o critério é "por
  // cabeça" — alimenta a prévia de rateio (quantidade + % por fazenda)
  const [rateioCabecasPorFazenda, setRateioCabecasPorFazenda] = useState<Record<string, number>>({})

  // campos extras, só relevantes quando controlaContasPagarReceber
  const [pessoaId, setPessoaId] = useState('')
  const [modalPessoaAberto, setModalPessoaAberto] = useState(false)
  const [novaPessoaNome, setNovaPessoaNome] = useState('')
  const [salvandoPessoa, setSalvandoPessoa] = useState(false)
  const [proprietarioId, setProprietarioId] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  // classificação de base do Financeiro, disponível independente do
  // recurso pago (diferente de pessoa/proprietário/pagamento acima)
  const [atividadeEconomicaId, setAtividadeEconomicaId] = useState('')
  const [pagamento, setPagamento] = useState<'JA_PAGO' | 'A_PAGAR'>('A_PAGAR')
  const [pagamentoData, setPagamentoData] = useState(() => hojeISO())
  const [pagamentoContaId, setPagamentoContaId] = useState('')
  const [vencimentoData, setVencimentoData] = useState('')
  const [parcelar, setParcelar] = useState(false)
  const [numParcelas, setNumParcelas] = useState('2')
  // datas de vencimento das parcelas 2..N (a 1ª é sempre vencimentoData
  // acima) — pré-preenchidas mensalmente, mas editáveis uma a uma, pra
  // suportar parcelamento semestral/anual/irregular
  const [parcelasDatasExtras, setParcelasDatasExtras] = useState<string[]>([])

  const [salvando, setSalvando] = useState(false)

  const [filtroStatus, setFiltroStatus] = useState<'TODOS' | 'PENDENTE' | 'CONFIRMADO'>('TODOS')
  const [filtroFazendaId, setFiltroFazendaId] = useState('')
  const [filtroAtividadeId, setFiltroAtividadeId] = useState('')
  const [confirmarExclusaoId, setConfirmarExclusaoId] = useState<string | null>(null)
  const [confirmarEstornoId, setConfirmarEstornoId] = useState<string | null>(null)

  // painel de "Confirmar" quando há recurso de Contas a Pagar/Receber —
  // vira Confirmar + Dar baixa no mesmo passo (ver handleConfirmarComBaixa)
  const [painelConfirmarId, setPainelConfirmarId] = useState<string | null>(null)
  const [confirmarPagamento, setConfirmarPagamento] = useState<'JA_PAGO' | 'A_PAGAR'>('A_PAGAR')
  const [confirmarPagamentoData, setConfirmarPagamentoData] = useState(() => hojeISO())
  const [confirmarPagamentoContaId, setConfirmarPagamentoContaId] = useState('')
  const [confirmarVencimentoData, setConfirmarVencimentoData] = useState('')
  const [confirmarParcelar, setConfirmarParcelar] = useState(false)
  const [confirmarNumParcelas, setConfirmarNumParcelas] = useState('2')
  const [confirmarParcelasDatasExtras, setConfirmarParcelasDatasExtras] = useState<string[]>([])
  const [confirmando, setConfirmando] = useState(false)

  const mostrarSeletorProprietario = proprietarios.length > 1
  function resolverProprietarioId(escolhidoId: string): string | null {
    if (proprietarios.length === 1) return proprietarios[0].id
    return escolhidoId || null
  }

  // pré-preenche as datas das parcelas 2..N mensalmente a partir da 1ª
  // (vencimentoData) sempre que a estrutura do parcelamento muda —
  // continuam editáveis uma a uma depois disso (parcelamento semestral/
  // anual/irregular)
  useEffect(() => {
    if (!parcelar) {
      setParcelasDatasExtras([])
      return
    }
    const n = parseInt(numParcelas, 10) || 2
    const extras = Math.max(n - 1, 0)
    setParcelasDatasExtras(vencimentoData ? Array.from({ length: extras }, (_, i) => somarMeses(vencimentoData, i + 1)) : Array(extras).fill(''))
  }, [parcelar, numParcelas, vencimentoData])

  useEffect(() => {
    if (!confirmarParcelar) {
      setConfirmarParcelasDatasExtras([])
      return
    }
    const n = parseInt(confirmarNumParcelas, 10) || 2
    const extras = Math.max(n - 1, 0)
    setConfirmarParcelasDatasExtras(
      confirmarVencimentoData ? Array.from({ length: extras }, (_, i) => somarMeses(confirmarVencimentoData, i + 1)) : Array(extras).fill('')
    )
  }, [confirmarParcelar, confirmarNumParcelas, confirmarVencimentoData])

  function atualizarParcelaExtra(i: number, novaData: string) {
    setParcelasDatasExtras((prev) => {
      const novo = [...prev]
      novo[i] = novaData
      return novo
    })
  }

  function atualizarConfirmarParcelaExtra(i: number, novaData: string) {
    setConfirmarParcelasDatasExtras((prev) => {
      const novo = [...prev]
      novo[i] = novaData
      return novo
    })
  }

  // cabeças de hoje por fazenda, buscadas só quando o rateio está aberto
  // e o critério é "por cabeça" — alimenta a prévia (todas as fazendas,
  // não só as selecionadas, pra ajudar a decidir quem incluir)
  useEffect(() => {
    if (!rateando || rateioCriterio !== 'POR_CABECA' || fazendas.length === 0) return
    let cancelado = false
    supabase.rpc('fn_resumo_rebanho_atual', { p_fazenda_ids: fazendas.map((f) => f.id) }).then(({ data: resumo }) => {
      if (cancelado) return
      const porFazenda: Record<string, number> = {}
      for (const linha of (resumo || []) as { fazenda_id: string; quantidade: number }[]) {
        porFazenda[linha.fazenda_id] = (porFazenda[linha.fazenda_id] || 0) + linha.quantidade
      }
      setRateioCabecasPorFazenda(porFazenda)
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateando, rateioCriterio, fazendas])

  // proporção em % de cada fazenda selecionada no rateio, conforme o
  // critério — só informativo (o cálculo real, com maior precisão, roda
  // de novo no submit); soma sempre 100% quando o total do critério é > 0
  const rateioProporcoesPreview = useMemo(() => {
    const ids = [...rateioFazendaIds]
    const out: Record<string, number> = {}
    if (ids.length === 0) return out
    if (rateioCriterio === 'POR_CABECA') {
      const total = ids.reduce((s, id) => s + (rateioCabecasPorFazenda[id] || 0), 0)
      if (total > 0) ids.forEach((id) => (out[id] = ((rateioCabecasPorFazenda[id] || 0) / total) * 100))
      return out
    }
    if (rateioCriterio === 'POR_AREA') {
      const total = ids.reduce((s, id) => s + (fazendas.find((f) => f.id === id)?.area_ha || 0), 0)
      if (total > 0) ids.forEach((id) => (out[id] = ((fazendas.find((f) => f.id === id)?.area_ha || 0) / total) * 100))
      return out
    }
    ids.forEach((id) => (out[id] = parseFloat(rateioPercentuais[id] || '0') || 0))
    return out
  }, [rateioFazendaIds, rateioCriterio, rateioCabecasPorFazenda, fazendas, rateioPercentuais])

  const rateioSomaPct = Object.values(rateioProporcoesPreview).reduce((s, v) => s + v, 0)

  async function carregarCatalogos() {
    const [{ data: fz }, { data: cl }, { data: ce }, { data: sc }, { data: pr }, { data: ps }, { data: prop }, { data: cb }, { data: ae }, { data: cfg }] =
      await Promise.all([
        supabase.from('fazendas').select('id, nome, area_ha').eq('ativo', true).order('nome'),
        supabase.from('classes_financeiras').select('id, numero, nome, tipo').order('numero'),
        supabase.from('centros_custo').select('id, classe_financeira_id, numero, nome').eq('ativo', true).order('numero'),
        supabase.from('subcentros_custo').select('id, centro_custo_id, numero, nome').eq('ativo', true).order('numero'),
        supabase.from('produtos_financeiros').select('id, nome, subcentro_custo_id, ativo').eq('ativo', true).order('nome'),
        supabase.from('pessoas').select('id, nome').eq('ativo', true).order('nome'),
        supabase.from('pessoa_papeis').select('pessoa:pessoas!pessoa_id(id, nome)').eq('papel', 'PROPRIETARIO'),
        supabase.from('contas_bancarias').select('id, nome, especie').eq('ativo', true).order('ordem'),
        supabase.from('atividades_economicas').select('id, nome').eq('ativo', true).order('ordem'),
        supabase.from('configuracoes').select('controla_contas_pagar_receber').single(),
      ])
    setFazendas((fz || []) as Fazenda[])
    setClasses((cl || []) as Classe[])
    setCentros((ce || []) as Centro[])
    setSubcentros((sc || []) as Subcentro[])
    setProdutos((pr || []) as Produto[])
    setPessoas((ps || []) as Pessoa[])
    setProprietarios(
      ((prop || []) as unknown as { pessoa: Pessoa | null }[])
        .map((r) => r.pessoa)
        .filter((p): p is Pessoa => !!p)
        .sort((a, b) => a.nome.localeCompare(b.nome))
    )
    setContasBancarias((cb || []) as ContaBancaria[])
    setAtividadesEconomicas((ae || []) as AtividadeEconomica[])
    setControlaContasPagarReceber(cfg?.controla_contas_pagar_receber ?? false)
  }

  async function carregarLancamentos() {
    setLoading(true)
    const { data: rows, error } = await supabase
      .from('lancamentos_financeiros')
      .select(
        '*, fazenda:fazendas(nome), produto:produtos_financeiros(nome), pessoa:pessoas!pessoa_id(nome), proprietario:pessoas!proprietario_id(nome), atividade:atividades_economicas(nome), subcentro:subcentros_custo(nome, centro:centros_custo(nome, classe:classes_financeiras(numero, nome, tipo))), baixas:lancamento_baixas(id, lancamento_id, numero_parcela, total_parcelas, data_vencimento, data_pagamento, valor, conta_bancaria_id, conta_bancaria:contas_bancarias(nome))'
      )
      .order('data', { ascending: false })
      .limit(100)
    if (!error) setLancamentos((rows || []) as unknown as Lancamento[])
    setLoading(false)
  }

  useEffect(() => {
    carregarCatalogos()
    carregarLancamentos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function limparFormulario() {
    setTipoLancamento('')
    setFazendaId('')
    setData(new Date().toISOString().slice(0, 10))
    setValor('')
    setDescricao('')
    setProdutoId('')
    setProdutoNovoNome('')
    setClasseId('')
    setCentroId('')
    setSubcentroId('')
    setRateando(false)
    setRateioCriterio('POR_CABECA')
    setRateioFazendaIds(new Set())
    setRateioPercentuais({})
    setPessoaId('')
    setProprietarioId('')
    setNumeroDocumento('')
    setAtividadeEconomicaId('')
    setPagamento('A_PAGAR')
    setPagamentoData(hojeISO())
    setPagamentoContaId('')
    setVencimentoData('')
    setParcelar(false)
    setNumParcelas('2')
  }

  // gera as linhas de lancamento_baixas pra um título de valor
  // `valorTotal` (a mesma divisão é aplicada a cada linha de título
  // independentemente — nunca recalcula rateio); as datas de vencimento
  // das parcelas 2..N vêm de parcelasDatasExtras (editáveis uma a uma),
  // a 1ª é sempre vencimentoData
  function gerarLinhasBaixa(
    valorTotal: number
  ): { numero_parcela: number; total_parcelas: number; data_vencimento: string | null; data_pagamento: string | null; valor: number; conta_bancaria_id: string | null }[] | null {
    if (pagamento === 'JA_PAGO') {
      if (!pagamentoContaId) {
        alert('Escolha a conta bancária (ou Dinheiro em espécie) do pagamento.')
        return null
      }
      return [
        {
          numero_parcela: 1,
          total_parcelas: 1,
          data_vencimento: null,
          data_pagamento: pagamentoData,
          valor: valorTotal,
          conta_bancaria_id: pagamentoContaId,
        },
      ]
    }
    if (!vencimentoData) {
      alert('Informe a data de vencimento.')
      return null
    }
    const n = parcelar ? parseInt(numParcelas, 10) || 1 : 1
    if (parcelar && n < 2) {
      alert('Informe pelo menos 2 parcelas, ou desmarque "Parcelar".')
      return null
    }
    const datas = [vencimentoData, ...parcelasDatasExtras].slice(0, n)
    if (datas.length !== n || datas.some((d) => !d)) {
      alert('Preencha a data de vencimento de todas as parcelas.')
      return null
    }
    let somaLancada = 0
    return Array.from({ length: n }, (_, i) => {
      const ultima = i === n - 1
      const valorParcela = ultima ? Math.round((valorTotal - somaLancada) * 100) / 100 : Math.round((valorTotal / n) * 100) / 100
      somaLancada += valorParcela
      return {
        numero_parcela: i + 1,
        total_parcelas: n,
        data_vencimento: datas[i],
        data_pagamento: null,
        valor: valorParcela,
        conta_bancaria_id: null,
      }
    })
  }

  async function handleCriarPessoa(e: React.FormEvent) {
    e.preventDefault()
    const nome = novaPessoaNome.trim()
    if (!nome) return
    setSalvandoPessoa(true)
    const { data: nova, error } = await supabase.from('pessoas').insert({ nome }).select('id, nome').single()
    if (error) {
      alert('Erro ao criar: ' + error.message)
      setSalvandoPessoa(false)
      return
    }
    const papel = tipoLancamento === 'CREDITO' ? 'CLIENTE' : 'FORNECEDOR'
    const { error: errorPapel } = await supabase.from('pessoa_papeis').insert({ pessoa_id: nova.id, papel })
    setSalvandoPessoa(false)
    if (errorPapel) {
      alert('Erro ao salvar papel: ' + errorPapel.message)
      return
    }
    setPessoas((prev) => [...prev, nova].sort((a, b) => a.nome.localeCompare(b.nome)))
    setPessoaId(nova.id)
    setModalPessoaAberto(false)
    setNovaPessoaNome('')
  }

  function handleFecharFormulario() {
    limparFormulario()
    setFormularioAberto(false)
  }

  function handleEscolherProduto(id: string) {
    setProdutoId(id)
    if (id === NOVO_PRODUTO) return
    const p = produtos.find((x) => x.id === id)
    if (!p || !p.subcentro_custo_id) return
    const sc = subcentros.find((s) => s.id === p.subcentro_custo_id)
    if (!sc) return
    const c = centros.find((x) => x.id === sc.centro_custo_id)
    const cl = c ? classes.find((x) => x.id === c.classe_financeira_id) : null
    if (cl) {
      setClasseId(cl.id)
      setTipoLancamento(cl.tipo)
    }
    if (c) setCentroId(c.id)
    setSubcentroId(sc.id)
  }

  // classificação também pode ser preenchida de trás pra frente: escolher
  // o Subcentro direto já resolve Centro/Classe/Tipo automaticamente
  function handleEscolherSubcentro(id: string) {
    setSubcentroId(id)
    if (!id) return
    const sc = subcentros.find((s) => s.id === id)
    if (!sc) return
    const c = centros.find((x) => x.id === sc.centro_custo_id)
    const cl = c ? classes.find((x) => x.id === c.classe_financeira_id) : null
    if (c) setCentroId(c.id)
    if (cl) {
      setClasseId(cl.id)
      setTipoLancamento(cl.tipo)
    }
  }

  // escolher o Tipo é sempre o primeiro passo — trocar de tipo invalida
  // qualquer classificação/produto já escolhidos (podiam ser do outro tipo)
  function handleEscolherTipo(tipo: 'CREDITO' | 'DEBITO') {
    setTipoLancamento(tipo)
    setClasseId('')
    setCentroId('')
    setSubcentroId('')
    setProdutoId('')
    setProdutoNovoNome('')
  }

  function alternarFazendaRateio(id: string) {
    setRateioFazendaIds((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  async function resolverProdutoId(): Promise<string | null> {
    if (produtoId === NOVO_PRODUTO) {
      const nome = produtoNovoNome.trim()
      if (!nome) return null
      const { data: novo, error } = await supabase
        .from('produtos_financeiros')
        .insert({ nome, subcentro_custo_id: subcentroId || null })
        .select('id')
        .single()
      if (error) {
        alert('Erro ao criar produto: ' + error.message)
        return null
      }
      return novo.id
    }
    return produtoId || null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const valorNum = parseFloat(valor.replace(',', '.'))
    if (!valorNum || valorNum <= 0) {
      alert('Informe um valor maior que zero.')
      return
    }
    if (!subcentroId) {
      alert('Escolha a classificação (Classe / Centro de Custo / Subcentro).')
      return
    }
    if (!data || !descricao.trim()) {
      alert('Preencha data e descrição.')
      return
    }
    if (!rateando && !fazendaId) {
      alert('Escolha a fazenda.')
      return
    }
    const fazendasSelecionadas = rateando ? [...rateioFazendaIds] : []
    if (rateando && fazendasSelecionadas.length < 2) {
      alert('Selecione pelo menos 2 fazendas pra ratear.')
      return
    }
    if (controlaContasPagarReceber && mostrarSeletorProprietario && !proprietarioId) {
      alert('Escolha o proprietário.')
      return
    }

    setSalvando(true)
    const produtoIdFinal = await resolverProdutoId()
    if (!produtoIdFinal) {
      setSalvando(false)
      return
    }

    const proprietarioIdFinal = controlaContasPagarReceber ? resolverProprietarioId(proprietarioId) : null
    const pessoaIdFinal = controlaContasPagarReceber ? pessoaId || null : null
    const numeroDocumentoFinal = controlaContasPagarReceber ? numeroDocumento.trim() || null : null
    // classificação de base, sempre disponível independente do recurso
    const atividadeEconomicaIdFinal = atividadeEconomicaId || null

    if (rateando) {
      let proporcoes: Record<string, number> = {}
      if (rateioCriterio === 'POR_CABECA') {
        const { data: resumo, error } = await supabase.rpc('fn_resumo_rebanho_atual', {
          p_fazenda_ids: fazendasSelecionadas,
        })
        if (error) {
          alert('Erro ao calcular rateio por cabeça: ' + error.message)
          setSalvando(false)
          return
        }
        const porFazenda: Record<string, number> = {}
        for (const linha of (resumo || []) as { fazenda_id: string; quantidade: number }[]) {
          porFazenda[linha.fazenda_id] = (porFazenda[linha.fazenda_id] || 0) + linha.quantidade
        }
        const total = fazendasSelecionadas.reduce((s, id) => s + (porFazenda[id] || 0), 0)
        if (total <= 0) {
          alert('Nenhuma das fazendas selecionadas tem cabeças hoje — não dá pra ratear por cabeça.')
          setSalvando(false)
          return
        }
        fazendasSelecionadas.forEach((id) => (proporcoes[id] = (porFazenda[id] || 0) / total))
      } else if (rateioCriterio === 'POR_AREA') {
        const total = fazendasSelecionadas.reduce((s, id) => s + (fazendas.find((f) => f.id === id)?.area_ha || 0), 0)
        if (total <= 0) {
          alert('Nenhuma das fazendas selecionadas tem área cadastrada — não dá pra ratear por área.')
          setSalvando(false)
          return
        }
        fazendasSelecionadas.forEach((id) => (proporcoes[id] = (fazendas.find((f) => f.id === id)?.area_ha || 0) / total))
      } else {
        const soma = fazendasSelecionadas.reduce((s, id) => s + (parseFloat(rateioPercentuais[id] || '0') || 0), 0)
        if (Math.abs(soma - 100) > 0.5) {
          alert(`Os percentuais precisam somar 100% (hoje somam ${soma.toFixed(1)}%).`)
          setSalvando(false)
          return
        }
        fazendasSelecionadas.forEach((id) => (proporcoes[id] = (parseFloat(rateioPercentuais[id] || '0') || 0) / 100))
      }

      const rateioGrupoId = crypto.randomUUID()
      let somaLancada = 0
      const linhas = fazendasSelecionadas.map((id, i) => {
        const ultimaLinha = i === fazendasSelecionadas.length - 1
        const valorLinha = ultimaLinha ? Math.round((valorNum - somaLancada) * 100) / 100 : Math.round(valorNum * proporcoes[id] * 100) / 100
        somaLancada += valorLinha
        return {
          fazenda_id: id,
          descricao: descricao.trim(),
          data,
          valor: valorLinha,
          subcentro_id: subcentroId,
          produto_id: produtoIdFinal,
          status: 'CONFIRMADO' as const,
          rateio_grupo_id: rateioGrupoId,
          pessoa_id: pessoaIdFinal,
          proprietario_id: proprietarioIdFinal,
          numero_documento: numeroDocumentoFinal,
          atividade_economica_id: atividadeEconomicaIdFinal,
        }
      })

      // valida o bloco de pagamento uma vez (mesmo formulário pra todas
      // as linhas) antes de gravar qualquer coisa
      const baixasPorValor = linhas.map((l) => gerarLinhasBaixa(l.valor))
      if (baixasPorValor.some((b) => b === null)) {
        setSalvando(false)
        return
      }

      const { data: inseridos, error } = await supabase.from('lancamentos_financeiros').insert(linhas).select('id, valor')
      if (error) {
        setSalvando(false)
        alert('Erro ao salvar lançamento rateado: ' + error.message)
        return
      }

      const todasBaixas = (inseridos || []).flatMap((row, i) =>
        (baixasPorValor[i] || []).map((b) => ({ ...b, lancamento_id: row.id }))
      )
      if (todasBaixas.length > 0) {
        const { error: errorBaixa } = await supabase.from('lancamento_baixas').insert(todasBaixas)
        setSalvando(false)
        if (errorBaixa) {
          alert('Lançamento salvo, mas houve erro ao registrar o pagamento: ' + errorBaixa.message)
          await Promise.all([carregarCatalogos(), carregarLancamentos()])
          return
        }
      } else {
        setSalvando(false)
      }
    } else {
      const baixas = gerarLinhasBaixa(valorNum)
      if (baixas === null) {
        setSalvando(false)
        return
      }

      const { data: inserido, error } = await supabase
        .from('lancamentos_financeiros')
        .insert({
          fazenda_id: fazendaId,
          descricao: descricao.trim(),
          data,
          valor: valorNum,
          subcentro_id: subcentroId,
          produto_id: produtoIdFinal,
          status: 'CONFIRMADO',
          pessoa_id: pessoaIdFinal,
          proprietario_id: proprietarioIdFinal,
          numero_documento: numeroDocumentoFinal,
          atividade_economica_id: atividadeEconomicaIdFinal,
        })
        .select('id')
        .single()
      if (error) {
        setSalvando(false)
        alert('Erro ao salvar lançamento: ' + error.message)
        return
      }

      if (baixas.length > 0) {
        const { error: errorBaixa } = await supabase
          .from('lancamento_baixas')
          .insert(baixas.map((b) => ({ ...b, lancamento_id: inserido.id })))
        setSalvando(false)
        if (errorBaixa) {
          alert('Lançamento salvo, mas houve erro ao registrar o pagamento: ' + errorBaixa.message)
          await Promise.all([carregarCatalogos(), carregarLancamentos()])
          return
        }
      } else {
        setSalvando(false)
      }
    }

    handleFecharFormulario()
    await Promise.all([carregarCatalogos(), carregarLancamentos()])
  }

  async function handleConfirmar(l: Lancamento) {
    const { error } = await supabase
      .from('lancamentos_financeiros')
      .update({ status: 'CONFIRMADO', confirmado_por: usuarioApp?.id ?? null, confirmado_em: new Date().toISOString() })
      .eq('id', l.id)
    if (error) alert('Erro ao confirmar: ' + error.message)
    else await carregarLancamentos()
    setPainelConfirmarId(null)
  }

  function abrirPainelConfirmar(l: Lancamento) {
    setPainelConfirmarId(l.id)
    setConfirmarPagamento('A_PAGAR')
    setConfirmarPagamentoData(hojeISO())
    setConfirmarPagamentoContaId('')
    setConfirmarVencimentoData('')
    setConfirmarParcelar(false)
    setConfirmarNumParcelas('2')
    setConfirmarParcelasDatasExtras([])
  }

  // Confirmar + Dar baixa no mesmo passo, só quando o recurso está
  // contratado — mesma divisão de parcelas de gerarLinhasBaixa, só que
  // lendo o estado do painel de confirmação em vez do formulário de
  // "+ Novo Lançamento" (automáticos nunca passam por ele, nascem
  // Pendente sozinhos)
  async function handleConfirmarComBaixa(l: Lancamento) {
    if (confirmarPagamento === 'JA_PAGO' && !confirmarPagamentoContaId) {
      alert('Escolha a conta bancária (ou Dinheiro em espécie) do pagamento.')
      return
    }
    if (confirmarPagamento === 'A_PAGAR') {
      const n = confirmarParcelar ? parseInt(confirmarNumParcelas, 10) || 1 : 1
      const datas = [confirmarVencimentoData, ...confirmarParcelasDatasExtras].slice(0, n)
      if (datas.length !== n || datas.some((d) => !d)) {
        alert('Preencha a data de vencimento de todas as parcelas.')
        return
      }
    }
    setConfirmando(true)

    const { error } = await supabase
      .from('lancamentos_financeiros')
      .update({ status: 'CONFIRMADO', confirmado_por: usuarioApp?.id ?? null, confirmado_em: new Date().toISOString() })
      .eq('id', l.id)
    if (error) {
      setConfirmando(false)
      alert('Erro ao confirmar: ' + error.message)
      return
    }

    type BaixaNova = {
      lancamento_id: string
      numero_parcela: number
      total_parcelas: number
      data_vencimento: string | null
      data_pagamento: string | null
      valor: number
      conta_bancaria_id: string | null
    }

    const baixas: BaixaNova[] =
      confirmarPagamento === 'JA_PAGO'
        ? [
            {
              lancamento_id: l.id,
              numero_parcela: 1,
              total_parcelas: 1,
              data_vencimento: null,
              data_pagamento: confirmarPagamentoData,
              valor: l.valor,
              conta_bancaria_id: confirmarPagamentoContaId,
            },
          ]
        : (() => {
            const n = confirmarParcelar ? parseInt(confirmarNumParcelas, 10) || 1 : 1
            const datas = [confirmarVencimentoData, ...confirmarParcelasDatasExtras].slice(0, n)
            let somaLancada = 0
            return Array.from({ length: n }, (_, i) => {
              const ultima = i === n - 1
              const valorParcela = ultima ? Math.round((l.valor - somaLancada) * 100) / 100 : Math.round((l.valor / n) * 100) / 100
              somaLancada += valorParcela
              return {
                lancamento_id: l.id,
                numero_parcela: i + 1,
                total_parcelas: n,
                data_vencimento: datas[i],
                data_pagamento: null,
                valor: valorParcela,
                conta_bancaria_id: null,
              }
            })
          })()

    const { error: errorBaixa } = await supabase.from('lancamento_baixas').insert(baixas)
    setConfirmando(false)
    setPainelConfirmarId(null)
    if (errorBaixa) alert('Confirmado, mas houve erro ao registrar o pagamento: ' + errorBaixa.message)
    await carregarLancamentos()
  }

  async function handleExcluir(id: string) {
    const { error } = await supabase.from('lancamentos_financeiros').delete().eq('id', id)
    setConfirmarExclusaoId(null)
    if (error) alert('Erro ao excluir: ' + error.message)
    else await carregarLancamentos()
  }

  async function handleEstornar(id: string) {
    const { error } = await supabase
      .from('lancamentos_financeiros')
      .update({ status: 'PENDENTE', confirmado_por: null, confirmado_em: null })
      .eq('id', id)
    setConfirmarEstornoId(null)
    if (error) alert('Erro ao estornar: ' + error.message)
    else await carregarLancamentos()
  }

  const centrosDaClasse = centros.filter((c) => c.classe_financeira_id === classeId)
  const subcentrosDoCentro = subcentros.filter((s) => s.centro_custo_id === centroId)

  // classificação também aceita ser preenchida de trás pra frente — sem
  // Centro escolhido ainda, o select de Subcentro lista todos os
  // subcentros do Tipo/Classe já conhecidos, agrupados por Centro
  const subcentrosVisiveis = useMemo(() => {
    if (centroId) return { modo: 'lista' as const, subcentros: subcentrosDoCentro }
    const filtrados = subcentros.filter((s) => {
      const c = centros.find((x) => x.id === s.centro_custo_id)
      if (!c) return false
      if (classeId) return c.classe_financeira_id === classeId
      if (tipoLancamento) {
        const cl = classes.find((x) => x.id === c.classe_financeira_id)
        return cl?.tipo === tipoLancamento
      }
      return false
    })
    const porCentro = new Map<string, Subcentro[]>()
    for (const s of filtrados) {
      const arr = porCentro.get(s.centro_custo_id) || []
      arr.push(s)
      porCentro.set(s.centro_custo_id, arr)
    }
    return {
      modo: 'agrupado' as const,
      grupos: [...porCentro.entries()].map(([cId, subs]) => ({ centro: centros.find((c) => c.id === cId), subs })),
    }
  }, [centroId, classeId, tipoLancamento, subcentros, centros, classes, subcentrosDoCentro])

  const labelPessoa = tipoLancamento === 'CREDITO' ? 'Cliente' : tipoLancamento === 'DEBITO' ? 'Fornecedor' : 'Fornecedor/Cliente'
  const labelJaPago = tipoLancamento === 'CREDITO' ? 'Já foi recebido' : 'Já foi pago'
  const labelAPagar = tipoLancamento === 'CREDITO' ? 'A receber' : 'A pagar'

  const pendentes = lancamentos.filter((l) => l.status === 'PENDENTE')

  const lancamentosFiltrados = lancamentos.filter((l) => {
    if (filtroStatus !== 'TODOS' && l.status !== filtroStatus) return false
    if (filtroFazendaId && l.fazenda_id !== filtroFazendaId) return false
    if (filtroAtividadeId && l.atividade_economica_id !== filtroAtividadeId) return false
    return true
  })

  const gruposRateio = useMemo(() => {
    const mapa = new Map<string, Lancamento[]>()
    const avulsos: Lancamento[] = []
    for (const l of lancamentosFiltrados) {
      if (l.status === 'PENDENTE') continue
      if (l.rateio_grupo_id) {
        const arr = mapa.get(l.rateio_grupo_id) || []
        arr.push(l)
        mapa.set(l.rateio_grupo_id, arr)
      } else {
        avulsos.push(l)
      }
    }
    return { grupos: [...mapa.values()], avulsos }
  }, [lancamentosFiltrados])

  return (
    <ModuloGate modulo="lancamentos_financeiros">
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Lançamentos Financeiros</h1>
        <p className="mt-1 text-sm text-text-secondary">Receitas e despesas por fazenda, classificadas pelo plano de contas.</p>

        {pendentes.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-warning">
              Pendentes de conferência ({pendentes.length})
            </h2>
            <div className="mt-2 space-y-2">
              {pendentes.map((l) => (
                <div key={l.id} className="rounded-card border border-warning bg-warning-bg p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {l.fazenda?.nome} · {l.produto?.nome}
                      </p>
                      <p className="text-xs text-text-secondary">{labelClassificacao(l)}</p>
                      <p className="mt-1 text-sm font-semibold tabular-nums text-text-primary">{formatMoeda(l.valor)}</p>
                    </div>
                    {painelConfirmarId !== l.id && (
                      <button
                        type="button"
                        onClick={() => (controlaContasPagarReceber ? abrirPainelConfirmar(l) : handleConfirmar(l))}
                        className="rounded-control bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500-hover"
                      >
                        Confirmar
                      </button>
                    )}
                  </div>
                  {l.movimentacao_id && (
                    <p className="mt-2 text-xs text-text-secondary">
                      Valor errado? Não ajuste aqui —{' '}
                      <a href="/movimentacoes" className="font-medium text-brand-500 hover:underline">
                        edite a movimentação de origem
                      </a>
                      .
                    </p>
                  )}

                  {painelConfirmarId === l.id && (
                    <div className="mt-3 space-y-3 border-t border-warning/40 pt-3">
                      <div className="flex gap-4 text-sm">
                        <label className="flex items-center gap-1.5 text-text-primary">
                          <input
                            type="radio"
                            className="accent-brand-500"
                            checked={confirmarPagamento === 'JA_PAGO'}
                            onChange={() => setConfirmarPagamento('JA_PAGO')}
                          />
                          {l.tipo === 'CREDITO' ? 'Já foi recebido' : 'Já foi pago'}
                        </label>
                        <label className="flex items-center gap-1.5 text-text-primary">
                          <input
                            type="radio"
                            className="accent-brand-500"
                            checked={confirmarPagamento === 'A_PAGAR'}
                            onChange={() => setConfirmarPagamento('A_PAGAR')}
                          />
                          {l.tipo === 'CREDITO' ? 'A receber' : 'A pagar'}
                        </label>
                      </div>

                      {confirmarPagamento === 'JA_PAGO' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={LABEL_CLASS}>
                              Data do pagamento<Required />
                            </label>
                            <input
                              type="date"
                              required
                              value={confirmarPagamentoData}
                              onChange={(e) => setConfirmarPagamentoData(e.target.value)}
                              className={SELECT_CLASS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>
                              Conta<Required />
                            </label>
                            <select
                              required
                              value={confirmarPagamentoContaId}
                              onChange={(e) => setConfirmarPagamentoContaId(e.target.value)}
                              className={SELECT_CLASS}
                            >
                              <option value="">Selecione...</option>
                              {contasBancarias.map((cb) => (
                                <option key={cb.id} value={cb.id}>
                                  {cb.nome}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <label className={LABEL_CLASS}>
                              Vencimento<Required />
                            </label>
                            <input
                              type="date"
                              required
                              value={confirmarVencimentoData}
                              onChange={(e) => setConfirmarVencimentoData(e.target.value)}
                              className={`${SELECT_CLASS} max-w-xs`}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                            <input
                              type="checkbox"
                              className="accent-brand-500"
                              checked={confirmarParcelar}
                              onChange={(e) => setConfirmarParcelar(e.target.checked)}
                            />
                            Parcelar
                          </label>
                          {confirmarParcelar && (
                            <>
                              <div className="max-w-[140px]">
                                <label className={LABEL_CLASS}>Nº de parcelas</label>
                                <input
                                  type="number"
                                  min={2}
                                  value={confirmarNumParcelas}
                                  onChange={(e) => setConfirmarNumParcelas(e.target.value)}
                                  className={SELECT_CLASS}
                                />
                              </div>
                              {confirmarParcelasDatasExtras.map((d, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="w-28 shrink-0 text-xs text-text-secondary">
                                    Parcela {i + 2} de {confirmarNumParcelas}
                                  </span>
                                  <input
                                    type="date"
                                    required
                                    value={d}
                                    onChange={(e) => atualizarConfirmarParcelaExtra(i, e.target.value)}
                                    className={`${SELECT_CLASS} max-w-xs`}
                                  />
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="button"
                          disabled={confirmando}
                          onClick={() => handleConfirmarComBaixa(l)}
                          className="rounded-control bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
                        >
                          {confirmando ? 'Confirmando...' : 'Confirmar'}
                        </button>
                        <button type="button" onClick={() => handleConfirmar(l)} className="text-sm font-medium text-text-secondary hover:underline">
                          Pular por enquanto
                        </button>
                        <button type="button" onClick={() => setPainelConfirmarId(null)} className="text-sm font-medium text-text-secondary hover:underline">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          {!formularioAberto ? (
            <button
              type="button"
              onClick={() => setFormularioAberto(true)}
              className="flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-brand-500 bg-brand-100/40 px-4 py-4 text-sm font-semibold text-brand-700 hover:bg-brand-100"
            >
              + Novo Lançamento
            </button>
          ) : (
            <div className="rounded-card border border-border bg-surface p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-bold text-text-primary">Novo lançamento</h2>
                <button type="button" onClick={handleFecharFormulario} className="text-sm font-medium text-text-secondary hover:underline">
                  Fechar
                </button>
              </div>

              <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="space-y-4">
                <div>
                  <label className={LABEL_CLASS}>
                    Tipo<Required />
                  </label>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-1.5 text-text-primary">
                      <input
                        type="radio"
                        required
                        className="accent-brand-500"
                        checked={tipoLancamento === 'CREDITO'}
                        onChange={() => handleEscolherTipo('CREDITO')}
                      />
                      Receita
                    </label>
                    <label className="flex items-center gap-1.5 text-text-primary">
                      <input
                        type="radio"
                        required
                        className="accent-brand-500"
                        checked={tipoLancamento === 'DEBITO'}
                        onChange={() => handleEscolherTipo('DEBITO')}
                      />
                      Despesa
                    </label>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={LABEL_CLASS}>
                      Data de emissão<Required />
                    </label>
                    <input type="date" required value={data} onChange={(e) => setData(e.target.value)} className={SELECT_CLASS} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>
                      Valor<Required />
                    </label>
                    <input
                      required
                      inputMode="decimal"
                      placeholder="0,00"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      className={SELECT_CLASS}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>
                    Descrição<Required />
                  </label>
                  <input required value={descricao} onChange={(e) => setDescricao(e.target.value)} className={SELECT_CLASS} />
                </div>

                <div>
                  <label className={LABEL_CLASS}>
                    Produto/Serviço<Required />
                  </label>
                  <select required value={produtoId} onChange={(e) => handleEscolherProduto(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Selecione...</option>
                    {produtos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                    <option value={NOVO_PRODUTO}>+ Novo produto/serviço...</option>
                  </select>
                  {produtoId === NOVO_PRODUTO && (
                    <input
                      required
                      autoFocus
                      placeholder="Nome do novo produto/serviço"
                      value={produtoNovoNome}
                      onChange={(e) => setProdutoNovoNome(e.target.value)}
                      className={`${SELECT_CLASS} mt-2`}
                    />
                  )}
                </div>

                <div>
                  <label className={LABEL_CLASS}>
                    Classificação (Classe / Centro de Custo / Subcentro)<Required />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      required
                      disabled={!tipoLancamento}
                      value={classeId}
                      onChange={(e) => {
                        setClasseId(e.target.value)
                        setCentroId('')
                        setSubcentroId('')
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="">Classe...</option>
                      {classes
                        .filter((cl) => !tipoLancamento || cl.tipo === tipoLancamento)
                        .map((cl) => (
                          <option key={cl.id} value={cl.id}>
                            {cl.numero} — {cl.nome}
                          </option>
                        ))}
                    </select>
                    <select
                      required
                      disabled={!classeId}
                      value={centroId}
                      onChange={(e) => {
                        setCentroId(e.target.value)
                        setSubcentroId('')
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="">Centro de custo...</option>
                      {centrosDaClasse.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                    <select
                      required
                      disabled={!tipoLancamento}
                      value={subcentroId}
                      onChange={(e) => handleEscolherSubcentro(e.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">Subcentro...</option>
                      {subcentrosVisiveis.modo === 'lista'
                        ? subcentrosVisiveis.subcentros.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.nome}
                            </option>
                          ))
                        : subcentrosVisiveis.grupos.map(({ centro, subs }) => (
                            <optgroup key={centro?.id || 'x'} label={centro?.nome || '—'}>
                              {subs.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.nome}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                    </select>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Pode preencher em qualquer ordem — escolher o Subcentro direto já resolve o Centro e a Classe sozinho.
                  </p>
                </div>

                {atividadesEconomicas.length > 0 && (
                  <div>
                    <label className={LABEL_CLASS}>Atividade Econômica</label>
                    <select value={atividadeEconomicaId} onChange={(e) => setAtividadeEconomicaId(e.target.value)} className={SELECT_CLASS}>
                      <option value="">Selecione...</option>
                      {atividadesEconomicas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nome}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-text-muted">
                      A qual negócio esse lançamento pertence — útil se você opera mais de uma atividade.
                    </p>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <input type="checkbox" className="accent-brand-500" checked={rateando} onChange={(e) => setRateando(e.target.checked)} />
                  Ratear entre fazendas
                </label>

                {!rateando ? (
                  <div>
                    <label className={LABEL_CLASS}>
                      Fazenda<Required />
                    </label>
                    <select required value={fazendaId} onChange={(e) => setFazendaId(e.target.value)} className={SELECT_CLASS}>
                      <option value="">Selecione...</option>
                      {fazendas.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-control border border-border p-3">
                    <div>
                      <label className={LABEL_CLASS}>Critério</label>
                      <select value={rateioCriterio} onChange={(e) => setRateioCriterio(e.target.value as typeof rateioCriterio)} className={SELECT_CLASS}>
                        <option value="POR_CABECA">Por cabeça de gado</option>
                        <option value="POR_AREA">Por área da fazenda</option>
                        <option value="PERCENTUAL_FIXO">Percentual fixo</option>
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>Fazendas incluídas</label>
                      <div className="space-y-1.5">
                        {fazendas.map((f) => {
                          const selecionada = rateioFazendaIds.has(f.id)
                          const pct = rateioProporcoesPreview[f.id]
                          return (
                            <div key={f.id} className="flex flex-wrap items-center gap-2">
                              <label className="flex flex-1 items-center gap-2 text-sm text-text-primary">
                                <input
                                  type="checkbox"
                                  className="accent-brand-500"
                                  checked={selecionada}
                                  onChange={() => alternarFazendaRateio(f.id)}
                                />
                                {f.nome}
                              </label>
                              {rateioCriterio === 'POR_CABECA' && (
                                <span className="text-xs tabular-nums text-text-muted">
                                  {rateioCabecasPorFazenda[f.id] != null ? `${formatQuantidade(rateioCabecasPorFazenda[f.id])} cab.` : '—'}
                                </span>
                              )}
                              {rateioCriterio === 'POR_AREA' && (
                                <span className="text-xs tabular-nums text-text-muted">{f.area_ha != null ? `${formatArea(f.area_ha)} ha` : '—'}</span>
                              )}
                              {rateioCriterio === 'PERCENTUAL_FIXO' && selecionada && (
                                <input
                                  inputMode="decimal"
                                  placeholder="%"
                                  value={rateioPercentuais[f.id] || ''}
                                  onChange={(e) => setRateioPercentuais((prev) => ({ ...prev, [f.id]: e.target.value }))}
                                  className="w-20 rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
                                />
                              )}
                              {selecionada && (
                                <span className="w-16 text-right text-xs font-semibold tabular-nums text-text-secondary">
                                  {pct != null ? `${pct.toFixed(1)}%` : '—'}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {rateioFazendaIds.size > 0 && (
                      <p className="text-xs text-text-secondary">
                        Total do rateio:{' '}
                        <span className={`font-semibold ${Math.abs(rateioSomaPct - 100) > 0.5 ? 'text-error' : 'text-success'}`}>
                          {rateioSomaPct.toFixed(1)}%
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {controlaContasPagarReceber && (
                  <div className="space-y-4 rounded-control border border-border p-3">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">{labelPessoa}</label>
                        <button type="button" onClick={() => setModalPessoaAberto(true)} className="text-xs font-medium text-brand-500 hover:underline">
                          + Novo
                        </button>
                      </div>
                      <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} className={SELECT_CLASS}>
                        <option value="">Selecione...</option>
                        {pessoas.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </div>

                    {mostrarSeletorProprietario && (
                      <div>
                        <label className={LABEL_CLASS}>
                          Proprietário<Required />
                        </label>
                        <select required value={proprietarioId} onChange={(e) => setProprietarioId(e.target.value)} className={SELECT_CLASS}>
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
                      <label className={LABEL_CLASS}>Número de documento</label>
                      <input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} className={SELECT_CLASS} />
                    </div>

                    <div>
                      <label className={LABEL_CLASS}>Status do pagamento</label>
                      <div className="flex gap-4 text-sm">
                        <label className="flex items-center gap-1.5 text-text-primary">
                          <input type="radio" className="accent-brand-500" checked={pagamento === 'JA_PAGO'} onChange={() => setPagamento('JA_PAGO')} />
                          {labelJaPago}
                        </label>
                        <label className="flex items-center gap-1.5 text-text-primary">
                          <input type="radio" className="accent-brand-500" checked={pagamento === 'A_PAGAR'} onChange={() => setPagamento('A_PAGAR')} />
                          {labelAPagar}
                        </label>
                      </div>
                    </div>

                    {pagamento === 'JA_PAGO' && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className={LABEL_CLASS}>
                            Data do pagamento<Required />
                          </label>
                          <input type="date" required value={pagamentoData} onChange={(e) => setPagamentoData(e.target.value)} className={SELECT_CLASS} />
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>
                            Conta<Required />
                          </label>
                          <select required value={pagamentoContaId} onChange={(e) => setPagamentoContaId(e.target.value)} className={SELECT_CLASS}>
                            <option value="">Selecione...</option>
                            {contasBancarias.map((cb) => (
                              <option key={cb.id} value={cb.id}>
                                {cb.nome}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {pagamento === 'A_PAGAR' && (
                      <div className="space-y-3">
                        <div>
                          <label className={LABEL_CLASS}>
                            Vencimento<Required />
                          </label>
                          <input
                            type="date"
                            required
                            value={vencimentoData}
                            onChange={(e) => setVencimentoData(e.target.value)}
                            className={`${SELECT_CLASS} max-w-xs`}
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                          <input type="checkbox" className="accent-brand-500" checked={parcelar} onChange={(e) => setParcelar(e.target.checked)} />
                          Parcelar
                        </label>
                        {parcelar && (
                          <>
                            <div className="max-w-[140px]">
                              <label className={LABEL_CLASS}>Nº de parcelas</label>
                              <input type="number" min={2} value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} className={SELECT_CLASS} />
                            </div>
                            {parcelasDatasExtras.map((d, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="w-28 shrink-0 text-xs text-text-secondary">
                                  Parcela {i + 2} de {numParcelas}
                                </span>
                                <input
                                  type="date"
                                  required
                                  value={d}
                                  onChange={(e) => atualizarParcelaExtra(i, e.target.value)}
                                  className={`${SELECT_CLASS} max-w-xs`}
                                />
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={handleFecharFormulario} className="rounded-control border border-border px-4 py-2 text-sm text-text-primary">
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
          )}
        </div>

        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Lançamentos</h2>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)} className="ml-auto rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary">
              <option value="TODOS">Todos os status</option>
              <option value="PENDENTE">Pendente</option>
              <option value="CONFIRMADO">Confirmado</option>
            </select>
            <select value={filtroFazendaId} onChange={(e) => setFiltroFazendaId(e.target.value)} className="rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary">
              <option value="">Todas as fazendas</option>
              {fazendas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
            {atividadesEconomicas.length > 0 && (
              <select value={filtroAtividadeId} onChange={(e) => setFiltroAtividadeId(e.target.value)} className="rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary">
                <option value="">Todas as atividades</option>
                {atividadesEconomicas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded-card bg-border" />
              <div className="h-16 animate-pulse rounded-card bg-border" />
            </div>
          ) : gruposRateio.grupos.length === 0 && gruposRateio.avulsos.length === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-semibold text-text-primary">Nenhum lançamento confirmado ainda</p>
              <p className="mt-1 text-sm text-text-secondary">Lance uma receita ou despesa pra começar.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {gruposRateio.avulsos.map((l) => (
                <div key={l.id} className="rounded-card border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {l.fazenda?.nome} · {l.produto?.nome}
                      </p>
                      <p className="text-xs text-text-secondary">{labelClassificacao(l)} · {l.data.split('-').reverse().join('/')}</p>
                      <p className="text-xs text-text-muted">{l.descricao}</p>
                      {(l.pessoa || l.proprietario || l.atividade) && (
                        <p className="text-xs text-text-muted">
                          {l.pessoa && <>Fornecedor/Cliente: {l.pessoa.nome} </>}
                          {l.proprietario && <>· Propriet.: {l.proprietario.nome} </>}
                          {l.atividade && <>· Atividade: {l.atividade.nome}</>}
                        </p>
                      )}
                      {l.baixas.length > 0 && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
                          <BadgeStatusBaixa status={l.baixas.length > 1 ? statusBaixa(l.baixas.find((b) => !b.data_pagamento) || l.baixas[0]) : statusBaixa(l.baixas[0])} />
                          {resumoPagamento(l)}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${l.tipo === 'CREDITO' ? 'text-success' : 'text-text-primary'}`}>
                      {l.tipo === 'DEBITO' ? '− ' : ''}
                      {formatMoeda(l.valor)}
                    </span>
                  </div>
                  {!l.movimentacao_id &&
                    (confirmarExclusaoId === l.id ? (
                      <div className="mt-2 flex items-center gap-3 border-t border-border pt-2 text-sm">
                        <span className="text-error">Excluir este lançamento?</span>
                        <button type="button" onClick={() => handleExcluir(l.id)} className="font-medium text-error hover:underline">
                          Sim, excluir
                        </button>
                        <button type="button" onClick={() => setConfirmarExclusaoId(null)} className="text-text-secondary hover:underline">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 border-t border-border pt-2">
                        <button
                          type="button"
                          onClick={() => setConfirmarExclusaoId(l.id)}
                          className="text-xs font-medium text-text-secondary hover:text-error hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    ))}
                  {l.movimentacao_id &&
                    (confirmarEstornoId === l.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-sm">
                        <span className="text-warning">Estornar? O lançamento volta pra "Pendente de conferência".</span>
                        <button type="button" onClick={() => handleEstornar(l.id)} className="font-medium text-warning hover:underline">
                          Sim, estornar
                        </button>
                        <button type="button" onClick={() => setConfirmarEstornoId(null)} className="text-text-secondary hover:underline">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2">
                        <p className="text-xs text-text-muted">
                          Confirmado — pra editar ou excluir a movimentação de origem, estorne este lançamento antes.
                        </p>
                        <button
                          type="button"
                          onClick={() => setConfirmarEstornoId(l.id)}
                          className="shrink-0 text-xs font-medium text-text-secondary hover:text-warning hover:underline"
                        >
                          Estornar
                        </button>
                      </div>
                    ))}
                </div>
              ))}

              {gruposRateio.grupos.map((grupo) => {
                const primeiro = grupo[0]
                const total = grupo.reduce((s, l) => s + l.valor, 0)
                return (
                  <div key={primeiro.rateio_grupo_id} className="rounded-card border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">
                          Rateado entre {grupo.length} fazendas · {primeiro.produto?.nome}
                        </p>
                        <p className="text-xs text-text-secondary">{labelClassificacao(primeiro)} · {primeiro.data.split('-').reverse().join('/')}</p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${primeiro.tipo === 'CREDITO' ? 'text-success' : 'text-text-primary'}`}>
                        {primeiro.tipo === 'DEBITO' ? '− ' : ''}
                        {formatMoeda(total)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      {grupo.map((l) => (
                        <div key={l.id} className="flex justify-between text-xs text-text-secondary">
                          <span>{l.fazenda?.nome}</span>
                          <span className="tabular-nums">{formatMoeda(l.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {modalPessoaAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleCriarPessoa}
            onKeyDown={bloquearEnvioPorEnter}
            className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5"
          >
            <h3 className="text-sm font-bold text-text-primary">Novo fornecedor/cliente</h3>
            <div>
              <label className={LABEL_CLASS}>
                Nome<Required />
              </label>
              <input required autoFocus value={novaPessoaNome} onChange={(e) => setNovaPessoaNome(e.target.value)} className={SELECT_CLASS} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setModalPessoaAberto(false)
                  setNovaPessoaNome('')
                }}
                className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoPessoa}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
              >
                {salvandoPessoa ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </ModuloGate>
  )
}
