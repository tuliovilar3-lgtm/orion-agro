'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatMoeda, formatQuantidade, formatPeso, formatDecimal } from '@/lib/format'
import { PAPEIS_BEZERRO_MAMANDO } from '@/lib/faixa-etaria'
import { safraSugeridaParaData, formatSafra, extrairAnoSafraDigitado, formatSafraInput } from '@/lib/periodo'
import ModuloGate from '@/components/ModuloGate'

type TipoMovimentacao =
  | 'NASCIMENTO'
  | 'DESMAME'
  | 'COMPRA'
  | 'VENDA_PE'
  | 'VENDA_ABATE'
  | 'MORTE'
  | 'CONSUMO_DOACAO'
  | 'MUDANCA_CATEGORIA'
  | 'TRANSFERENCIA'

type SubtipoConsumoDoacao = 'CONSUMO_INTERNO' | 'DOACAO'
type TipoClienteFornecedor = 'CLIENTE' | 'FORNECEDOR' | 'AMBOS'
type PapelPessoa = 'CLIENTE' | 'FORNECEDOR'
type TipoAjuste = 'DESCONTO' | 'ACRESCIMO'

const NOVO_ITEM_AJUSTE = '__novo__'

const TIPOS: TipoMovimentacao[] = [
  'NASCIMENTO',
  'DESMAME',
  'COMPRA',
  'VENDA_PE',
  'VENDA_ABATE',
  'MORTE',
  'CONSUMO_DOACAO',
  'MUDANCA_CATEGORIA',
  'TRANSFERENCIA',
]

const LABEL_TIPO: Record<TipoMovimentacao, string> = {
  NASCIMENTO: 'Nascimento',
  DESMAME: 'Desmame',
  COMPRA: 'Compra',
  VENDA_PE: 'Venda em Pé',
  VENDA_ABATE: 'Venda Abate',
  MORTE: 'Morte',
  CONSUMO_DOACAO: 'Consumo/Doação',
  MUDANCA_CATEGORIA: 'Mudança de Categoria',
  TRANSFERENCIA: 'Transferência',
}

const TIPOS_SIMPLES: TipoMovimentacao[] = ['NASCIMENTO', 'DESMAME', 'MORTE']
const TIPOS_COM_PRECO: TipoMovimentacao[] = ['COMPRA', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO', 'TRANSFERENCIA']
// desconto/acréscimo só vale nos 4 tipos com valor_total que são comerciais de
// verdade — TRANSFERENCIA tem valor_total (pra contabilizar internamente),
// mas não é venda/compra, e o banco rejeita ajuste nela (ver
// fn_validar_ajuste_movimentacao_comercial)
const TIPOS_COM_AJUSTE: TipoMovimentacao[] = ['COMPRA', 'VENDA_PE', 'VENDA_ABATE', 'CONSUMO_DOACAO']
const TIPOS_COM_CLIENTE: TipoMovimentacao[] = ['COMPRA', 'VENDA_PE', 'VENDA_ABATE']
// nascimento e compra só entram animais na categoria — não há saldo a checar
const TIPOS_SEM_CHECAGEM_SALDO: TipoMovimentacao[] = ['NASCIMENTO', 'COMPRA']
// tipos onde é comum lançar mais de uma categoria de uma vez (ex.: vender
// garrotes e novilhas pro mesmo comprador no mesmo dia) — cada linha vira
// uma movimentação própria no banco, exatamente como se fossem lançadas
// separadamente. MUDANCA_CATEGORIA e DESMAME ficam de fora porque cada um
// já tem duas categorias (origem+destino) por lançamento, o que tornaria
// uma linha de lote bem mais complexa (duplo seletor por linha)
const TIPOS_COM_LOTE: TipoMovimentacao[] = [
  'NASCIMENTO',
  'MORTE',
  'COMPRA',
  'VENDA_PE',
  'VENDA_ABATE',
  'CONSUMO_DOACAO',
  'TRANSFERENCIA',
]

const CAMPOS_PRECO = [
  { key: 'valor_arroba', label: 'Valor por arroba (R$/@)' },
  { key: 'valor_cabeca', label: 'Valor por cabeça (R$)' },
  { key: 'valor_kg', label: 'Valor por kg (R$)' },
  { key: 'valor_total', label: 'Valor total (R$)' },
] as const

type CampoPreco = (typeof CAMPOS_PRECO)[number]['key']

// labels curtos dos mesmos 4 campos — usados só no <select> compacto da
// tabela de lote (passo 3), onde o rótulo completo ("Valor por arroba
// (R$/@)") ficava cortado pela largura da coluna
const CAMPOS_PRECO_CURTO: Record<CampoPreco, string> = {
  valor_arroba: 'R$/@',
  valor_cabeca: 'R$/cab.',
  valor_kg: 'R$/kg',
  valor_total: 'R$ total',
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------
// redesign: ícone + cor por direção (entrada/saída/interno). Nunca usa
// success/error (reservados pra confirmação/bloqueio — mesmo princípio já
// documentado em FluxoRebanho: saída não é "ruim", é o propósito comercial
// do rebanho).
// ---------------------------------------------------------------------
type Direcao = 'entrada' | 'saida' | 'interno'

const DIRECAO_TIPO: Record<TipoMovimentacao, Direcao> = {
  NASCIMENTO: 'entrada',
  COMPRA: 'entrada',
  VENDA_PE: 'saida',
  VENDA_ABATE: 'saida',
  MORTE: 'saida',
  CONSUMO_DOACAO: 'saida',
  DESMAME: 'interno',
  MUDANCA_CATEGORIA: 'interno',
  TRANSFERENCIA: 'interno',
}

const DIRECAO_GRUPOS: { direcao: Direcao; label: string }[] = [
  { direcao: 'entrada', label: 'Entradas' },
  { direcao: 'saida', label: 'Saídas' },
  { direcao: 'interno', label: 'Reclassificação / interno' },
]

const DIRECAO_CLASSES: Record<Direcao, { bg: string; fg: string }> = {
  entrada: { bg: 'bg-brand-100', fg: 'text-brand-500' },
  saida: { bg: 'bg-warning-bg', fg: 'text-warning' },
  interno: { bg: 'bg-bg', fg: 'text-text-secondary' },
}

function StepBadge({ n }: { n: number }) {
  return (
    <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
      {n}
    </div>
  )
}

// símbolos por tipo — recriados como traço (mesmo padrão de ícone já usado
// no resto do app: viewBox 24, stroke 1.75), inspirados nos símbolos que o
// usuário desenhou (seta de entrada/saída espelhadas, cifrão, círculo com X
// vazado, garfo+faca, gota cortada, setas de ciclo/troca)
function IconeMovimentacao({ tipo }: { tipo: TipoMovimentacao }) {
  const p = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-full w-full',
  }
  switch (tipo) {
    case 'NASCIMENTO':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'COMPRA':
      return (
        <svg {...p}>
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      )
    case 'VENDA_PE':
      return (
        <svg {...p}>
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path d="M7 9l5-5 5 5" />
          <path d="M12 4v11" />
        </svg>
      )
    case 'VENDA_ABATE':
      return (
        <svg {...p}>
          <path d="M12 3v18" />
          <path d="M16.5 8c0-1.9-1.8-3-4.5-3-3 0-4.8 1.4-4.8 3.2 0 1.9 1.8 2.7 4.8 3.3 3 .6 4.8 1.4 4.8 3.3 0 1.8-1.8 3.2-4.8 3.2-2.7 0-4.5-1.1-4.5-3" />
        </svg>
      )
    case 'MORTE':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      )
    case 'CONSUMO_DOACAO':
      return (
        <svg {...p}>
          <path d="M6 2v6a2 2 0 0 0 4 0V2" />
          <path d="M8 8v14" />
          <path d="M18 2v8c-1.7 0-3-1.8-3-4s1.3-4 3-4Z" />
          <path d="M18 8v14" />
        </svg>
      )
    case 'DESMAME':
      return (
        <svg {...p}>
          <path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z" />
          <path d="M4 4l16 16" />
        </svg>
      )
    case 'MUDANCA_CATEGORIA':
      return (
        <svg {...p}>
          <path d="M5 20V15M12 20V10M19 20V5" />
          <path d="M3 20h18" />
        </svg>
      )
    case 'TRANSFERENCIA':
      return (
        <svg {...p}>
          <path d="M4 7h11l-3-3M4 7l3 3" />
          <path d="M20 17H9l3 3M20 17l-3-3" />
        </svg>
      )
  }
}

const inputClass =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const inputSmClass =
  'w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-500'
const labelClass = 'mb-1.5 block text-sm font-medium text-text-secondary'

type Fazenda = { id: string; nome: string; saldo_inicial_confirmado: boolean }
type Sexo = 'MACHO' | 'FEMEA'
type Categoria = {
  id: string
  nome: string
  sexo: Sexo
  era: string | null
  grupo: { nome: string } | null
  papel: { nome: string } | null
}
type ClienteFornecedor = { id: string; nome: string }
type Pasto = { id: string; modulo_id: string; nome: string; ativo: boolean; modulo: { fazenda_id: string } | null }
type Modulo = { id: string; fazenda_id: string; nome: string; ativo: boolean; ordem: number }
type Proprietario = { id: string; nome: string }
type ItemAjuste = { id: string; nome: string; tipo: TipoAjuste }
type AjusteLancado = { itemId: string; itemNome: string; valor: number }
type LinhaCategoria = {
  categoriaId: string
  quantidade: string
  pesoMedio: string
  pesoMorto: string
  rendimentoCarcaca: string
  campoPreco: CampoPreco
  valorPreco: string
  // lote de nascimento (safra) — só usado quando a categoria da linha é
  // bezerro (ver categoriaEhBezerro). Sugerido a partir da data do
  // lançamento (regra julho-junho), sempre editável.
  safraNascimento: string
  // proprietário do lote de gado dessa linha — só aparece quando a
  // fazenda envolvida tem 2+ proprietários vinculados (ver Proprietario)
  proprietarioId: string
}

// lote desmamado — cada linha puxa de um lote de nascimento específico
// (safra), com sua própria quantidade e peso médio
type LinhaDesmame = {
  safraNascimento: string
  quantidade: string
  pesoMedio: string
}

type LoteDisponivel = { safra: number; saldo: number }

function novaLinhaCategoria(): LinhaCategoria {
  return {
    categoriaId: '',
    quantidade: '',
    pesoMedio: '',
    pesoMorto: '',
    rendimentoCarcaca: '',
    campoPreco: 'valor_arroba',
    valorPreco: '',
    safraNascimento: '',
    proprietarioId: '',
  }
}

function novaLinhaDesmame(): LinhaDesmame {
  return { safraNascimento: '', quantidade: '', pesoMedio: '' }
}

// categoria é Bezerro/Bezerra Mamando pelo papel (grupos_categoria_papel),
// não pelo grupo faixa etária (que pode incluir "Outros" com era 00-08) —
// mesmo critério de fn_categoria_e_bezerro no banco
function categoriaEhBezerro(c: Categoria | undefined | null) {
  return !!c?.papel?.nome && PAPEIS_BEZERRO_MAMANDO.includes(c.papel.nome)
}

// tipos de saída onde o bezerro pode estar envolvido antes do desmame —
// precisam do seletor de lote (safra) quando a categoria da linha é
// bezerro, pra não deixar o saldo por lote virar bagunça
const TIPOS_SAIDA_LOTE_BEZERRO: TipoMovimentacao[] = [
  'MORTE',
  'VENDA_PE',
  'VENDA_ABATE',
  'CONSUMO_DOACAO',
  'TRANSFERENCIA',
]

// peso morto e rendimento são tratados por animal, mesma convenção já
// usada em peso_medio_kg (não o total do lote) — @ por animal =
// pesoBasePorAnimal / fator; @ do lote inteiro = isso × quantidade.
// Mesma prioridade da trigger fn_calcular_valores_movimentacao no
// banco: peso morto/15 quando disponível (venda abate — o rendimento
// real, não uma suposição), senão peso vivo/30 (fallback).
function resolverBaseArroba(pesoMedioPorAnimal: number | null, pesoMortoStr: string, rendimentoStr: string) {
  let pesoMortoPorAnimal = pesoMortoStr ? parseFloat(pesoMortoStr) : null
  const rendimento = rendimentoStr ? parseFloat(rendimentoStr) : null
  if (pesoMedioPorAnimal && pesoMedioPorAnimal > 0 && pesoMortoPorAnimal == null && rendimento != null) {
    pesoMortoPorAnimal = round2((pesoMedioPorAnimal * rendimento) / 100)
  }
  if (pesoMortoPorAnimal != null && pesoMortoPorAnimal > 0) return { pesoBasePorAnimal: pesoMortoPorAnimal, fator: 15 }
  if (pesoMedioPorAnimal && pesoMedioPorAnimal > 0) return { pesoBasePorAnimal: pesoMedioPorAnimal, fator: 30 }
  return { pesoBasePorAnimal: null as number | null, fator: 30 }
}

// espelha o mesmo cálculo de valor_total que a trigger fn_calcular_valores_movimentacao
// faz no banco pra cada linha — só usado aqui pro preview e pra dividir
// desconto/acréscimo proporcionalmente entre as linhas na hora de salvar
function calcularLinha(linha: LinhaCategoria) {
  const pesoMedioNum = linha.pesoMedio ? parseFloat(linha.pesoMedio) : null
  const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : null
  const pesoTotal = pesoMedioNum != null && quantidadeNum != null ? round2(pesoMedioNum * quantidadeNum) : null
  const { pesoBasePorAnimal, fator } = resolverBaseArroba(pesoMedioNum, linha.pesoMorto, linha.rendimentoCarcaca)
  const arrobaPorAnimal = pesoBasePorAnimal != null ? pesoBasePorAnimal / fator : null
  const totalArrobas = arrobaPorAnimal != null && quantidadeNum != null ? arrobaPorAnimal * quantidadeNum : null
  const valorNum = parseFloat(linha.valorPreco)
  let valorTotal: number | null = null
  if (!isNaN(valorNum)) {
    if (linha.campoPreco === 'valor_total') valorTotal = valorNum
    else if (linha.campoPreco === 'valor_arroba' && totalArrobas) valorTotal = valorNum * totalArrobas
    else if (linha.campoPreco === 'valor_cabeca' && linha.quantidade) valorTotal = valorNum * parseInt(linha.quantidade, 10)
    else if (linha.campoPreco === 'valor_kg' && pesoTotal) valorTotal = valorNum * pesoTotal
  }
  return {
    pesoTotal,
    arrobaPorAnimal: arrobaPorAnimal !== null ? round2(arrobaPorAnimal) : null,
    valorTotal: valorTotal !== null ? round2(valorTotal) : null,
  }
}

// a partir do valor_total já calculado por calcularLinha, deriva os outros
// 3 campos de preço equivalentes (mesma conta que o formulário de categoria
// única já faz em `valoresCalculados`) — preenche um campo de preço na
// tabela de lote e os outros 3 aparecem sozinhos, sem precisar digitar de
// novo em unidades diferentes
function calcularValoresLinha(linha: LinhaCategoria): Record<CampoPreco, number | null> {
  const { pesoTotal, arrobaPorAnimal, valorTotal } = calcularLinha(linha)
  const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : null
  const totalArrobas = arrobaPorAnimal != null && quantidadeNum != null ? arrobaPorAnimal * quantidadeNum : null
  return {
    valor_total: valorTotal,
    valor_arroba: valorTotal !== null && totalArrobas ? round2(valorTotal / totalArrobas) : null,
    valor_cabeca: valorTotal !== null && quantidadeNum ? round2(valorTotal / quantidadeNum) : null,
    valor_kg: valorTotal !== null && pesoTotal ? round2(valorTotal / pesoTotal) : null,
  }
}

type Movimentacao = {
  id: string
  data: string
  tipo: TipoMovimentacao
  quantidade: number
  peso_medio_kg: number | null
  peso_total_kg: number | null
  peso_morto_kg: number | null
  rendimento_carcaca_pct: number | null
  valor_arroba: number | null
  valor_cabeca: number | null
  valor_kg: number | null
  valor_total: number | null
  causa_morte: string | null
  subtipo_consumo_doacao: SubtipoConsumoDoacao | null
  safra_nascimento_ano_inicio: number | null
  proprietario_id: string | null
  observacao: string | null
  fazenda_id: string | null
  fazenda_origem_id: string | null
  fazenda_destino_id: string | null
  categoria_id: string | null
  categoria_destino_id: string | null
  pasto_id: string | null
  pasto_destino_id: string | null
  cliente_fornecedor_id: string | null
  fazenda: { nome: string } | null
  fazenda_origem: { nome: string } | null
  fazenda_destino: { nome: string } | null
  categoria: { nome: string } | null
  categoria_destino: { nome: string } | null
  pasto: { nome: string } | null
  pasto_destino: { nome: string } | null
  cliente: { nome: string } | null
  proprietario: { nome: string } | null
  movimentacao_ajustes: { item_id: string; valor: number; item: { nome: string; tipo: TipoAjuste } | null }[]
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

export default function MovimentacoesPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [pastos, setPastos] = useState<Pasto[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
  const [controlaPasto, setControlaPasto] = useState(false)
  const [clientesFornecedores, setClientesFornecedores] = useState<ClienteFornecedor[]>([])
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [fazendasFiltro, setFazendasFiltro] = useState<{ id: string; nome: string }[]>([])
  const [categoriasFiltro, setCategoriasFiltro] = useState<{ id: string; nome: string }[]>([])
  const [filtroFazendaId, setFiltroFazendaId] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<TipoMovimentacao | ''>('')
  const [filtroCategoriaId, setFiltroCategoriaId] = useState('')
  const [filtroDataInicio, setFiltroDataInicio] = useState('')
  const [filtroDataFim, setFiltroDataFim] = useState('')

  const [tipo, setTipo] = useState<TipoMovimentacao>('NASCIMENTO')
  const [data, setData] = useState('')
  const [fazendaId, setFazendaId] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [categoriaDestinoId, setCategoriaDestinoId] = useState('')
  const [fazendaOrigemId, setFazendaOrigemId] = useState('')
  const [fazendaDestinoId, setFazendaDestinoId] = useState('')
  const [moduloId, setModuloId] = useState('')
  const [moduloDestinoId, setModuloDestinoId] = useState('')
  const [pastoId, setPastoId] = useState('')
  const [pastoDestinoId, setPastoDestinoId] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [pesoMedio, setPesoMedio] = useState('')
  const [pesoMorto, setPesoMorto] = useState('')
  const [rendimentoCarcaca, setRendimentoCarcaca] = useState('')
  const [campoPreco, setCampoPreco] = useState<CampoPreco>('valor_arroba')
  const [valorPreco, setValorPreco] = useState('')
  const [clienteFornecedorId, setClienteFornecedorId] = useState('')
  const [itensAjuste, setItensAjuste] = useState<ItemAjuste[]>([])
  const [descontos, setDescontos] = useState<AjusteLancado[]>([])
  const [acrescimos, setAcrescimos] = useState<AjusteLancado[]>([])
  const [linhas, setLinhas] = useState<LinhaCategoria[]>([novaLinhaCategoria()])
  const [saldosLinhas, setSaldosLinhas] = useState<Record<number, number | null>>({})
  const [lotesDisponiveisLinhas, setLotesDisponiveisLinhas] = useState<Record<number, LoteDisponivel[]>>({})
  // lote de nascimento (safra) do formulário de linha única — usado ao
  // editar uma movimentação avulsa (Nascimento/Compra/Morte/Venda em
  // Pé/Venda Abate/Consumo-Doação/Transferência) cuja categoria é
  // bezerro
  const [safraNascimento, setSafraNascimento] = useState('')
  const [lotesDisponiveisSingular, setLotesDisponiveisSingular] = useState<LoteDisponivel[]>([])
  // proprietário do lote de gado (formulário de linha única) — mesmo
  // princípio de safraNascimento acima
  const [proprietarioId, setProprietarioId] = useState('')
  // Desmame tem estrutura própria (categoria origem/destino fixas no
  // cabeçalho, linhas variando por lote de nascimento) — não reaproveita
  // LinhaCategoria/linhas
  const [linhasDesmame, setLinhasDesmame] = useState<LinhaDesmame[]>([novaLinhaDesmame()])
  const [lotesDesmameDisponiveis, setLotesDesmameDisponiveis] = useState<LoteDisponivel[]>([])
  const [novoDescontoItemId, setNovoDescontoItemId] = useState('')
  const [novoDescontoNomeCriar, setNovoDescontoNomeCriar] = useState('')
  const [novoDescontoValor, setNovoDescontoValor] = useState('')
  const [criandoAjusteDesconto, setCriandoAjusteDesconto] = useState(false)
  const [novoAcrescimoItemId, setNovoAcrescimoItemId] = useState('')
  const [novoAcrescimoNomeCriar, setNovoAcrescimoNomeCriar] = useState('')
  const [novoAcrescimoValor, setNovoAcrescimoValor] = useState('')
  const [criandoAjusteAcrescimo, setCriandoAjusteAcrescimo] = useState(false)
  const [causaMorte, setCausaMorte] = useState('')
  const [subtipoConsumoDoacao, setSubtipoConsumoDoacao] = useState<SubtipoConsumoDoacao | ''>('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [saldoDisponivel, setSaldoDisponivel] = useState<number | null>(null)
  const [carregandoSaldo, setCarregandoSaldo] = useState(false)
  const [saldoPastoDisponivel, setSaldoPastoDisponivel] = useState<number | null>(null)
  const [carregandoSaldoPasto, setCarregandoSaldoPasto] = useState(false)
  const [confirmarMudancaSexo, setConfirmarMudancaSexo] = useState(false)

  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [avisoEdicaoFutura, setAvisoEdicaoFutura] = useState<{
    payload: Record<string, unknown>
    mensagem: string
  } | null>(null)
  const [editandoGrupoId, setEditandoGrupoId] = useState<string | null>(null)
  const [editandoGrupoLinhasOriginais, setEditandoGrupoLinhasOriginais] = useState<Movimentacao[]>([])
  const [avisoEdicaoFuturaGrupo, setAvisoEdicaoFuturaGrupo] = useState<{
    payloads: Record<string, unknown>[]
    linhasComCalculo: { valorTotal: number | null }[]
    idsAntigos: string[]
    mensagem: string
  } | null>(null)

  // exclusão de lançamento — confirmação inline (nunca window.confirm,
  // mesmo padrão já usado em módulo/pasto/pessoa/fazenda). O banco
  // (trg_validar_delete_movimentacao) é a fonte de verdade da regra
  // "não deixar nenhum saldo ficar negativo" — o frontend só tenta a
  // operação e repassa o erro se for bloqueada, sem checagem prévia
  // duplicada.
  const [confirmarExclusaoMovId, setConfirmarExclusaoMovId] = useState<string | null>(null)
  const [confirmarExclusaoGrupoId, setConfirmarExclusaoGrupoId] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  // formulário começa fechado — só abre ao clicar em "+ Novo Lançamento" ou
  // ao editar um lançamento já existente na listagem abaixo
  const [formularioAberto, setFormularioAberto] = useState(false)

  const [modalClienteAberto, setModalClienteAberto] = useState(false)
  const [novoClienteNome, setNovoClienteNome] = useState('')
  const [novoClienteTipo, setNovoClienteTipo] = useState<TipoClienteFornecedor>('AMBOS')
  const [novoClienteDocumento, setNovoClienteDocumento] = useState('')
  const [salvandoCliente, setSalvandoCliente] = useState(false)

  // efetivo atual da fazenda em contexto — hint ao lado do seletor de
  // fazenda e base do bloco "Efetivo da fazenda" no resumo lateral;
  // puramente informativo, não participa de nenhum cálculo de saldo real
  // (isso continua sendo fn_saldo_categoria/fn_saldo_categoria_pasto)
  const [efetivoFazenda, setEfetivoFazenda] = useState<number | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const isSimples = TIPOS_SIMPLES.includes(tipo)
  const isComPreco = TIPOS_COM_PRECO.includes(tipo)
  const isComAjuste = TIPOS_COM_AJUSTE.includes(tipo)
  const precisaCliente = TIPOS_COM_CLIENTE.includes(tipo)
  const isTransferencia = tipo === 'TRANSFERENCIA'
  const isMudancaCategoria = tipo === 'MUDANCA_CATEGORIA'
  const isMorte = tipo === 'MORTE'
  const isVendaAbate = tipo === 'VENDA_ABATE'
  const isConsumoDoacao = tipo === 'CONSUMO_DOACAO'
  const isNascimento = tipo === 'NASCIMENTO'
  const isDesmame = tipo === 'DESMAME'
  const precisaChecarSaldo = !TIPOS_SEM_CHECAGEM_SALDO.includes(tipo)
  const fazendaParaSaldo = isTransferencia ? fazendaOrigemId : fazendaId
  // lote vale tanto lançando de novo quanto reabrindo um grupo já
  // salvo pra edição (editandoGrupoId) — editar uma movimentação
  // avulsa (editandoId) continua sempre no formulário de linha única
  const isLoteCategoria = editandoGrupoId !== null || (!editandoId && TIPOS_COM_LOTE.includes(tipo))
  const mostrarPesoLinha = isSimples || isComPreco

  // módulo → pasto é uma cascata de dois níveis: o seletor de módulo só
  // aparece quando a fazenda tem mais de um módulo ativo, e o seletor de
  // pasto (dentro do módulo escolhido) só aparece quando esse módulo tem
  // mais de um pasto ativo — caso contrário módulo e pasto "Geral" são
  // preenchidos sozinhos (ver useEffects abaixo)
  const fazendaOrigemParaPasto = isTransferencia ? fazendaOrigemId : fazendaId
  const modulosOrigemDisponiveis = modulos.filter((m) => m.fazenda_id === fazendaOrigemParaPasto)
  const mostrarSeletorModuloOrigem = controlaPasto && modulosOrigemDisponiveis.length > 1
  const pastosOrigemDoModulo = pastos.filter((p) => p.modulo_id === moduloId)
  const mostrarSeletorPastoOrigem = controlaPasto && pastosOrigemDoModulo.length > 1

  const modulosDestinoDisponiveis = modulos.filter((m) => m.fazenda_id === fazendaDestinoId)
  const mostrarSeletorModuloDestino = isTransferencia && controlaPasto && modulosDestinoDisponiveis.length > 1
  const pastosDestinoDoModulo = pastos.filter((p) => p.modulo_id === moduloDestinoId)
  const mostrarSeletorPastoDestino = isTransferencia && controlaPasto && pastosDestinoDoModulo.length > 1

  // proprietário do lote de gado: lista global (qualquer pessoa com
  // papel PROPRIETARIO, sem vínculo por fazenda — o gado pode ser
  // transferido entre fazendas, então amarrar por fazenda só criaria
  // fricção). Seletor só aparece quando há 2+ proprietários cadastrados
  // no sistema; quando escondido, o campo fica vazio (proprietário é
  // sempre opcional).
  const proprietariosDisponiveis = proprietarios
  const mostrarSeletorProprietario = proprietariosDisponiveis.length > 1

  // nenhuma movimentação pode ser lançada numa fazenda que ainda não
  // teve o saldo inicial preenchido e confirmado — evita erro de conta
  // desde o começo. só vale pra lançamentos novos: uma movimentação já
  // existente não fica bloqueada de ser editada por causa disso.
  const fazendasEnvolvidas = isTransferencia
    ? [fazendaOrigemId, fazendaDestinoId]
    : [fazendaId]
  const fazendasSemSaldoInicial = fazendasEnvolvidas
    .map((id) => fazendas.find((f) => f.id === id))
    .filter((f): f is Fazenda => !!f && !f.saldo_inicial_confirmado)
  const bloqueadoPorSaldoInicial = !editandoId && fazendasSemSaldoInicial.length > 0

  // nascimento e desmame só partem de bezerro (macho ou fêmea) — as
  // demais categorias (jovens, adultos) não são opções válidas aqui.
  // Mudança de Categoria nunca pode envolver bezerro (nem origem, nem
  // destino — ver fn_validar_lote_nascimento_bezerro): a única evolução
  // de bezerro é o Desmame, e bezerro só entra por Nascimento, Compra
  // ou Saldo Inicial.
  const restringirOrigemABezerro = isNascimento || isDesmame
  const categoriasVisiveis = restringirOrigemABezerro
    ? categorias.filter((c) => c.grupo?.nome === 'BEZERRO')
    : isMudancaCategoria
      ? categorias.filter((c) => !categoriaEhBezerro(c))
      : categorias

  // desmame evolui o bezerro para uma categoria jovem do mesmo sexo e
  // era exatamente 08-12 (não basta ser do grupo Jovem genérico)
  const categoriaOrigemSelecionada = categorias.find((c) => c.id === categoriaId)
  const categoriasDestinoDesmame = categoriaOrigemSelecionada
    ? categorias.filter((c) => c.era === '08-12' && c.sexo === categoriaOrigemSelecionada.sexo)
    : []

  // lote de nascimento (safra): Nascimento sempre é bezerro; nos
  // demais tipos depende da categoria selecionada. Mudança de Categoria
  // fica de fora (bloqueada pro bezerro) e Desmame tem seu próprio bloco
  const categoriaAtualEhBezerro = categoriaEhBezerro(categoriaOrigemSelecionada)
  const mostrarCamposLoteSingular =
    !isDesmame && !isMudancaCategoria && TIPOS_COM_LOTE.includes(tipo) && (isNascimento || categoriaAtualEhBezerro)

  // a coluna Safra/Lote da tabela de categorias só faz sentido aparecer
  // quando pelo menos uma linha envolve bezerro (ou o tipo é Nascimento,
  // sempre bezerro) — nos demais casos a coluna inteira fica escondida em
  // vez de mostrar "—" em toda linha, mesmo princípio já usado pra
  // esconder as colunas de peso morto/rendimento (isVendaAbate) e preço
  // (isComPreco)
  const mostrarColunaSafra =
    isNascimento ||
    linhas.some((l) => categoriaEhBezerro(categorias.find((c) => c.id === l.categoriaId)))

  // mudança de categoria entre sexos diferentes é permitida (ajuste de
  // estoque), mas exige confirmação explícita
  const categoriaDestinoSelecionada = categorias.find((c) => c.id === categoriaDestinoId)
  const mudancaEntreSexosDiferentes =
    isMudancaCategoria &&
    !!categoriaOrigemSelecionada &&
    !!categoriaDestinoSelecionada &&
    categoriaOrigemSelecionada.sexo !== categoriaDestinoSelecionada.sexo

  // peso total é sempre calculado a partir do peso médio informado —
  // o usuário não digita o total diretamente nos tipos comerciais
  const pesoTotalCalculado =
    pesoMedio && quantidade ? round2(parseFloat(pesoMedio) * parseInt(quantidade, 10)) : null

  // espelha em JS o mesmo cálculo que a trigger fn_calcular_valores_movimentacao
  // faz no banco, só para preview em tempo real — o banco continua sendo a
  // fonte da verdade do que é de fato gravado
  const { pesoBasePorAnimal: pesoBaseArrobaPorAnimal, fator: fatorArrobaCalculado } = resolverBaseArroba(
    pesoMedio ? parseFloat(pesoMedio) : null,
    pesoMorto,
    rendimentoCarcaca
  )
  const arrobaPorAnimalPreview = pesoBaseArrobaPorAnimal != null ? pesoBaseArrobaPorAnimal / fatorArrobaCalculado : null
  const totalArrobas =
    arrobaPorAnimalPreview != null && quantidade ? arrobaPorAnimalPreview * parseInt(quantidade, 10) : null
  const valorPrecoNum = parseFloat(valorPreco)
  let valorTotalPreview: number | null = null
  if (!isNaN(valorPrecoNum)) {
    if (campoPreco === 'valor_total') valorTotalPreview = valorPrecoNum
    else if (campoPreco === 'valor_arroba' && totalArrobas) valorTotalPreview = valorPrecoNum * totalArrobas
    else if (campoPreco === 'valor_cabeca' && quantidade) valorTotalPreview = valorPrecoNum * parseInt(quantidade, 10)
    else if (campoPreco === 'valor_kg' && pesoTotalCalculado) valorTotalPreview = valorPrecoNum * pesoTotalCalculado
  }
  const valoresCalculados: Record<CampoPreco, number | null> = {
    valor_total: valorTotalPreview !== null ? round2(valorTotalPreview) : null,
    valor_arroba: valorTotalPreview !== null && totalArrobas ? round2(valorTotalPreview / totalArrobas) : null,
    valor_cabeca:
      valorTotalPreview !== null && quantidade ? round2(valorTotalPreview / parseInt(quantidade, 10)) : null,
    valor_kg: valorTotalPreview !== null && pesoTotalCalculado ? round2(valorTotalPreview / pesoTotalCalculado) : null,
  }

  const itensDesconto = itensAjuste.filter((i) => i.tipo === 'DESCONTO')
  const itensAcrescimo = itensAjuste.filter((i) => i.tipo === 'ACRESCIMO')
  const totalDescontos = descontos.reduce((s, d) => s + d.valor, 0)
  const totalAcrescimos = acrescimos.reduce((s, a) => s + a.valor, 0)
  const valorLiquidoPreview =
    valorTotalPreview !== null ? round2(valorTotalPreview - totalDescontos + totalAcrescimos) : null

  // soma do valor bruto de todas as linhas do lote — usada tanto pro
  // preview do "Valor bruto total" quanto pra dividir desconto/acréscimo
  // proporcionalmente entre as linhas na hora de salvar
  const somaValorTotalLote = linhas.reduce((s, l) => s + (calcularLinha(l).valorTotal ?? 0), 0)
  const valorBrutoPreviewAtual = isLoteCategoria ? (somaValorTotalLote > 0 ? somaValorTotalLote : null) : valorTotalPreview
  const valorLiquidoPreviewAtual =
    valorBrutoPreviewAtual !== null ? round2(valorBrutoPreviewAtual - totalDescontos + totalAcrescimos) : null

  // totais do lançamento em andamento — só pro resumo em tempo real
  // (coluna direita), nunca usados pra validação/payload
  const totalCabecasFormulario = isDesmame
    ? linhasDesmame.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)
    : isLoteCategoria
      ? linhas.reduce((s, l) => s + (parseInt(l.quantidade, 10) || 0), 0)
      : parseInt(quantidade, 10) || 0
  // Desmame e Mudança de Categoria são reclassificação (não mudam o total
  // do rebanho da fazenda); Transferência tira da fazenda de origem, que é
  // a fazenda mostrada no resumo (fazendaOrigemParaPasto)
  const sinalEfetivo = isTransferencia
    ? -1
    : DIRECAO_TIPO[tipo] === 'entrada'
      ? 1
      : DIRECAO_TIPO[tipo] === 'saida'
        ? -1
        : 0
  const efetivoDepois = efetivoFazenda != null ? efetivoFazenda + sinalEfetivo * totalCabecasFormulario : null

  useEffect(() => {
    if (restringirOrigemABezerro && categoriaId) {
      const aindaValida = categoriasVisiveis.some((c) => c.id === categoriaId)
      if (!aindaValida) setCategoriaId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, categorias])

  useEffect(() => {
    if (isDesmame && categoriaDestinoId) {
      const aindaValida = categoriasDestinoDesmame.some((c) => c.id === categoriaDestinoId)
      if (!aindaValida) setCategoriaDestinoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, categoriaId, categorias])

  useEffect(() => {
    setConfirmarMudancaSexo(false)
  }, [tipo, categoriaId, categoriaDestinoId])

  // módulo de origem: some sozinho quando só há um módulo ativo na
  // fazenda (mesmo princípio já usado pro pasto abaixo)
  useEffect(() => {
    if (!fazendaOrigemParaPasto) {
      setModuloId('')
      return
    }
    if (!mostrarSeletorModuloOrigem) {
      const geral = modulosOrigemDisponiveis.find((m) => m.nome === 'Geral') || modulosOrigemDisponiveis[0]
      setModuloId(geral ? geral.id : '')
    } else if (!modulosOrigemDisponiveis.some((m) => m.id === moduloId)) {
      setModuloId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaOrigemParaPasto, mostrarSeletorModuloOrigem, modulos])

  // pasto de origem: some pro "Geral" sozinho quando o seletor está
  // escondido (grupo sem controla_pasto, ou o módulo escolhido só tem um
  // pasto ativo) — depende do módulo selecionado acima
  useEffect(() => {
    if (!moduloId) {
      setPastoId('')
      return
    }
    if (!mostrarSeletorPastoOrigem) {
      const geral = pastosOrigemDoModulo.find((p) => p.nome === 'Geral') || pastosOrigemDoModulo[0]
      setPastoId(geral ? geral.id : '')
    } else if (!pastosOrigemDoModulo.some((p) => p.id === pastoId)) {
      setPastoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduloId, mostrarSeletorPastoOrigem, pastos])

  // módulo de destino em TRANSFERENCIA (na fazenda de destino) — mesmo
  // princípio do de origem
  useEffect(() => {
    if (!isTransferencia) return
    if (!fazendaDestinoId) {
      setModuloDestinoId('')
      return
    }
    if (!mostrarSeletorModuloDestino) {
      const geral = modulosDestinoDisponiveis.find((m) => m.nome === 'Geral') || modulosDestinoDisponiveis[0]
      setModuloDestinoId(geral ? geral.id : '')
    } else if (!modulosDestinoDisponiveis.some((m) => m.id === moduloDestinoId)) {
      setModuloDestinoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransferencia, fazendaDestinoId, mostrarSeletorModuloDestino, modulos])

  // pasto de destino em TRANSFERENCIA — depende do módulo de destino
  // selecionado acima
  useEffect(() => {
    if (!isTransferencia) return
    if (!moduloDestinoId) {
      setPastoDestinoId('')
      return
    }
    if (!mostrarSeletorPastoDestino) {
      const geral = pastosDestinoDoModulo.find((p) => p.nome === 'Geral') || pastosDestinoDoModulo[0]
      setPastoDestinoId(geral ? geral.id : '')
    } else if (!pastosDestinoDoModulo.some((p) => p.id === pastoDestinoId)) {
      setPastoDestinoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransferencia, moduloDestinoId, mostrarSeletorPastoDestino, pastos])

  useEffect(() => {
    if (!precisaChecarSaldo || !fazendaParaSaldo || !categoriaId || !data) {
      setSaldoDisponivel(null)
      return
    }
    let cancelado = false
    setCarregandoSaldo(true)
    supabase
      .rpc('fn_saldo_categoria', {
        p_fazenda_id: fazendaParaSaldo,
        p_categoria_id: categoriaId,
        p_data: data,
      })
      .then(({ data: saldo, error }) => {
        if (cancelado) return
        setSaldoDisponivel(error ? null : saldo)
        setCarregandoSaldo(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precisaChecarSaldo, fazendaParaSaldo, categoriaId, data])

  useEffect(() => {
    if (!precisaChecarSaldo || !fazendaParaSaldo || !categoriaId || !data || !pastoId) {
      setSaldoPastoDisponivel(null)
      return
    }
    let cancelado = false
    setCarregandoSaldoPasto(true)
    supabase
      .rpc('fn_saldo_categoria_pasto', {
        p_fazenda_id: fazendaParaSaldo,
        p_categoria_id: categoriaId,
        p_pasto_id: pastoId,
        p_data: data,
      })
      .then(({ data: saldo, error }) => {
        if (cancelado) return
        setSaldoPastoDisponivel(error ? null : saldo)
        setCarregandoSaldoPasto(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precisaChecarSaldo, fazendaParaSaldo, categoriaId, data, pastoId])

  // efetivo atual da fazenda em contexto (ver estado acima) — puramente
  // informativo, roda em paralelo às checagens reais de saldo acima
  useEffect(() => {
    if (!fazendaOrigemParaPasto) {
      setEfetivoFazenda(null)
      return
    }
    let cancelado = false
    supabase.rpc('fn_resumo_rebanho_atual', { p_fazenda_ids: [fazendaOrigemParaPasto] }).then(({ data: linhas, error }) => {
      if (cancelado) return
      if (error) {
        setEfetivoFazenda(null)
        return
      }
      const rows = (linhas as { quantidade: number }[]) || []
      setEfetivoFazenda(rows.reduce((s, r) => s + r.quantidade, 0))
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaOrigemParaPasto])

  // trocar de tipo invalida as linhas antigas (categorias visíveis podem
  // mudar, ex.: NASCIMENTO só mostra bezerro) — edição nunca usa lote,
  // então isso é inofensivo nesse caso
  useEffect(() => {
    setLinhas([novaLinhaCategoria()])
    setSaldosLinhas({})
    setLinhasDesmame([novaLinhaDesmame()])
    setSafraNascimento('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo])

  // lotes de nascimento com saldo disponível numa fazenda+categoria+data
  // — alimenta os seletores de lote (Desmame e as demais saídas de
  // bezerro). Mostra só a quantidade, sem peso (ver fn_lotes_nascimento_disponiveis).
  async function buscarLotesDisponiveis(fazenda: string, categoria: string, dataRef: string) {
    const { data: lotes, error } = await supabase.rpc('fn_lotes_nascimento_disponiveis', {
      p_fazenda_id: fazenda,
      p_categoria_id: categoria,
      p_data: dataRef,
    })
    return error ? [] : ((lotes as LoteDisponivel[]) || [])
  }

  // formulário de linha única (edição de uma movimentação avulsa de
  // saída — Morte/Venda em Pé/Venda Abate/Consumo-Doação/Transferência
  // — cuja categoria é bezerro): lista de lotes pra reatribuir/conferir
  useEffect(() => {
    if (!TIPOS_SAIDA_LOTE_BEZERRO.includes(tipo) || !categoriaAtualEhBezerro || !fazendaParaSaldo || !data) {
      setLotesDisponiveisSingular([])
      return
    }
    let cancelado = false
    buscarLotesDisponiveis(fazendaParaSaldo, categoriaId, data).then((lotes) => {
      if (!cancelado) setLotesDisponiveisSingular(lotes)
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, categoriaAtualEhBezerro, fazendaParaSaldo, categoriaId, data])

  // formulário de lote (linhas por categoria) — busca os lotes
  // disponíveis por linha, só quando a categoria daquela linha é
  // bezerro e o tipo é uma saída que precisa rastrear o lote
  useEffect(() => {
    if (!TIPOS_SAIDA_LOTE_BEZERRO.includes(tipo) || !fazendaParaSaldo || !data) {
      setLotesDisponiveisLinhas({})
      return
    }
    let cancelado = false
    Promise.all(
      linhas.map((linha, i) => {
        const cat = categorias.find((c) => c.id === linha.categoriaId)
        return linha.categoriaId && categoriaEhBezerro(cat)
          ? buscarLotesDisponiveis(fazendaParaSaldo, linha.categoriaId, data).then((lotes) => [i, lotes] as const)
          : Promise.resolve([i, []] as const)
      })
    ).then((pares) => {
      if (!cancelado) setLotesDisponiveisLinhas(Object.fromEntries(pares))
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, fazendaParaSaldo, data, categorias, JSON.stringify(linhas.map((l) => l.categoriaId))])

  // Desmame: lotes disponíveis da categoria de origem (bezerro) na
  // fazenda selecionada
  useEffect(() => {
    if (!isDesmame || !fazendaId || !categoriaId || !data) {
      setLotesDesmameDisponiveis([])
      return
    }
    let cancelado = false
    buscarLotesDisponiveis(fazendaId, categoriaId, data).then((lotes) => {
      if (!cancelado) setLotesDesmameDisponiveis(lotes)
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesmame, fazendaId, categoriaId, data])

  useEffect(() => {
    if (!isLoteCategoria || !precisaChecarSaldo || !fazendaParaSaldo || !data) {
      setSaldosLinhas({})
      return
    }
    let cancelado = false
    Promise.all(
      linhas.map((linha, i) =>
        linha.categoriaId
          ? supabase
              .rpc('fn_saldo_categoria', { p_fazenda_id: fazendaParaSaldo, p_categoria_id: linha.categoriaId, p_data: data })
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
  }, [isLoteCategoria, precisaChecarSaldo, fazendaParaSaldo, data, JSON.stringify(linhas.map((l) => l.categoriaId))])

  async function carregarAuxiliares() {
    const [
      { data: f },
      { data: c },
      { data: p },
      { data: mods },
      { data: cf },
      { data: cfg },
      { data: ia },
      { data: fFiltro },
      { data: cFiltro },
      { data: prop },
    ] = await Promise.all([
        supabase
          .from('fazendas')
          .select('id, nome, saldo_inicial_confirmado')
          .eq('ativo', true)
          .order('nome'),
        supabase
          .from('categorias_animal')
          .select('id, nome, sexo, era, grupo:grupos_categoria(nome), papel:grupos_categoria_papel(nome)')
          .eq('ativa', true)
          .order('nome'),
        supabase
          .from('pastos')
          .select('id, modulo_id, nome, ativo, modulo:modulos!modulo_id(fazenda_id)')
          .eq('ativo', true)
          .order('nome'),
        supabase.from('modulos').select('id, fazenda_id, nome, ativo, ordem').eq('ativo', true).order('ordem'),
        supabase.from('pessoas').select('id, nome').eq('ativo', true).order('nome'),
        supabase.from('configuracoes').select('controla_pasto').single(),
        supabase.from('itens_ajuste_financeiro').select('id, nome, tipo').order('nome'),
        // sem filtro de ativo/ativa — o filtro da listagem precisa achar
        // lançamentos antigos mesmo que a fazenda/categoria tenha sido
        // inativada depois
        supabase.from('fazendas').select('id, nome').order('nome'),
        supabase.from('categorias_animal').select('id, nome').order('nome'),
        // lista global de proprietários (qualquer pessoa com papel
        // PROPRIETARIO) — não filtrada por fazenda, já que o gado pode
        // ser transferido entre fazendas
        supabase.from('pessoa_papeis').select('pessoa:pessoas!pessoa_id(id, nome)').eq('papel', 'PROPRIETARIO'),
      ])
    setFazendas(f || [])
    setCategorias((c as unknown as Categoria[]) || [])
    setPastos((p as unknown as Pasto[]) || [])
    setModulos(mods || [])
    setClientesFornecedores(cf || [])
    setControlaPasto(cfg?.controla_pasto ?? false)
    setItensAjuste((ia as unknown as ItemAjuste[]) || [])
    setFazendasFiltro(fFiltro || [])
    setCategoriasFiltro(cFiltro || [])
    setProprietarios(
      ((prop || []) as any[])
        .map((r) => r.pessoa)
        .filter(Boolean)
        .sort((a: Proprietario, b: Proprietario) => a.nome.localeCompare(b.nome))
    )
  }

  async function carregarMovimentacoes() {
    setLoading(true)
    const semFiltro = !filtroFazendaId && !filtroTipo && !filtroCategoriaId && !filtroDataInicio && !filtroDataFim

    let query = supabase
      .from('movimentacoes_rebanho')
      .select(
        `
        id, data, tipo, quantidade, peso_medio_kg, peso_total_kg, peso_morto_kg, rendimento_carcaca_pct,
        valor_arroba, valor_cabeca, valor_kg, valor_total,
        causa_morte, subtipo_consumo_doacao, safra_nascimento_ano_inicio, proprietario_id, observacao, grupo_lancamento_id,
        fazenda_id, fazenda_origem_id, fazenda_destino_id,
        categoria_id, categoria_destino_id, pasto_id, pasto_destino_id, cliente_fornecedor_id,
        fazenda:fazendas!fazenda_id(nome),
        fazenda_origem:fazendas!fazenda_origem_id(nome),
        fazenda_destino:fazendas!fazenda_destino_id(nome),
        categoria:categorias_animal!categoria_id(nome),
        categoria_destino:categorias_animal!categoria_destino_id(nome),
        pasto:pastos!pasto_id(nome),
        pasto_destino:pastos!pasto_destino_id(nome),
        cliente:pessoas!cliente_fornecedor_id(nome),
        proprietario:pessoas!proprietario_id(nome),
        movimentacao_ajustes(item_id, valor, item:itens_ajuste_financeiro!item_id(nome, tipo))
      `
      )
      .neq('tipo', 'SALDO_INICIAL')
      // Mudança de Pasto agora tem módulo/tela próprios (Controle de Pasto)
      .neq('tipo', 'MUDANCA_PASTO')

    // fazenda_id já cobre a origem em TRANSFERENCIA (ver handleSubmit) —
    // falta só casar o destino também, senão o filtro esconderia
    // transferências em que a fazenda buscada é o destino
    if (filtroFazendaId) {
      query = query.or(`fazenda_id.eq.${filtroFazendaId},fazenda_destino_id.eq.${filtroFazendaId}`)
    }
    // mesmo princípio pra categoria: MUDANCA_CATEGORIA/DESMAME mudam de
    // categoria_id pra categoria_destino_id
    if (filtroCategoriaId) {
      query = query.or(`categoria_id.eq.${filtroCategoriaId},categoria_destino_id.eq.${filtroCategoriaId}`)
    }
    if (filtroTipo) {
      query = query.eq('tipo', filtroTipo)
    }
    if (filtroDataInicio) {
      query = query.gte('data', filtroDataInicio)
    }
    if (filtroDataFim) {
      query = query.lte('data', filtroDataFim)
    }

    query = query.order('data', { ascending: false }).order('created_at', { ascending: false })
    // sem filtro: só as últimas 20 (carregamento leve). Com filtro: todas
    // as que baterem, já que o objetivo é achar/conferir um lançamento
    // específico, não paginar
    if (semFiltro) query = query.limit(20)

    const { data, error } = await query

    if (error) {
      setErro(error.message)
    } else {
      setMovimentacoes((data as unknown as Movimentacao[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    carregarAuxiliares()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    carregarMovimentacoes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroFazendaId, filtroTipo, filtroCategoriaId, filtroDataInicio, filtroDataFim])

  function limparFormulario() {
    setData('')
    setFazendaId('')
    setCategoriaId('')
    setCategoriaDestinoId('')
    setFazendaOrigemId('')
    setFazendaDestinoId('')
    setModuloId('')
    setModuloDestinoId('')
    setPastoId('')
    setPastoDestinoId('')
    setQuantidade('')
    setPesoMedio('')
    setPesoMorto('')
    setRendimentoCarcaca('')
    setCampoPreco('valor_arroba')
    setValorPreco('')
    setClienteFornecedorId('')
    setDescontos([])
    setAcrescimos([])
    setNovoDescontoItemId('')
    setNovoDescontoNomeCriar('')
    setNovoDescontoValor('')
    setNovoAcrescimoItemId('')
    setNovoAcrescimoNomeCriar('')
    setNovoAcrescimoValor('')
    setCausaMorte('')
    setSubtipoConsumoDoacao('')
    setObservacao('')
    setConfirmarMudancaSexo(false)
    setLinhas([novaLinhaCategoria()])
    setSaldosLinhas({})
    setSafraNascimento('')
    setProprietarioId('')
    setLinhasDesmame([novaLinhaDesmame()])
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, novaLinhaCategoria()])
  }

  function removerLinha(index: number) {
    setLinhas((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  function adicionarLinhaDesmame() {
    setLinhasDesmame((prev) => [...prev, novaLinhaDesmame()])
  }

  function removerLinhaDesmame(index: number) {
    setLinhasDesmame((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  function atualizarLinhaDesmame(index: number, patch: Partial<LinhaDesmame>) {
    setLinhasDesmame((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function atualizarLinha(index: number, patch: Partial<LinhaCategoria>) {
    setLinhas((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  // peso morto e rendimento se autocompletam — preencher um já calcula o
  // outro (por animal, usando o peso médio da própria linha), pra não
  // dar a entender que os dois são obrigatórios
  function atualizarPesoMortoLinha(index: number, valor: string) {
    setLinhas((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l
        const pesoMedioNum = l.pesoMedio ? parseFloat(l.pesoMedio) : null
        const num = parseFloat(valor)
        const rendimentoCarcaca =
          pesoMedioNum && pesoMedioNum > 0 && !isNaN(num) && num > 0
            ? String(round2((num / pesoMedioNum) * 100))
            : l.rendimentoCarcaca
        return { ...l, pesoMorto: valor, rendimentoCarcaca }
      })
    )
  }

  function atualizarRendimentoLinha(index: number, valor: string) {
    setLinhas((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l
        const pesoMedioNum = l.pesoMedio ? parseFloat(l.pesoMedio) : null
        const num = parseFloat(valor)
        const pesoMorto =
          pesoMedioNum && pesoMedioNum > 0 && !isNaN(num) && num > 0
            ? String(round2((pesoMedioNum * num) / 100))
            : l.pesoMorto
        return { ...l, rendimentoCarcaca: valor, pesoMorto }
      })
    )
  }

  // mesma ideia de atualizarPesoMortoLinha/atualizarRendimentoLinha,
  // só que pro formulário de edição avulsa (categoria única)
  function handlePesoMortoChange(valor: string) {
    const pesoMedioNum = pesoMedio ? parseFloat(pesoMedio) : null
    const num = parseFloat(valor)
    if (pesoMedioNum && pesoMedioNum > 0 && !isNaN(num) && num > 0) {
      setRendimentoCarcaca(String(round2((num / pesoMedioNum) * 100)))
    }
    setPesoMorto(valor)
  }

  function handleRendimentoChange(valor: string) {
    const pesoMedioNum = pesoMedio ? parseFloat(pesoMedio) : null
    const num = parseFloat(valor)
    if (pesoMedioNum && pesoMedioNum > 0 && !isNaN(num) && num > 0) {
      setPesoMorto(String(round2((pesoMedioNum * num) / 100)))
    }
    setRendimentoCarcaca(valor)
  }

  // atalhos de data — additivas, apenas preenchem o campo já existente
  function definirDataAtalho(offsetDias: number) {
    const d = new Date()
    d.setDate(d.getDate() + offsetDias)
    setData(d.toISOString().slice(0, 10))
  }

  // hint compacto de efetivo (antes → depois de salvar) exibido junto ao
  // seletor de fazenda — substitui o antigo bloco "Efetivo da fazenda" da
  // coluna lateral removida; "depois" só aparece quando já há alguma
  // quantidade preenchida no formulário, senão seria só um "N → N" vazio
  function renderEfetivoHint() {
    if (efetivoFazenda == null) return null
    return (
      <p className="mt-1.5 text-xs text-text-secondary">
        Efetivo atual: <span className="font-semibold text-text-primary">{formatQuantidade(efetivoFazenda)}</span> cabeças
        {totalCabecasFormulario > 0 && (
          <>
            {' '}
            → <span className="font-semibold text-brand-500">{formatQuantidade(efetivoDepois ?? efetivoFazenda)}</span> após salvar
          </>
        )}
      </p>
    )
  }

  function iniciarEdicao(m: Movimentacao) {
    setEditandoId(m.id)
    setEditandoGrupoId(null)
    setEditandoGrupoLinhasOriginais([])
    setTipo(m.tipo)
    setData(m.data)
    setFazendaId(m.fazenda_id || '')
    setCategoriaId(m.categoria_id || '')
    setCategoriaDestinoId(m.categoria_destino_id || '')
    setFazendaOrigemId(m.fazenda_origem_id || '')
    setFazendaDestinoId(m.fazenda_destino_id || '')
    setPastoId(m.pasto_id || '')
    setModuloId(pastos.find((p) => p.id === m.pasto_id)?.modulo_id || '')
    setPastoDestinoId(m.pasto_destino_id || '')
    setModuloDestinoId(pastos.find((p) => p.id === m.pasto_destino_id)?.modulo_id || '')
    setQuantidade(String(m.quantidade))
    setPesoMedio(m.peso_medio_kg != null ? String(m.peso_medio_kg) : '')
    setPesoMorto(m.peso_morto_kg != null ? String(round2(m.peso_morto_kg / m.quantidade)) : '')
    setRendimentoCarcaca(m.rendimento_carcaca_pct != null ? String(m.rendimento_carcaca_pct) : '')
    const campoComValor = CAMPOS_PRECO.find((c) => m[c.key] != null)
    setCampoPreco(campoComValor ? campoComValor.key : 'valor_arroba')
    setValorPreco(campoComValor ? String(m[campoComValor.key]) : '')
    setClienteFornecedorId(m.cliente_fornecedor_id || '')
    const ajustes = m.movimentacao_ajustes || []
    setDescontos(
      ajustes
        .filter((a) => a.item?.tipo === 'DESCONTO')
        .map((a) => ({ itemId: a.item_id, itemNome: a.item!.nome, valor: a.valor }))
    )
    setAcrescimos(
      ajustes
        .filter((a) => a.item?.tipo === 'ACRESCIMO')
        .map((a) => ({ itemId: a.item_id, itemNome: a.item!.nome, valor: a.valor }))
    )
    setNovoDescontoItemId('')
    setNovoDescontoNomeCriar('')
    setNovoDescontoValor('')
    setNovoAcrescimoItemId('')
    setNovoAcrescimoNomeCriar('')
    setNovoAcrescimoValor('')
    setCausaMorte(m.causa_morte || '')
    setSubtipoConsumoDoacao(m.subtipo_consumo_doacao || '')
    setObservacao(m.observacao || '')
    setConfirmarMudancaSexo(false)
    setSafraNascimento(m.safra_nascimento_ano_inicio != null ? String(m.safra_nascimento_ano_inicio) : '')
    setProprietarioId(m.proprietario_id || '')
    setFormularioAberto(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // reconstrói o valor único de desconto/acréscimo somando de volta o
  // que foi dividido proporcionalmente entre as linhas do grupo — o
  // inverso exato do rateio feito em handleSubmitLote
  function reconstruirAjustesGrupo(rows: Movimentacao[], tipoAjuste: TipoAjuste): AjusteLancado[] {
    const somaPorItem = new Map<string, { nome: string; valor: number }>()
    rows.forEach((r) => {
      ;(r.movimentacao_ajustes || []).forEach((a) => {
        if (a.item?.tipo !== tipoAjuste) return
        const atual = somaPorItem.get(a.item_id)
        somaPorItem.set(a.item_id, { nome: a.item!.nome, valor: (atual?.valor || 0) + a.valor })
      })
    })
    return Array.from(somaPorItem.entries()).map(([itemId, v]) => ({
      itemId,
      itemNome: v.nome,
      valor: round2(v.valor),
    }))
  }

  function linhaFromMovimentacao(m: Movimentacao): LinhaCategoria {
    const campoComValor = CAMPOS_PRECO.find((c) => m[c.key] != null)
    return {
      categoriaId: m.categoria_id || '',
      quantidade: String(m.quantidade),
      pesoMedio: m.peso_medio_kg != null ? String(m.peso_medio_kg) : '',
      // peso_morto_kg é guardado como total do lote — converte de volta
      // pra por animal, igual o campo do formulário espera
      pesoMorto: m.peso_morto_kg != null ? String(round2(m.peso_morto_kg / m.quantidade)) : '',
      rendimentoCarcaca: m.rendimento_carcaca_pct != null ? String(m.rendimento_carcaca_pct) : '',
      campoPreco: campoComValor ? campoComValor.key : 'valor_arroba',
      valorPreco: campoComValor ? String(m[campoComValor.key]) : '',
      safraNascimento: m.safra_nascimento_ano_inicio != null ? String(m.safra_nascimento_ano_inicio) : '',
      proprietarioId: m.proprietario_id || '',
    }
  }

  // reabre um lote inteiro (todas as linhas de um grupo_lancamento_id)
  // pro formulário de lote — campos de cabeçalho vêm da primeira linha
  // (são idênticos em todas, por construção), desconto/acréscimo volta
  // a ser um valor único (reconstruirAjustesGrupo)
  function iniciarEdicaoGrupo(rows: Movimentacao[]) {
    const primeira = rows[0]
    setEditandoId(null)
    setEditandoGrupoId(primeira.grupo_lancamento_id)
    setEditandoGrupoLinhasOriginais(rows)
    setTipo(primeira.tipo)
    setData(primeira.data)
    setFazendaId(primeira.fazenda_id || '')
    setFazendaOrigemId(primeira.fazenda_origem_id || '')
    setFazendaDestinoId(primeira.fazenda_destino_id || '')
    setPastoId(primeira.pasto_id || '')
    setModuloId(pastos.find((p) => p.id === primeira.pasto_id)?.modulo_id || '')
    setPastoDestinoId(primeira.pasto_destino_id || '')
    setModuloDestinoId(pastos.find((p) => p.id === primeira.pasto_destino_id)?.modulo_id || '')
    setClienteFornecedorId(primeira.cliente_fornecedor_id || '')
    setCausaMorte(primeira.causa_morte || '')
    setSubtipoConsumoDoacao(primeira.subtipo_consumo_doacao || '')
    setObservacao(primeira.observacao || '')
    setLinhas(rows.map(linhaFromMovimentacao))
    setDescontos(reconstruirAjustesGrupo(rows, 'DESCONTO'))
    setAcrescimos(reconstruirAjustesGrupo(rows, 'ACRESCIMO'))
    setNovoDescontoItemId('')
    setNovoDescontoNomeCriar('')
    setNovoDescontoValor('')
    setNovoAcrescimoItemId('')
    setNovoAcrescimoNomeCriar('')
    setNovoAcrescimoValor('')
    setConfirmarMudancaSexo(false)
    setFormularioAberto(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Desmame tem estrutura própria (linhasDesmame, não linhas) — reabre
  // tanto um lançamento avulso (rows.length === 1) quanto um grupo
  // (2+ linhas do mesmo grupo_lancamento_id), sempre via
  // editandoGrupoId/editandoGrupoLinhasOriginais (mesmo mecanismo já
  // usado pros demais lotes)
  function iniciarEdicaoDesmame(rows: Movimentacao[]) {
    const primeira = rows[0]
    setEditandoId(null)
    setEditandoGrupoId(primeira.grupo_lancamento_id)
    setEditandoGrupoLinhasOriginais(rows)
    setTipo('DESMAME')
    setData(primeira.data)
    setFazendaId(primeira.fazenda_id || '')
    setCategoriaId(primeira.categoria_id || '')
    setCategoriaDestinoId(primeira.categoria_destino_id || '')
    setPastoId(primeira.pasto_id || '')
    setModuloId(pastos.find((p) => p.id === primeira.pasto_id)?.modulo_id || '')
    setObservacao(primeira.observacao || '')
    setLinhasDesmame(
      rows.map((r) => ({
        safraNascimento: r.safra_nascimento_ano_inicio != null ? String(r.safra_nascimento_ano_inicio) : '',
        quantidade: String(r.quantidade),
        pesoMedio: r.peso_medio_kg != null ? String(r.peso_medio_kg) : '',
      }))
    )
    setFormularioAberto(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() {
    setEditandoId(null)
    setEditandoGrupoId(null)
    setEditandoGrupoLinhasOriginais([])
    limparFormulario()
    setFormularioAberto(false)
  }

  // fecha o painel de lançamento — se estava editando, desfaz a edição
  // (mesmo caminho de cancelarEdicao); se era um lançamento novo, só
  // limpa os campos e recolhe
  function handleFecharFormulario() {
    if (editandoId || editandoGrupoId) {
      cancelarEdicao()
    } else {
      limparFormulario()
      setFormularioAberto(false)
    }
  }

  async function excluirMovimentacao(id: string) {
    setExcluindo(true)
    const { error } = await supabase.from('movimentacoes_rebanho').delete().eq('id', id)
    setExcluindo(false)
    if (error) {
      alert('Erro ao excluir: ' + error.message)
      return
    }
    setConfirmarExclusaoMovId(null)
    if (editandoId === id) cancelarEdicao()
    await carregarMovimentacoes()
  }

  async function excluirGrupo(rows: Movimentacao[]) {
    setExcluindo(true)
    const ids = rows.map((r) => r.id)
    const { error } = await supabase.from('movimentacoes_rebanho').delete().in('id', ids)
    setExcluindo(false)
    if (error) {
      alert('Erro ao excluir: ' + error.message)
      return
    }
    setConfirmarExclusaoGrupoId(null)
    if (editandoGrupoLinhasOriginais.some((r) => ids.includes(r.id))) cancelarEdicao()
    await carregarMovimentacoes()
  }

  function limparFiltros() {
    setFiltroFazendaId('')
    setFiltroTipo('')
    setFiltroCategoriaId('')
    setFiltroDataInicio('')
    setFiltroDataFim('')
  }

  const filtroAtivo = !!(filtroFazendaId || filtroTipo || filtroCategoriaId || filtroDataInicio || filtroDataFim)

  // substitui todos os descontos/acréscimos de uma movimentação pelos
  // informados — sempre apaga primeiro (cobre o caso de o tipo ter
  // mudado pra fora dos comerciais em edição, ou de uma linha de lote
  // não ter nenhum ajuste depois do rateio) e só insere os valores > 0
  async function sincronizarAjustesGenerico(
    movimentacaoId: string,
    linhasDesconto: AjusteLancado[],
    linhasAcrescimo: AjusteLancado[]
  ) {
    await supabase.from('movimentacao_ajustes').delete().eq('movimentacao_id', movimentacaoId)
    const linhasAjuste = [
      ...linhasDesconto.filter((d) => d.valor > 0).map((d) => ({ movimentacao_id: movimentacaoId, item_id: d.itemId, valor: d.valor })),
      ...linhasAcrescimo.filter((a) => a.valor > 0).map((a) => ({ movimentacao_id: movimentacaoId, item_id: a.itemId, valor: a.valor })),
    ]
    if (linhasAjuste.length === 0) return
    const { error } = await supabase.from('movimentacao_ajustes').insert(linhasAjuste)
    if (error) alert('Erro ao salvar descontos/acréscimos: ' + error.message)
  }

  async function sincronizarAjustes(movimentacaoId: string) {
    await sincronizarAjustesGenerico(movimentacaoId, isComAjuste ? descontos : [], isComAjuste ? acrescimos : [])
  }

  async function salvarEdicao(payloadFinal: Record<string, unknown>) {
    if (!editandoId) return
    setSalvando(true)
    const { error } = await supabase.from('movimentacoes_rebanho').update(payloadFinal).eq('id', editandoId)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      await sincronizarAjustes(editandoId)
      setEditandoId(null)
      limparFormulario()
      await carregarMovimentacoes()
    }
    setAvisoEdicaoFutura(null)
    setSalvando(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Desmame tem estrutura e handler próprios (linhasDesmame) — checa
    // antes de isLoteCategoria porque editandoGrupoId (reaproveitado
    // pro Desmame) faria isLoteCategoria dar true mesmo com tipo DESMAME
    if (isDesmame) {
      await handleSubmitDesmame()
      return
    }
    if (isLoteCategoria) {
      await handleSubmitLote()
      return
    }
    if (!data || !categoriaId || !quantidade) return

    if (precisaChecarSaldo && saldoDisponivel !== null && parseInt(quantidade, 10) > saldoDisponivel) {
      alert('Saldo indisponível dessa categoria para a data desejada.')
      return
    }

    if (precisaChecarSaldo && saldoPastoDisponivel !== null && parseInt(quantidade, 10) > saldoPastoDisponivel) {
      alert('Saldo indisponível dessa categoria nesse pasto para a data desejada.')
      return
    }

    const payload: Record<string, unknown> = {
      data,
      tipo,
      quantidade: parseInt(quantidade, 10),
      categoria_id: categoriaId,
      observacao: observacao.trim() || null,
    }

    if (isTransferencia) {
      if (!fazendaOrigemId || !fazendaDestinoId || fazendaOrigemId === fazendaDestinoId) {
        alert('Selecione fazendas de origem e destino diferentes.')
        return
      }
      payload.fazenda_id = fazendaOrigemId
      payload.fazenda_origem_id = fazendaOrigemId
      payload.fazenda_destino_id = fazendaDestinoId
    } else {
      if (!fazendaId) return
      payload.fazenda_id = fazendaId
      payload.fazenda_origem_id = null
      payload.fazenda_destino_id = null
    }

    if (!pastoId) {
      alert('Selecione o pasto.')
      return
    }
    payload.pasto_id = pastoId

    if (isTransferencia) {
      if (!pastoDestinoId) {
        alert('Selecione o pasto de destino.')
        return
      }
      payload.pasto_destino_id = pastoDestinoId
    } else {
      payload.pasto_destino_id = null
    }

    if (isMudancaCategoria) {
      if (!categoriaDestinoId || categoriaDestinoId === categoriaId) {
        alert('Selecione categorias de origem e destino diferentes.')
        return
      }
      payload.categoria_destino_id = categoriaDestinoId
    } else {
      payload.categoria_destino_id = null
    }

    if (mudancaEntreSexosDiferentes && !confirmarMudancaSexo) {
      alert('Confirme a mudança entre sexos diferentes antes de salvar.')
      return
    }

    // peso médio é obrigatório em toda movimentação (Mudança de Pasto
    // nem passa por esse formulário — tem tela própria em Controle de
    // Pasto, com peso opcional)
    if (!pesoMedio) return
    payload.peso_medio_kg = parseFloat(pesoMedio)
    // peso_total_kg é sempre derivado no banco (peso_medio_kg × quantidade,
    // ver fn_calcular_peso_total_movimentacao) — enviar o calculado aqui é
    // só pra não deixar a coluna momentaneamente desatualizada antes do
    // trigger rodar, o banco sempre tem a palavra final
    payload.peso_total_kg = pesoTotalCalculado

    if (isVendaAbate) {
      if (!pesoMorto && !rendimentoCarcaca) {
        alert('Informe o peso morto ou o rendimento de carcaça — sem isso não dá pra calcular a arroba corretamente.')
        return
      }
      if (!valorPreco) return
    }
    // peso_morto_kg é guardado como total do lote (mesma convenção de
    // peso_total_kg) — o campo do formulário é por animal, igual peso médio
    payload.peso_morto_kg = isVendaAbate && pesoMorto ? round2(parseFloat(pesoMorto) * parseInt(quantidade, 10)) : null
    payload.rendimento_carcaca_pct = isVendaAbate && rendimentoCarcaca ? parseFloat(rendimentoCarcaca) : null

    CAMPOS_PRECO.forEach((c) => {
      payload[c.key] = null
    })
    if (isComPreco) {
      payload[campoPreco] = valorPreco ? parseFloat(valorPreco) : null
    }

    if (precisaCliente) {
      if (!clienteFornecedorId) return
      payload.cliente_fornecedor_id = clienteFornecedorId
    } else {
      payload.cliente_fornecedor_id = null
    }

    if (isMorte) {
      if (!causaMorte.trim()) return
      payload.causa_morte = causaMorte.trim()
    } else {
      payload.causa_morte = null
    }

    if (isConsumoDoacao) {
      if (!subtipoConsumoDoacao) return
      payload.subtipo_consumo_doacao = subtipoConsumoDoacao
    } else {
      payload.subtipo_consumo_doacao = null
    }

    // lote de nascimento (safra) — obrigatório sempre que a categoria
    // envolvida é bezerro (Nascimento sempre é; nos demais tipos
    // depende da categoria escolhida). Sempre tem um valor sugerido a
    // partir de `data` (regra julho-junho) quando o campo não foi
    // tocado — data já é obrigatória neste ponto do formulário.
    if (mostrarCamposLoteSingular) {
      const safraFinal = safraNascimento ? parseInt(safraNascimento, 10) : safraSugeridaParaData(data)
      payload.safra_nascimento_ano_inicio = safraFinal
    } else {
      payload.safra_nascimento_ano_inicio = null
    }

    payload.proprietario_id = mostrarSeletorProprietario && proprietarioId ? proprietarioId : null

    if (editandoId) {
      setSalvando(true)
      const { data: check, error: checkError } = await supabase.rpc('fn_checar_edicao_movimentacao', {
        p_id: editandoId,
        p_tipo: tipo,
        p_fazenda_id: payload.fazenda_id ?? null,
        p_fazenda_origem_id: payload.fazenda_origem_id ?? null,
        p_fazenda_destino_id: payload.fazenda_destino_id ?? null,
        p_categoria_id: categoriaId,
        p_categoria_destino_id: payload.categoria_destino_id ?? null,
        p_pasto_id: payload.pasto_id ?? null,
        p_pasto_destino_id: payload.pasto_destino_id ?? null,
        p_data: data,
        p_quantidade: parseInt(quantidade, 10),
      })
      setSalvando(false)

      if (checkError) {
        alert('Erro ao validar edição: ' + checkError.message)
        return
      }

      const resultado: ChecagemEdicao | undefined = Array.isArray(check) ? check[0] : check

      if (resultado?.saldo_ficaria_negativo) {
        alert(
          `Não é possível editar: o saldo de ${resultado.categoria_saldo_negativo} no pasto ${resultado.pasto_saldo_negativo} ficaria negativo (${resultado.saldo_minimo}) em ${resultado.data_saldo_negativo}.`
        )
        return
      }

      if (resultado?.tem_movimentacoes_futuras) {
        setAvisoEdicaoFutura({
          payload,
          mensagem: 'Existem movimentações posteriores desta categoria. Confirma a edição mesmo assim?',
        })
        return
      }

      await salvarEdicao(payload)
      return
    }

    setSalvando(true)
    const { data: novaMovimentacao, error } = await supabase
      .from('movimentacoes_rebanho')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      await sincronizarAjustes(novaMovimentacao.id)
      limparFormulario()
      await carregarMovimentacoes()
    }
    setSalvando(false)
  }

  // insere as novas linhas do lote (e, se idsAntigos vier preenchido,
  // apaga as linhas antigas do grupo antes) — caminho compartilhado
  // entre criar um lote novo (idsAntigos vazio) e salvar a edição de um
  // grupo existente (idsAntigos = linhas antigas desse grupo)
  async function finalizarSalvarLote(
    payloads: Record<string, unknown>[],
    linhasComCalculo: { valorTotal: number | null }[],
    idsAntigos: string[]
  ) {
    setSalvando(true)

    if (idsAntigos.length > 0) {
      const { error: delError } = await supabase.from('movimentacoes_rebanho').delete().in('id', idsAntigos)
      if (delError) {
        alert('Erro ao salvar: ' + delError.message)
        setSalvando(false)
        return
      }
    }

    const { data: novasMovimentacoes, error } = await supabase
      .from('movimentacoes_rebanho')
      .insert(payloads)
      .select('id')

    if (error) {
      alert('Erro ao salvar: ' + error.message)
      setSalvando(false)
      return
    }

    // desconto/acréscimo é um valor único do lançamento inteiro — dividido
    // proporcionalmente pelo valor bruto de cada linha, senão o "líquido"
    // por categoria não bateria com o valor líquido total do lançamento
    const somaValorTotal = linhasComCalculo.reduce((s, l) => s + (l.valorTotal ?? 0), 0)
    if (isComAjuste && (descontos.length > 0 || acrescimos.length > 0) && novasMovimentacoes) {
      await Promise.all(
        novasMovimentacoes.map((mov, i) => {
          const valorLinha = linhasComCalculo[i].valorTotal ?? 0
          const proporcao = somaValorTotal > 0 ? valorLinha / somaValorTotal : 0
          return sincronizarAjustesGenerico(
            mov.id,
            descontos.map((d) => ({ ...d, valor: round2(d.valor * proporcao) })),
            acrescimos.map((a) => ({ ...a, valor: round2(a.valor * proporcao) }))
          )
        })
      )
    }

    setEditandoGrupoId(null)
    setEditandoGrupoLinhasOriginais([])
    setAvisoEdicaoFuturaGrupo(null)
    limparFormulario()
    await carregarMovimentacoes()
    setSalvando(false)
  }

  // lançamento em lote: cada linha vira uma movimentação própria, todas
  // compartilhando os campos "de cabeçalho" (data, fazenda(s), pasto(s),
  // cliente, causa da morte, subtipo, observação). Um insert em lote só
  // (uma chamada com várias linhas) em vez de N inserts separados —
  // além de mais simples, garante atomicidade (se uma linha estourar o
  // saldo, a trigger rejeita e nenhuma linha é salva) e a trigger de
  // saldo de uma linha já enxerga as linhas anteriores do mesmo lote,
  // já que o Postgres processa cada linha do INSERT em sequência.
  // Editando um grupo existente (editandoGrupoId), o mesmo formulário
  // reabre todas as linhas — salvar apaga as linhas antigas do grupo e
  // reinsere as novas com o mesmo grupo_lancamento_id, depois de checar
  // (por linha antiga, reaproveitando fn_checar_edicao_movimentacao) se
  // é seguro apagar cada uma.
  async function handleSubmitLote() {
    if (!data) return

    const linhasIncompletas = linhas.some((l) => (l.categoriaId || l.quantidade) && (!l.categoriaId || !l.quantidade))
    if (linhasIncompletas) {
      alert('Preencha categoria e quantidade em todas as linhas (ou remova a linha incompleta).')
      return
    }
    const linhasValidas = linhas.filter((l) => l.categoriaId && l.quantidade)
    if (linhasValidas.length === 0) return

    if (isTransferencia) {
      if (!fazendaOrigemId || !fazendaDestinoId || fazendaOrigemId === fazendaDestinoId) {
        alert('Selecione fazendas de origem e destino diferentes.')
        return
      }
    } else if (!fazendaId) {
      return
    }

    if (!pastoId) {
      alert('Selecione o pasto.')
      return
    }
    if (isTransferencia && !pastoDestinoId) {
      alert('Selecione o pasto de destino.')
      return
    }
    if (precisaCliente && !clienteFornecedorId) return
    if (isMorte && !causaMorte.trim()) return
    if (isConsumoDoacao && !subtipoConsumoDoacao) return
    // peso médio é obrigatório em toda categoria do lote (Mudança de Pasto
    // não usa esse formulário — tem tela própria em Controle de Pasto)
    if (linhasValidas.some((l) => !l.pesoMedio)) return
    if (isVendaAbate) {
      if (linhasValidas.some((l) => !l.pesoMorto && !l.rendimentoCarcaca)) {
        alert(
          'Informe o peso morto ou o rendimento de carcaça em todas as categorias — sem isso não dá pra calcular a arroba corretamente.'
        )
        return
      }
      if (linhasValidas.some((l) => !l.valorPreco)) return
    }

    // checagem de saldo é best-effort aqui (preview) — quem garante mesmo
    // é a trigger fn_validar_saldo_categoria no banco
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i]
      if (!linha.categoriaId || !linha.quantidade) continue
      const saldo = saldosLinhas[i]
      if (precisaChecarSaldo && saldo != null && parseInt(linha.quantidade, 10) > saldo) {
        alert('Saldo indisponível de uma das categorias selecionadas para a data desejada.')
        return
      }
    }

    const linhasComCalculo = linhasValidas.map((linha) => ({ linha, ...calcularLinha(linha) }))
    const grupoId = linhasComCalculo.length > 1 ? editandoGrupoId ?? crypto.randomUUID() : null

    const payloads = linhasComCalculo.map(({ linha, pesoTotal }) => {
      const cat = categorias.find((c) => c.id === linha.categoriaId)
      const linhaEhBezerro = isNascimento || categoriaEhBezerro(cat)
      const safraNascLinha = linha.safraNascimento ? parseInt(linha.safraNascimento, 10) : safraSugeridaParaData(data)
      const payload: Record<string, unknown> = {
        data,
        tipo,
        quantidade: parseInt(linha.quantidade, 10),
        categoria_id: linha.categoriaId,
        categoria_destino_id: null,
        observacao: observacao.trim() || null,
        peso_medio_kg: linha.pesoMedio ? parseFloat(linha.pesoMedio) : null,
        // peso_total_kg é sempre derivado no banco (peso_medio_kg × quantidade,
        // ver fn_calcular_peso_total_movimentacao) — enviar o calculado aqui é
        // só pra não deixar a coluna momentaneamente desatualizada
        peso_total_kg: pesoTotal,
        // total do lote (mesma convenção de peso_total_kg) — o campo do
        // formulário é por animal, igual peso médio
        peso_morto_kg:
          isVendaAbate && linha.pesoMorto ? round2(parseFloat(linha.pesoMorto) * parseInt(linha.quantidade, 10)) : null,
        rendimento_carcaca_pct: isVendaAbate && linha.rendimentoCarcaca ? parseFloat(linha.rendimentoCarcaca) : null,
        cliente_fornecedor_id: precisaCliente ? clienteFornecedorId : null,
        causa_morte: isMorte ? causaMorte.trim() : null,
        subtipo_consumo_doacao: isConsumoDoacao ? subtipoConsumoDoacao : null,
        pasto_id: pastoId,
        pasto_destino_id: isTransferencia ? pastoDestinoId : null,
        safra_nascimento_ano_inicio: linhaEhBezerro ? safraNascLinha : null,
        proprietario_id: mostrarSeletorProprietario && linha.proprietarioId ? linha.proprietarioId : null,
        grupo_lancamento_id: grupoId,
      }
      CAMPOS_PRECO.forEach((c) => {
        payload[c.key] = null
      })
      if (isComPreco) payload[linha.campoPreco] = linha.valorPreco ? parseFloat(linha.valorPreco) : null

      if (isTransferencia) {
        payload.fazenda_id = fazendaOrigemId
        payload.fazenda_origem_id = fazendaOrigemId
        payload.fazenda_destino_id = fazendaDestinoId
      } else {
        payload.fazenda_id = fazendaId
        payload.fazenda_origem_id = null
        payload.fazenda_destino_id = null
      }
      return payload
    })

    const valoresLinhas = linhasComCalculo.map((l) => ({ valorTotal: l.valorTotal }))

    if (!editandoGrupoId) {
      await finalizarSalvarLote(payloads, valoresLinhas, [])
      return
    }

    // editando um grupo existente: checa trajetória de cada linha antiga
    // (mesma checagem já usada pra editar uma movimentação avulsa) antes
    // de apagá-las
    setSalvando(true)
    let futuraEncontrada = false
    for (const r of editandoGrupoLinhasOriginais) {
      const { data: check, error: checkError } = await supabase.rpc('fn_checar_edicao_movimentacao', {
        p_id: r.id,
        p_tipo: r.tipo,
        p_fazenda_id: r.fazenda_id,
        p_fazenda_origem_id: r.fazenda_origem_id,
        p_fazenda_destino_id: r.fazenda_destino_id,
        p_categoria_id: r.categoria_id,
        p_categoria_destino_id: r.categoria_destino_id,
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
      setAvisoEdicaoFuturaGrupo({
        payloads,
        linhasComCalculo: valoresLinhas,
        idsAntigos,
        mensagem: 'Existem movimentações posteriores dessas categorias. Confirma a edição mesmo assim?',
      })
      return
    }

    await finalizarSalvarLote(payloads, valoresLinhas, idsAntigos)
  }

  // Desmame: categoria origem/destino/fazenda/pasto ficam fixas no
  // cabeçalho (campos de nível de componente já usados por todos os
  // tipos), as linhas variam só por lote de nascimento (safra+mês) +
  // quantidade + peso médio. Reaproveita finalizarSalvarLote (genérico,
  // já cobre insert/apaga-e-reinsere) — sem desconto/acréscimo, então
  // linhasComCalculo entra só com valorTotal null.
  async function handleSubmitDesmame() {
    if (!data || !fazendaId || !categoriaId || !categoriaDestinoId) return
    if (!pastoId) {
      alert('Selecione o pasto.')
      return
    }

    const linhasIncompletas = linhasDesmame.some(
      (l) =>
        (l.safraNascimento || l.quantidade || l.pesoMedio) &&
        (!l.safraNascimento || !l.quantidade || !l.pesoMedio)
    )
    if (linhasIncompletas) {
      alert('Preencha o lote, a quantidade e o peso médio em todas as linhas (ou remova a linha incompleta).')
      return
    }
    const linhasValidas = linhasDesmame.filter((l) => l.safraNascimento && l.quantidade && l.pesoMedio)
    if (linhasValidas.length === 0) return

    // checagem de saldo do lote é best-effort aqui (preview) — quem
    // garante mesmo é a trigger fn_validar_saldo_categoria no banco
    for (const linha of linhasValidas) {
      const lote = lotesDesmameDisponiveis.find((l) => String(l.safra) === linha.safraNascimento)
      if (lote && parseInt(linha.quantidade, 10) > lote.saldo) {
        alert('Saldo indisponível em um dos lotes de nascimento selecionados para a data desejada.')
        return
      }
    }

    const grupoId = linhasValidas.length > 1 ? editandoGrupoId ?? crypto.randomUUID() : null

    const payloads = linhasValidas.map((linha) => ({
      data,
      tipo: 'DESMAME',
      quantidade: parseInt(linha.quantidade, 10),
      categoria_id: categoriaId,
      categoria_destino_id: categoriaDestinoId,
      fazenda_id: fazendaId,
      fazenda_origem_id: null,
      fazenda_destino_id: null,
      pasto_id: pastoId,
      pasto_destino_id: null,
      peso_medio_kg: parseFloat(linha.pesoMedio),
      peso_total_kg: round2(parseFloat(linha.pesoMedio) * parseInt(linha.quantidade, 10)),
      peso_morto_kg: null,
      rendimento_carcaca_pct: null,
      valor_arroba: null,
      valor_cabeca: null,
      valor_kg: null,
      valor_total: null,
      cliente_fornecedor_id: null,
      causa_morte: null,
      subtipo_consumo_doacao: null,
      observacao: observacao.trim() || null,
      safra_nascimento_ano_inicio: parseInt(linha.safraNascimento, 10),
      grupo_lancamento_id: grupoId,
    }))

    const linhasComCalculo = payloads.map(() => ({ valorTotal: null as number | null }))
    const idsAntigos = editandoGrupoLinhasOriginais.map((r) => r.id)

    if (idsAntigos.length === 0) {
      await finalizarSalvarLote(payloads, linhasComCalculo, [])
      return
    }

    // editando um grupo (ou lançamento avulso) existente: checa
    // trajetória de cada linha antiga antes de apagá-las, mesmo
    // princípio já usado nos demais lotes
    setSalvando(true)
    let futuraEncontrada = false
    for (const r of editandoGrupoLinhasOriginais) {
      const { data: check, error: checkError } = await supabase.rpc('fn_checar_edicao_movimentacao', {
        p_id: r.id,
        p_tipo: r.tipo,
        p_fazenda_id: r.fazenda_id,
        p_fazenda_origem_id: r.fazenda_origem_id,
        p_fazenda_destino_id: r.fazenda_destino_id,
        p_categoria_id: r.categoria_id,
        p_categoria_destino_id: r.categoria_destino_id,
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

    if (futuraEncontrada) {
      setAvisoEdicaoFuturaGrupo({
        payloads,
        linhasComCalculo,
        idsAntigos,
        mensagem: 'Existem movimentações posteriores dessas categorias. Confirma a edição mesmo assim?',
      })
      return
    }

    await finalizarSalvarLote(payloads, linhasComCalculo, idsAntigos)
  }

  async function handleCriarCliente(e: React.FormEvent) {
    e.preventDefault()
    if (!novoClienteNome.trim()) return

    setSalvandoCliente(true)
    const { data: novoCliente, error } = await supabase
      .from('pessoas')
      .insert({
        nome: novoClienteNome.trim(),
        documento: novoClienteDocumento.trim() || null,
      })
      .select('id, nome')
      .single()

    if (error) {
      alert('Erro ao salvar: ' + error.message)
      setSalvandoCliente(false)
      return
    }

    const papeis: PapelPessoa[] = novoClienteTipo === 'AMBOS' ? ['CLIENTE', 'FORNECEDOR'] : [novoClienteTipo]
    const { error: errorPapeis } = await supabase
      .from('pessoa_papeis')
      .insert(papeis.map((papel) => ({ pessoa_id: novoCliente.id, papel })))

    if (errorPapeis) {
      alert('Erro ao salvar papel: ' + errorPapeis.message)
    } else {
      setClientesFornecedores((prev) => [...prev, novoCliente].sort((a, b) => a.nome.localeCompare(b.nome)))
      setClienteFornecedorId(novoCliente.id)
      setModalClienteAberto(false)
      setNovoClienteNome('')
      setNovoClienteTipo('AMBOS')
      setNovoClienteDocumento('')
    }
    setSalvandoCliente(false)
  }

  async function adicionarAjuste(tipoAjuste: TipoAjuste) {
    const itemId = tipoAjuste === 'DESCONTO' ? novoDescontoItemId : novoAcrescimoItemId
    const nomeCriar = tipoAjuste === 'DESCONTO' ? novoDescontoNomeCriar : novoAcrescimoNomeCriar
    const valorStr = tipoAjuste === 'DESCONTO' ? novoDescontoValor : novoAcrescimoValor
    const valor = parseFloat(valorStr)
    if (!itemId || !valor || valor <= 0) return

    let item: ItemAjuste | undefined
    if (itemId === NOVO_ITEM_AJUSTE) {
      if (!nomeCriar.trim()) return
      const setCriando = tipoAjuste === 'DESCONTO' ? setCriandoAjusteDesconto : setCriandoAjusteAcrescimo
      setCriando(true)
      const { data: novoItem, error } = await supabase
        .from('itens_ajuste_financeiro')
        .insert({ nome: nomeCriar.trim(), tipo: tipoAjuste })
        .select('id, nome, tipo')
        .single()
      setCriando(false)
      if (error) {
        alert('Erro ao cadastrar item: ' + error.message)
        return
      }
      item = novoItem
      setItensAjuste((prev) => [...prev, novoItem].sort((a, b) => a.nome.localeCompare(b.nome)))
    } else {
      item = itensAjuste.find((i) => i.id === itemId)
    }
    if (!item) return

    const linha: AjusteLancado = { itemId: item.id, itemNome: item.nome, valor }
    if (tipoAjuste === 'DESCONTO') {
      setDescontos((prev) => [...prev, linha])
      setNovoDescontoItemId('')
      setNovoDescontoNomeCriar('')
      setNovoDescontoValor('')
    } else {
      setAcrescimos((prev) => [...prev, linha])
      setNovoAcrescimoItemId('')
      setNovoAcrescimoNomeCriar('')
      setNovoAcrescimoValor('')
    }
  }

  function removerAjuste(tipoAjuste: TipoAjuste, index: number) {
    if (tipoAjuste === 'DESCONTO') setDescontos((prev) => prev.filter((_, i) => i !== index))
    else setAcrescimos((prev) => prev.filter((_, i) => i !== index))
  }

  function descreverMovimentacao(m: Movimentacao) {
    if (m.tipo === 'TRANSFERENCIA') {
      return `${m.fazenda_origem?.nome ?? '—'} → ${m.fazenda_destino?.nome ?? '—'} · ${m.categoria?.nome ?? '—'}`
    }
    if (m.tipo === 'MUDANCA_CATEGORIA' || m.tipo === 'DESMAME') {
      return `${m.fazenda?.nome ?? '—'} · ${m.categoria?.nome ?? '—'} → ${m.categoria_destino?.nome ?? '—'}`
    }
    return `${m.fazenda?.nome ?? '—'} · ${m.categoria?.nome ?? '—'}`
  }

  function detalhesMovimentacao(m: Movimentacao, omitirCliente = false) {
    const partes: string[] = [`${formatQuantidade(m.quantidade)} cab.`]
    if (m.peso_medio_kg) partes.push(`${formatPeso(m.peso_medio_kg)} kg/cab`)
    if (m.peso_total_kg) partes.push(`${formatPeso(m.peso_total_kg)} kg total`)
    if (m.peso_morto_kg) partes.push(`${formatPeso(m.peso_morto_kg)} kg carcaça`)
    if (m.rendimento_carcaca_pct) partes.push(`rend. ${formatPeso(m.rendimento_carcaca_pct)}%`)
    if (m.valor_arroba) partes.push(`${formatMoeda(m.valor_arroba)}/@`)
    if (m.valor_cabeca) partes.push(`${formatMoeda(m.valor_cabeca)}/cab.`)
    if (m.valor_kg) partes.push(`${formatMoeda(m.valor_kg)}/kg`)
    if (m.valor_total) partes.push(`${formatMoeda(m.valor_total)} total`)
    const ajustes = m.movimentacao_ajustes || []
    if (ajustes.length > 0 && m.valor_total != null) {
      const desconto = ajustes.filter((a) => a.item?.tipo === 'DESCONTO').reduce((s, a) => s + a.valor, 0)
      const acrescimo = ajustes.filter((a) => a.item?.tipo === 'ACRESCIMO').reduce((s, a) => s + a.valor, 0)
      partes.push(`líquido: ${formatMoeda(round2(m.valor_total - desconto + acrescimo))}`)
    }
    if (!omitirCliente && m.cliente?.nome) partes.push(m.cliente.nome)
    if (m.causa_morte) partes.push(`causa: ${m.causa_morte}`)
    if (m.subtipo_consumo_doacao) partes.push(m.subtipo_consumo_doacao)
    if (m.safra_nascimento_ano_inicio != null) {
      partes.push(`safra ${formatSafra(m.safra_nascimento_ano_inicio)}`)
    }
    if (m.pasto?.nome && m.pasto.nome !== 'Geral') partes.push(`pasto: ${m.pasto.nome}`)
    if (m.proprietario?.nome) partes.push(`propriet.: ${m.proprietario.nome}`)
    return partes.join(' · ')
  }

  // agrupa linhas com o mesmo grupo_lancamento_id (lançamentos em lote)
  // numa única entrada — movimentações avulsas (grupo_lancamento_id
  // null) viram um "grupo" de uma linha só, sem mudança visual nenhuma
  type GrupoMovimentacoes = { groupId: string | null; movimentacoes: Movimentacao[] }
  const gruposMovimentacoes: GrupoMovimentacoes[] = []
  {
    const indicePorGrupo = new Map<string, number>()
    movimentacoes.forEach((m) => {
      if (!m.grupo_lancamento_id) {
        gruposMovimentacoes.push({ groupId: null, movimentacoes: [m] })
        return
      }
      const idx = indicePorGrupo.get(m.grupo_lancamento_id)
      if (idx === undefined) {
        indicePorGrupo.set(m.grupo_lancamento_id, gruposMovimentacoes.length)
        gruposMovimentacoes.push({ groupId: m.grupo_lancamento_id, movimentacoes: [m] })
      } else {
        gruposMovimentacoes[idx].movimentacoes.push(m)
      }
    })
  }

  return (
    <ModuloGate modulo="movimentacoes">
    <div className="mx-auto max-w-7xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Lançamento de Movimentações de Rebanho</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Escolha o tipo, preencha data e local, e lance uma ou várias categorias de uma vez — os totais e o efetivo
        da fazenda são calculados em tempo real ao lado.
      </p>

      {!formularioAberto ? (
        <button
          type="button"
          onClick={() => setFormularioAberto(true)}
          className="mt-6 flex w-full items-center gap-3 rounded-card border-2 border-dashed border-brand-500 bg-brand-100/40 px-5 py-4 text-left transition-colors hover:bg-brand-100 sm:w-auto"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-500 text-lg font-bold text-white">+</span>
          <span>
            <span className="block text-sm font-bold text-brand-500">Novo Lançamento</span>
            <span className="block text-xs text-text-secondary">Registrar uma movimentação de rebanho</span>
          </span>
        </button>
      ) : (
      <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">
          {editandoId || editandoGrupoId ? 'Editar lançamento' : 'Novo lançamento'}
        </h2>
        <button
          type="button"
          onClick={handleFecharFormulario}
          className="text-xs font-medium text-text-secondary underline hover:text-text-primary"
        >
          Fechar
        </button>
      </div>
      <div className="mt-2">
        {/* FORMULÁRIO */}
        <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter}>
          {/* PASSO 1 — TIPO */}
          <div className="rounded-card border border-border bg-surface">
            <div className="flex items-start gap-3 border-b border-border p-5">
              <StepBadge n={1} />
              <div>
                <h3 className="text-sm font-bold text-text-primary">Tipo de movimentação</h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  A cor indica entrada, saída ou reclassificação interna do rebanho.
                </p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {DIRECAO_GRUPOS.map((g) => {
                const itens = TIPOS.filter((t) => DIRECAO_TIPO[t] === g.direcao)
                const cls = DIRECAO_CLASSES[g.direcao]
                return (
                  <div key={g.direcao}>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                      <span className={`h-2 w-2 rounded-sm ${cls.bg}`} />
                      {g.label}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {itens.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTipo(t)}
                          className={`flex items-center gap-2.5 rounded-control border p-2.5 text-left transition-colors ${
                            tipo === t
                              ? 'border-brand-500 bg-brand-100/40 ring-2 ring-brand-100'
                              : 'border-border hover:border-text-muted'
                          }`}
                        >
                          <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-control p-1.5 ${cls.bg} ${cls.fg}`}>
                            <IconeMovimentacao tipo={t} />
                          </span>
                          <span className="text-xs font-semibold leading-tight text-text-primary">{LABEL_TIPO[t]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* PASSO 2 — QUANDO E ONDE */}
          <div className="mt-4 rounded-card border border-border bg-surface">
            <div className="flex items-start gap-3 border-b border-border p-5">
              <StepBadge n={2} />
              <div>
                <h3 className="text-sm font-bold text-text-primary">Quando e onde</h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Data do evento, fazenda e, se o controle por pasto estiver ligado, módulo e pasto.
                </p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    Data
                    <Required />
                  </label>
                  <input
                    type="date"
                    max={hoje}
                    className={inputClass}
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                    required
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => definirDataAtalho(0)}
                      className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs font-semibold text-text-secondary hover:border-brand-500 hover:text-brand-500"
                    >
                      Hoje
                    </button>
                    <button
                      type="button"
                      onClick={() => definirDataAtalho(-1)}
                      className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs font-semibold text-text-secondary hover:border-brand-500 hover:text-brand-500"
                    >
                      Ontem
                    </button>
                  </div>
                </div>

                {!isTransferencia && (
                  <div>
                    <label className={labelClass}>
                      Fazenda
                      <Required />
                    </label>
                    <select
                      className={inputClass}
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
                    {renderEfetivoHint()}
                  </div>
                )}
              </div>

              {isTransferencia && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>
                      Fazenda origem
                      <Required />
                    </label>
                    <select
                      className={inputClass}
                      value={fazendaOrigemId}
                      onChange={(e) => setFazendaOrigemId(e.target.value)}
                      required
                    >
                      <option value="">Selecione...</option>
                      {fazendas.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </select>
                    {renderEfetivoHint()}
                  </div>
                  <div>
                    <label className={labelClass}>
                      Fazenda destino
                      <Required />
                    </label>
                    <select
                      className={inputClass}
                      value={fazendaDestinoId}
                      onChange={(e) => setFazendaDestinoId(e.target.value)}
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
              )}

              {/* proprietário aqui só faz sentido fora do modo lote — com
                  2+ categorias na tabela do passo 3, cada linha tem seu
                  próprio seletor de proprietário (ver TIPOS_COM_LOTE),
                  já que categorias diferentes do mesmo lançamento podem
                  pertencer a donos diferentes */}
              {mostrarSeletorProprietario && !isMudancaCategoria && !isDesmame && !isLoteCategoria && (
                <div>
                  <label className={labelClass}>Proprietário do lote</label>
                  <select className={inputClass} value={proprietarioId} onChange={(e) => setProprietarioId(e.target.value)}>
                    <option value="">Sem proprietário atribuído</option>
                    {proprietariosDisponiveis.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(mostrarSeletorModuloOrigem || mostrarSeletorPastoOrigem || mostrarSeletorModuloDestino || mostrarSeletorPastoDestino) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {mostrarSeletorModuloOrigem && (
                    <div>
                      <label className={labelClass}>
                        Módulo
                        <Required />
                      </label>
                      <select className={inputClass} value={moduloId} onChange={(e) => setModuloId(e.target.value)} required>
                        <option value="">Selecione...</option>
                        {modulosOrigemDisponiveis.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {mostrarSeletorPastoOrigem && (
                    <div>
                      <label className={labelClass}>
                        Pasto
                        <Required />
                      </label>
                      <select className={inputClass} value={pastoId} onChange={(e) => setPastoId(e.target.value)} required>
                        <option value="">Selecione...</option>
                        {pastosOrigemDoModulo.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {mostrarSeletorModuloDestino && (
                    <div>
                      <label className={labelClass}>
                        Módulo destino (fazenda destino)
                        <Required />
                      </label>
                      <select
                        className={inputClass}
                        value={moduloDestinoId}
                        onChange={(e) => setModuloDestinoId(e.target.value)}
                        required
                      >
                        <option value="">Selecione...</option>
                        {modulosDestinoDisponiveis.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {mostrarSeletorPastoDestino && (
                    <div>
                      <label className={labelClass}>
                        Pasto destino (fazenda destino)
                        <Required />
                      </label>
                      <select
                        className={inputClass}
                        value={pastoDestinoId}
                        onChange={(e) => setPastoDestinoId(e.target.value)}
                        required
                      >
                        <option value="">Selecione...</option>
                        {pastosDestinoDoModulo.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {bloqueadoPorSaldoInicial && (
                <div className="rounded-control border border-error bg-error-bg px-4 py-3 text-sm text-error">
                  {fazendasSemSaldoInicial.length === 1
                    ? `A fazenda "${fazendasSemSaldoInicial[0].nome}" ainda não teve o saldo inicial preenchido e confirmado.`
                    : `As fazendas ${fazendasSemSaldoInicial.map((f) => `"${f.nome}"`).join(' e ')} ainda não tiveram o saldo inicial preenchido e confirmado.`}{' '}
                  Isso precisa ser feito antes de lançar qualquer outra movimentação.{' '}
                  <a href="/fazendas" className="font-medium underline">
                    Ir para Fazendas
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* PASSO 3 — CATEGORIAS */}
          <div className="mt-4 rounded-card border border-border bg-surface">
            <div className="flex items-start gap-3 border-b border-border p-5">
              <StepBadge n={3} />
              <div>
                <h3 className="text-sm font-bold text-text-primary">
                  {isDesmame
                    ? 'Lotes desmamados'
                    : isMudancaCategoria
                      ? 'Mudança de categoria'
                      : isLoteCategoria
                        ? 'Categorias e quantidades'
                        : 'Categoria e quantidade'}
                  <Required />
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {isDesmame
                    ? 'Categoria de origem e destino ficam fixas; as linhas variam por lote de nascimento (safra).'
                    : isLoteCategoria
                      ? 'Adicione quantas linhas forem necessárias — os totais são calculados automaticamente.'
                      : 'Preencha os dados da categoria envolvida.'}
                </p>
              </div>
            </div>
            <div className="p-5">
              {isDesmame ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>
                        Categoria (bezerro a desmamar)
                        <Required />
                      </label>
                      <select className={inputClass} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
                        <option value="">Selecione...</option>
                        {categoriasVisiveis.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>
                        Categoria destino (após desmame)
                        <Required />
                      </label>
                      <select
                        className={inputClass}
                        value={categoriaDestinoId}
                        onChange={(e) => setCategoriaDestinoId(e.target.value)}
                        required
                      >
                        <option value="">Selecione...</option>
                        {categoriasDestinoDesmame.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                      {!categoriaOrigemSelecionada && (
                        <p className="mt-1 text-xs text-text-muted">Selecione a categoria de origem primeiro.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-control border border-border p-3">
                    <div className="mb-2 text-sm font-medium text-text-secondary">
                      Lotes desmamados (por safra de nascimento)
                      <Required />
                    </div>
                    <div className="space-y-2">
                      {linhasDesmame.map((linha, i) => (
                        <div key={i} className="rounded-control border border-border p-2.5">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs text-text-muted">Linha {i + 1}</span>
                            {linhasDesmame.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-error underline"
                                onClick={() => removerLinhaDesmame(i)}
                              >
                                Remover
                              </button>
                            )}
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-text-secondary">
                              Lote (safra de nascimento)
                              <Required />
                            </label>
                            <select
                              className={inputSmClass}
                              value={linha.safraNascimento}
                              onChange={(e) => atualizarLinhaDesmame(i, { safraNascimento: e.target.value })}
                            >
                              <option value="">Selecione...</option>
                              {lotesDesmameDisponiveis.map((l) => (
                                <option key={l.safra} value={String(l.safra)}>
                                  Safra {formatSafra(l.safra)} ({formatQuantidade(l.saldo)} disponível)
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-1 block text-xs text-text-secondary">
                                Quantidade
                                <Required />
                              </label>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className={inputSmClass}
                                value={linha.quantidade}
                                onChange={(e) => atualizarLinhaDesmame(i, { quantidade: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-text-secondary">
                                Peso médio (kg)
                                <Required />
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                className={inputSmClass}
                                value={linha.pesoMedio}
                                onChange={(e) => atualizarLinhaDesmame(i, { pesoMedio: e.target.value })}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="mt-2 text-sm font-semibold text-brand-500 underline" onClick={adicionarLinhaDesmame}>
                      + Adicionar lote
                    </button>
                  </div>
                </>
              ) : !isLoteCategoria ? (
                <>
                  <div>
                    <label className={labelClass}>
                      {isMudancaCategoria ? 'Categoria origem' : 'Categoria'}
                      <Required />
                    </label>
                    <select className={inputClass} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
                      <option value="">Selecione...</option>
                      {categoriasVisiveis.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isMudancaCategoria && (
                    <div className="mt-4">
                      <label className={labelClass}>
                        Categoria destino
                        <Required />
                      </label>
                      <select
                        className={inputClass}
                        value={categoriaDestinoId}
                        onChange={(e) => setCategoriaDestinoId(e.target.value)}
                        required
                      >
                        <option value="">Selecione...</option>
                        {categorias
                          .filter((c) => !categoriaEhBezerro(c))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {mudancaEntreSexosDiferentes && (
                    <div className="mt-4 rounded-control border border-warning bg-warning-bg p-3 text-sm">
                      <p className="text-text-primary">
                        Atenção: essa mudança é de <strong>{categoriaOrigemSelecionada?.sexo}</strong> para{' '}
                        <strong>{categoriaDestinoSelecionada?.sexo}</strong>. Isso normalmente não deveria acontecer —
                        confirme só se for um ajuste de estoque intencional.
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-text-primary">
                        <input
                          type="checkbox"
                          checked={confirmarMudancaSexo}
                          onChange={(e) => setConfirmarMudancaSexo(e.target.checked)}
                        />
                        Confirmo que é uma mudança entre sexos diferentes (ajuste de estoque)
                      </label>
                    </div>
                  )}

                  <div className="mt-4">
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
                      required
                    />
                    {precisaChecarSaldo && fazendaParaSaldo && categoriaId && data && (
                      <p
                        className={`mt-1 text-xs ${
                          saldoDisponivel !== null && quantidade && parseInt(quantidade, 10) > saldoDisponivel
                            ? 'text-error'
                            : 'text-text-secondary'
                        }`}
                      >
                        {carregandoSaldo
                          ? 'Consultando saldo...'
                          : saldoDisponivel !== null
                            ? `Saldo disponível: ${formatQuantidade(saldoDisponivel)} cabeça(s)${
                                quantidade && parseInt(quantidade, 10) > saldoDisponivel
                                  ? ' — saldo indisponível dessa categoria para a data desejada'
                                  : ''
                              }`
                            : ''}
                      </p>
                    )}
                    {precisaChecarSaldo && mostrarSeletorPastoOrigem && pastoId && data && (
                      <p
                        className={`mt-1 text-xs ${
                          saldoPastoDisponivel !== null && quantidade && parseInt(quantidade, 10) > saldoPastoDisponivel
                            ? 'text-error'
                            : 'text-text-secondary'
                        }`}
                      >
                        {carregandoSaldoPasto
                          ? 'Consultando saldo no pasto...'
                          : saldoPastoDisponivel !== null
                            ? `Saldo disponível nesse pasto: ${formatQuantidade(saldoPastoDisponivel)} cabeça(s)${
                                quantidade && parseInt(quantidade, 10) > saldoPastoDisponivel
                                  ? ' — saldo indisponível dessa categoria nesse pasto para a data desejada'
                                  : ''
                              }`
                            : ''}
                      </p>
                    )}
                  </div>

                  {(isSimples || isMudancaCategoria || isComPreco) && (
                    <div className="mt-4">
                      <label className={labelClass}>
                        Peso médio (kg)
                        <Required />
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={inputClass}
                        value={pesoMedio}
                        onChange={(e) => setPesoMedio(e.target.value)}
                        required
                      />
                      {isComPreco && (
                        <p className="mt-1 text-xs text-text-secondary">
                          Peso total (calculado): {pesoTotalCalculado !== null ? `${formatPeso(pesoTotalCalculado)} kg` : '—'}
                        </p>
                      )}
                    </div>
                  )}

                  {mostrarCamposLoteSingular &&
                    (isNascimento || tipo === 'COMPRA' ? (
                      <div className="mt-4">
                        <label className={labelClass}>
                          Safra do bezerro
                          <Required />
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={inputClass}
                          value={formatSafraInput(safraNascimento || (data ? String(safraSugeridaParaData(data)) : ''))}
                          onChange={(e) => setSafraNascimento(extrairAnoSafraDigitado(e.target.value))}
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                    ) : (
                      <div className="mt-4">
                        <label className={labelClass}>
                          Lote de nascimento (safra)
                          <Required />
                        </label>
                        <select className={inputClass} value={safraNascimento} onChange={(e) => setSafraNascimento(e.target.value)}>
                          <option value="">Selecione...</option>
                          {lotesDisponiveisSingular.map((l) => (
                            <option key={l.safra} value={String(l.safra)}>
                              Safra {formatSafra(l.safra)} ({formatQuantidade(l.saldo)} disponível)
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}

                  {isVendaAbate && (
                    <div className="mt-4">
                      <label className={labelClass}>
                        Peso morto (kg) ou rendimento de carcaça (%) — por animal
                        <Required />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Peso morto (kg)"
                          className={inputClass}
                          value={pesoMorto}
                          onChange={(e) => handlePesoMortoChange(e.target.value)}
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Rendimento (%)"
                          className={inputClass}
                          value={rendimentoCarcaca}
                          onChange={(e) => handleRendimentoChange(e.target.value)}
                        />
                      </div>
                      <p className="mt-1 text-xs text-text-secondary">
                        Preencha um dos dois — o outro é calculado automaticamente.
                        {arrobaPorAnimalPreview !== null && ` Peso em arrobas: ${formatDecimal(arrobaPorAnimalPreview)} @/animal.`}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-control border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-bg">
                          <th className="min-w-[160px] border-b border-border p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                            Categoria
                          </th>
                          <th className="w-20 border-b border-border p-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                            Qtd.
                          </th>
                          <th className="w-28 border-b border-border p-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                            Peso méd. (kg)
                          </th>
                          {isVendaAbate && (
                            <th className="w-40 border-b border-border p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                              Peso morto / Rend.
                            </th>
                          )}
                          {isComPreco && (
                            <th className="min-w-[240px] border-b border-border p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                              Preço
                            </th>
                          )}
                          {mostrarColunaSafra && (
                            <th className="w-32 border-b border-border p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                              Safra / Lote
                            </th>
                          )}
                          {mostrarSeletorProprietario && (
                            <th className="min-w-[180px] border-b border-border p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                              Proprietário
                            </th>
                          )}
                          <th className="w-28 border-b border-border p-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                            Peso total
                          </th>
                          <th className="w-8 border-b border-border p-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((linha, i) => {
                          const { pesoTotal: pesoTotalLinha, arrobaPorAnimal } = calcularLinha(linha)
                          const saldo = saldosLinhas[i]
                          const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : null
                          const catLinha = categorias.find((c) => c.id === linha.categoriaId)
                          const linhaEhBezerro = isNascimento || categoriaEhBezerro(catLinha)
                          return (
                            <tr key={i}>
                              <td className="border-b border-border p-2 align-top">
                                <select
                                  className={inputSmClass}
                                  value={linha.categoriaId}
                                  onChange={(e) => atualizarLinha(i, { categoriaId: e.target.value })}
                                >
                                  <option value="">Selecione...</option>
                                  {categoriasVisiveis.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.nome}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="border-b border-border p-2 align-top">
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  className={`text-right ${inputSmClass}`}
                                  value={linha.quantidade}
                                  onChange={(e) => atualizarLinha(i, { quantidade: e.target.value })}
                                />
                                {precisaChecarSaldo && linha.categoriaId && saldo != null && (
                                  <p className={`mt-1 text-[11px] ${quantidadeNum && quantidadeNum > saldo ? 'text-error' : 'text-text-secondary'}`}>
                                    {formatQuantidade(saldo)} disp.
                                  </p>
                                )}
                              </td>
                              <td className="border-b border-border p-2 align-top">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  className={`text-right ${inputSmClass}`}
                                  value={linha.pesoMedio}
                                  onChange={(e) => atualizarLinha(i, { pesoMedio: e.target.value })}
                                />
                              </td>
                              {isVendaAbate && (
                                <td className="border-b border-border p-2 align-top">
                                  <div className="flex gap-1">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      placeholder="Morto"
                                      className={`text-right ${inputSmClass}`}
                                      value={linha.pesoMorto}
                                      onChange={(e) => atualizarPesoMortoLinha(i, e.target.value)}
                                    />
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      placeholder="Rend. %"
                                      className={`text-right ${inputSmClass}`}
                                      value={linha.rendimentoCarcaca}
                                      onChange={(e) => atualizarRendimentoLinha(i, e.target.value)}
                                    />
                                  </div>
                                  {arrobaPorAnimal !== null && (
                                    <p className="mt-1 text-[11px] text-text-secondary">{formatDecimal(arrobaPorAnimal)} @/animal</p>
                                  )}
                                </td>
                              )}
                              {isComPreco && (
                                <td className="border-b border-border p-2 align-top">
                                  {/* select e input empilhados (não lado a lado) — combinar
                                      w-24 com inputSmClass (que já tem w-full embutido) no
                                      mesmo elemento fazia as duas classes de largura brigarem
                                      e o campo de valor quase sumia; empilhado, cada um usa a
                                      largura cheia da coluna sem conflito */}
                                  <div className="space-y-1">
                                    <select
                                      className={inputSmClass}
                                      value={linha.campoPreco}
                                      onChange={(e) => atualizarLinha(i, { campoPreco: e.target.value as CampoPreco })}
                                    >
                                      {CAMPOS_PRECO.map((c) => (
                                        <option key={c.key} value={c.key}>
                                          {c.label}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      className={inputSmClass}
                                      value={linha.valorPreco}
                                      onChange={(e) => atualizarLinha(i, { valorPreco: e.target.value })}
                                    />
                                  </div>
                                  {(() => {
                                    const valoresLinha = calcularValoresLinha(linha)
                                    return (
                                      <p className="mt-1 text-[11px] text-text-secondary">
                                        {CAMPOS_PRECO.filter((c) => c.key !== linha.campoPreco).map((c) => (
                                          <span key={c.key} className="mr-2 whitespace-nowrap">
                                            {CAMPOS_PRECO_CURTO[c.key]}: {formatDecimal(valoresLinha[c.key])}
                                          </span>
                                        ))}
                                      </p>
                                    )
                                  })()}
                                </td>
                              )}
                              {mostrarColunaSafra && (
                                <td className="border-b border-border p-2 align-top">
                                  {!linhaEhBezerro ? (
                                    <span className="text-xs text-text-muted">—</span>
                                  ) : isNascimento || tipo === 'COMPRA' ? (
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      className={inputSmClass}
                                      value={formatSafraInput(linha.safraNascimento || (data ? String(safraSugeridaParaData(data)) : ''))}
                                      onChange={(e) => atualizarLinha(i, { safraNascimento: extrairAnoSafraDigitado(e.target.value) })}
                                      onFocus={(e) => e.target.select()}
                                    />
                                  ) : (
                                    <select
                                      className={inputSmClass}
                                      value={linha.safraNascimento}
                                      onChange={(e) => atualizarLinha(i, { safraNascimento: e.target.value })}
                                    >
                                      <option value="">Selecione...</option>
                                      {(lotesDisponiveisLinhas[i] || []).map((l) => (
                                        <option key={l.safra} value={String(l.safra)}>
                                          {formatSafra(l.safra)} ({formatQuantidade(l.saldo)})
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                              )}
                              {mostrarSeletorProprietario && (
                                <td className="border-b border-border p-2 align-top">
                                  <select
                                    className={inputSmClass}
                                    value={linha.proprietarioId}
                                    onChange={(e) => atualizarLinha(i, { proprietarioId: e.target.value })}
                                  >
                                    <option value="">—</option>
                                    {proprietariosDisponiveis.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.nome}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              <td className="border-b border-border p-2 text-right align-top tabular-nums text-text-secondary">
                                {pesoTotalLinha !== null ? `${formatPeso(pesoTotalLinha)} kg` : '—'}
                              </td>
                              <td className="border-b border-border p-2 text-right align-top">
                                {linhas.length > 1 && (
                                  <button type="button" title="Remover" className="text-text-secondary hover:text-error" onClick={() => removerLinha(i)}>
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M6 6l12 12M18 6L6 18" />
                                    </svg>
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-dashed border-border px-3 py-2 text-xs font-semibold text-brand-500 hover:border-brand-500 hover:bg-brand-100"
                    onClick={adicionarLinha}
                  >
                    + Adicionar categoria
                  </button>
                  {isComPreco && !isComAjuste && (
                    <p className="mt-2 text-sm font-medium text-text-primary">Valor bruto total do lançamento: {formatMoeda(somaValorTotalLote)}</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* PASSO 4 — DETALHES ADICIONAIS */}
          <div className="mt-4 rounded-card border border-border bg-surface">
            <div className="flex items-start gap-3 border-b border-border p-5">
              <StepBadge n={4} />
              <div>
                <h3 className="text-sm font-bold text-text-primary">Detalhes adicionais</h3>
                <p className="mt-0.5 text-xs text-text-secondary">Campos que dependem do tipo escolhido, mais observação.</p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {precisaCliente && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">
                      Cliente / fornecedor
                      <Required />
                    </label>
                    <button type="button" className="text-xs font-medium text-brand-500 underline" onClick={() => setModalClienteAberto(true)}>
                      + Novo
                    </button>
                  </div>
                  <select
                    className={inputClass}
                    value={clienteFornecedorId}
                    onChange={(e) => setClienteFornecedorId(e.target.value)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {clientesFornecedores.map((cf) => (
                      <option key={cf.id} value={cf.id}>
                        {cf.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isMorte && (
                <div>
                  <label className={labelClass}>
                    Causa da morte
                    <Required />
                  </label>
                  <input className={inputClass} value={causaMorte} onChange={(e) => setCausaMorte(e.target.value)} required />
                </div>
              )}

              {isConsumoDoacao && (
                <div>
                  <label className={labelClass}>
                    Consumo interno ou doação
                    <Required />
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-sm text-text-primary">
                      <input
                        type="radio"
                        name="subtipoConsumoDoacao"
                        checked={subtipoConsumoDoacao === 'CONSUMO_INTERNO'}
                        onChange={() => setSubtipoConsumoDoacao('CONSUMO_INTERNO')}
                      />
                      Consumo interno
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-text-primary">
                      <input
                        type="radio"
                        name="subtipoConsumoDoacao"
                        checked={subtipoConsumoDoacao === 'DOACAO'}
                        onChange={() => setSubtipoConsumoDoacao('DOACAO')}
                      />
                      Doação
                    </label>
                  </div>
                </div>
              )}

              {isComPreco && !isLoteCategoria && (
                <div>
                  <label className={labelClass}>
                    Campo de preço informado
                    {isVendaAbate && <Required />}
                  </label>
                  <div className="mb-2 flex flex-wrap gap-3">
                    {CAMPOS_PRECO.map((c) => (
                      <label key={c.key} className="flex items-center gap-1.5 text-sm text-text-primary">
                        <input type="radio" name="campoPreco" checked={campoPreco === c.key} onChange={() => setCampoPreco(c.key)} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={inputClass}
                    value={valorPreco}
                    onChange={(e) => setValorPreco(e.target.value)}
                    placeholder={CAMPOS_PRECO.find((c) => c.key === campoPreco)?.label}
                    required={isVendaAbate}
                  />
                  <div className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                    {CAMPOS_PRECO.filter((c) => c.key !== campoPreco).map((c) => (
                      <p key={c.key}>
                        {c.label}: {formatDecimal(valoresCalculados[c.key])}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {isComAjuste && (
                <div className="rounded-control border border-border p-4">
                  <div>
                    <div className="mb-1.5 text-sm font-medium text-text-primary">
                      Descontos
                      {totalDescontos > 0 && <span className="font-normal text-text-secondary"> · {formatMoeda(totalDescontos)}</span>}
                    </div>
                    {descontos.length > 0 && (
                      <ul className="mb-2 space-y-1">
                        {descontos.map((d, i) => (
                          <li key={i} className="flex items-center justify-between rounded-control bg-bg px-2.5 py-1.5 text-sm">
                            <span className="text-text-primary">{d.itemNome}</span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums text-text-primary">{formatMoeda(d.valor)}</span>
                              <button type="button" className="text-xs text-error underline" onClick={() => removerAjuste('DESCONTO', i)}>
                                Remover
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <select
                        className={`flex-1 ${inputSmClass}`}
                        value={novoDescontoItemId}
                        onChange={(e) => setNovoDescontoItemId(e.target.value)}
                      >
                        <option value="">Selecione ou cadastre um item...</option>
                        {itensDesconto.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome}
                          </option>
                        ))}
                        <option value={NOVO_ITEM_AJUSTE}>+ Novo item...</option>
                      </select>
                      {novoDescontoItemId === NOVO_ITEM_AJUSTE && (
                        <input
                          className={`w-32 ${inputSmClass}`}
                          placeholder="Nome do item"
                          value={novoDescontoNomeCriar}
                          onChange={(e) => setNovoDescontoNomeCriar(e.target.value)}
                        />
                      )}
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0,00"
                        className={`w-24 ${inputSmClass}`}
                        value={novoDescontoValor}
                        onChange={(e) => setNovoDescontoValor(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={criandoAjusteDesconto}
                        className="whitespace-nowrap rounded-control border border-border px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
                        onClick={() => adicionarAjuste('DESCONTO')}
                      >
                        + Adicionar
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 text-sm font-medium text-text-primary">
                      Acréscimos
                      {totalAcrescimos > 0 && <span className="font-normal text-text-secondary"> · {formatMoeda(totalAcrescimos)}</span>}
                    </div>
                    {acrescimos.length > 0 && (
                      <ul className="mb-2 space-y-1">
                        {acrescimos.map((a, i) => (
                          <li key={i} className="flex items-center justify-between rounded-control bg-bg px-2.5 py-1.5 text-sm">
                            <span className="text-text-primary">{a.itemNome}</span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums text-text-primary">{formatMoeda(a.valor)}</span>
                              <button type="button" className="text-xs text-error underline" onClick={() => removerAjuste('ACRESCIMO', i)}>
                                Remover
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <select
                        className={`flex-1 ${inputSmClass}`}
                        value={novoAcrescimoItemId}
                        onChange={(e) => setNovoAcrescimoItemId(e.target.value)}
                      >
                        <option value="">Selecione ou cadastre um item...</option>
                        {itensAcrescimo.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome}
                          </option>
                        ))}
                        <option value={NOVO_ITEM_AJUSTE}>+ Novo item...</option>
                      </select>
                      {novoAcrescimoItemId === NOVO_ITEM_AJUSTE && (
                        <input
                          className={`w-32 ${inputSmClass}`}
                          placeholder="Nome do item"
                          value={novoAcrescimoNomeCriar}
                          onChange={(e) => setNovoAcrescimoNomeCriar(e.target.value)}
                        />
                      )}
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0,00"
                        className={`w-24 ${inputSmClass}`}
                        value={novoAcrescimoValor}
                        onChange={(e) => setNovoAcrescimoValor(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={criandoAjusteAcrescimo}
                        className="whitespace-nowrap rounded-control border border-border px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
                        onClick={() => adicionarAjuste('ACRESCIMO')}
                      >
                        + Adicionar
                      </button>
                    </div>
                  </div>

                  {valorBrutoPreviewAtual !== null && (
                    <div className="mt-4 space-y-0.5 border-t border-border pt-3 text-sm">
                      <div className="flex justify-between text-text-secondary">
                        <span>Valor bruto{isLoteCategoria ? ' (todas as categorias)' : ''}</span>
                        <span className="tabular-nums">{formatMoeda(valorBrutoPreviewAtual)}</span>
                      </div>
                      <div className="flex justify-between text-text-secondary">
                        <span>Descontos</span>
                        <span className="tabular-nums">− {formatMoeda(totalDescontos)}</span>
                      </div>
                      <div className="flex justify-between text-text-secondary">
                        <span>Acréscimos</span>
                        <span className="tabular-nums">+ {formatMoeda(totalAcrescimos)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-text-primary">
                        <span>Valor líquido</span>
                        <span className="tabular-nums">{formatMoeda(valorLiquidoPreviewAtual)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className={labelClass}>Observação</label>
                <textarea className={inputClass} value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border p-5">
              <button
                type="submit"
                disabled={salvando || bloqueadoPorSaldoInicial}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : editandoId ? 'Salvar edição' : 'Salvar movimentação'}
              </button>
              {editandoId && (
                <button type="button" className="rounded-control border border-border px-4 py-2 text-sm text-text-primary" onClick={cancelarEdicao}>
                  Cancelar edição
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
      </>
      )}

      {/* LISTAGEM */}
      <h2 className="mb-1 mt-8 text-lg font-extrabold text-text-primary">
        {filtroAtivo ? `Movimentações filtradas (${movimentacoes.length})` : 'Últimos lançamentos'}
      </h2>
      <p className="mb-4 text-xs text-text-secondary">
        Filtre por fazenda, tipo, categoria ou período pra achar um lançamento específico antes de editar.
      </p>

      <div className="rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem]">
            <label className={labelClass}>Fazenda</label>
            <select className={inputSmClass} value={filtroFazendaId} onChange={(e) => setFiltroFazendaId(e.target.value)}>
              <option value="">Todas</option>
              {fazendasFiltro.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[9rem]">
            <label className={labelClass}>Tipo</label>
            <select
              className={inputSmClass}
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as TipoMovimentacao | '')}
            >
              <option value="">Todos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {LABEL_TIPO[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[9rem]">
            <label className={labelClass}>Categoria</label>
            <select className={inputSmClass} value={filtroCategoriaId} onChange={(e) => setFiltroCategoriaId(e.target.value)}>
              <option value="">Todas</option>
              {categoriasFiltro.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[9rem]">
            <label className={labelClass}>De</label>
            <input type="date" max={hoje} className={inputSmClass} value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} />
          </div>
          <div className="min-w-[9rem]">
            <label className={labelClass}>Até</label>
            <input type="date" max={hoje} className={inputSmClass} value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} />
          </div>
          {filtroAtivo && (
            <button type="button" className="pb-2 text-xs font-medium text-brand-500 underline" onClick={limparFiltros}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          <div className="h-20 animate-pulse rounded-card bg-border" />
          <div className="h-20 animate-pulse rounded-card bg-border" />
        </div>
      ) : erro ? (
        <p className="mt-4 text-sm text-error">Erro: {erro}</p>
      ) : movimentacoes.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">
            {filtroAtivo ? 'Nenhuma movimentação encontrada com esse filtro' : 'Nenhuma movimentação lançada ainda'}
          </p>
          {!filtroAtivo && (
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              Lance a primeira movimentação acima para começar a acompanhar o rebanho.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {gruposMovimentacoes.map((grupo) => {
            if (grupo.movimentacoes.length === 1) {
              const m = grupo.movimentacoes[0]
              const cls = DIRECAO_CLASSES[DIRECAO_TIPO[m.tipo]]
              return (
                <div key={m.id} className="flex gap-3 rounded-card border border-border bg-surface p-4">
                  <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-control p-2 ${cls.bg} ${cls.fg}`}>
                    <IconeMovimentacao tipo={m.tipo} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-bold text-text-primary">{LABEL_TIPO[m.tipo]}</span>
                      <span className="text-xs text-text-secondary">{descreverMovimentacao(m)}</span>
                      <span className="ml-auto text-xs text-text-muted">{m.data}</span>
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">{detalhesMovimentacao(m)}</div>
                    {m.observacao && <div className="mt-1 text-xs italic text-text-muted">{m.observacao}</div>}
                  </div>
                  {confirmarExclusaoMovId === m.id ? (
                    <div className="flex flex-none flex-col items-end gap-1 self-start">
                      <span className="text-xs font-medium text-error">Excluir este lançamento?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={excluindo}
                          className="text-xs font-semibold text-error underline disabled:opacity-50"
                          onClick={() => excluirMovimentacao(m.id)}
                        >
                          {excluindo ? 'Excluindo...' : 'Sim, excluir'}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-text-secondary underline"
                          onClick={() => setConfirmarExclusaoMovId(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-none flex-col items-end gap-1 self-start">
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-500 underline"
                        onClick={() => (m.tipo === 'DESMAME' ? iniciarEdicaoDesmame([m]) : iniciarEdicao(m))}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-error underline"
                        onClick={() => setConfirmarExclusaoMovId(m.id)}
                      >
                        Excluir
                      </button>
                    </div>
                  )}
                </div>
              )
            }

            const primeira = grupo.movimentacoes[0]
            const somaQuantidade = grupo.movimentacoes.reduce((s, m) => s + m.quantidade, 0)
            const somaValorTotal = grupo.movimentacoes.reduce((s, m) => s + (m.valor_total || 0), 0)
            const somaLiquido = grupo.movimentacoes.reduce((s, m) => {
              const ajustes = m.movimentacao_ajustes || []
              const desconto = ajustes.filter((a) => a.item?.tipo === 'DESCONTO').reduce((ss, a) => ss + a.valor, 0)
              const acrescimo = ajustes.filter((a) => a.item?.tipo === 'ACRESCIMO').reduce((ss, a) => ss + a.valor, 0)
              return s + (m.valor_total != null ? m.valor_total - desconto + acrescimo : 0)
            }, 0)
            const cls = DIRECAO_CLASSES[DIRECAO_TIPO[primeira.tipo]]

            return (
              <div key={grupo.groupId} className="flex gap-3 rounded-card border border-border bg-surface p-4">
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-control p-2 ${cls.bg} ${cls.fg}`}>
                  <IconeMovimentacao tipo={primeira.tipo} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-bold text-text-primary">
                      {LABEL_TIPO[primeira.tipo]} · {grupo.movimentacoes.length} categorias
                    </span>
                    <span className="ml-auto text-xs text-text-muted">{primeira.data}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {primeira.tipo === 'TRANSFERENCIA'
                      ? `${primeira.fazenda_origem?.nome ?? '—'} → ${primeira.fazenda_destino?.nome ?? '—'}`
                      : (primeira.fazenda?.nome ?? '—')}
                    {primeira.cliente?.nome ? ` · ${primeira.cliente.nome}` : ''}
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {grupo.movimentacoes.map((m) => (
                      <li key={m.id} className="border-t border-border pt-1 text-xs text-text-secondary">
                        <span className="font-medium text-text-primary">{m.categoria?.nome ?? '—'}</span> — {detalhesMovimentacao(m, true)}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 text-xs font-semibold text-text-primary">
                    Total: {formatQuantidade(somaQuantidade)} cab.
                    {somaValorTotal > 0 ? ` · bruto ${formatMoeda(somaValorTotal)} · líquido ${formatMoeda(somaLiquido)}` : ''}
                  </div>
                  {primeira.observacao && <div className="mt-1 text-xs italic text-text-muted">{primeira.observacao}</div>}
                </div>
                {confirmarExclusaoGrupoId === grupo.groupId ? (
                  <div className="flex flex-none flex-col items-end gap-1 self-start">
                    <span className="text-xs font-medium text-error">Excluir as {grupo.movimentacoes.length} linhas?</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={excluindo}
                        className="text-xs font-semibold text-error underline disabled:opacity-50"
                        onClick={() => excluirGrupo(grupo.movimentacoes)}
                      >
                        {excluindo ? 'Excluindo...' : 'Sim, excluir'}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-text-secondary underline"
                        onClick={() => setConfirmarExclusaoGrupoId(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-none flex-col items-end gap-1 self-start">
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-500 underline"
                      onClick={() =>
                        primeira.tipo === 'DESMAME' ? iniciarEdicaoDesmame(grupo.movimentacoes) : iniciarEdicaoGrupo(grupo.movimentacoes)
                      }
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-error underline"
                      onClick={() => setConfirmarExclusaoGrupoId(grupo.groupId)}
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalClienteAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form onSubmit={handleCriarCliente} onKeyDown={bloquearEnvioPorEnter} className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">Novo cliente/fornecedor</h2>
            <div>
              <label className={labelClass}>
                Nome
                <Required />
              </label>
              <input className={inputClass} value={novoClienteNome} onChange={(e) => setNovoClienteNome(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className={labelClass}>Tipo</label>
              <select className={inputClass} value={novoClienteTipo} onChange={(e) => setNovoClienteTipo(e.target.value as TipoClienteFornecedor)}>
                <option value="CLIENTE">Cliente</option>
                <option value="FORNECEDOR">Fornecedor</option>
                <option value="AMBOS">Ambos</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Documento (CPF/CNPJ)</label>
              <input className={inputClass} value={novoClienteDocumento} onChange={(e) => setNovoClienteDocumento(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-control border border-border px-4 py-2 text-sm text-text-primary" onClick={() => setModalClienteAberto(false)}>
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoCliente}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvandoCliente ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {avisoEdicaoFutura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">Confirmar edição</h2>
            <p className="text-sm text-text-secondary">{avisoEdicaoFutura.mensagem}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-control border border-border px-4 py-2 text-sm text-text-primary" onClick={() => setAvisoEdicaoFutura(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                onClick={() => salvarEdicao(avisoEdicaoFutura.payload)}
              >
                {salvando ? 'Salvando...' : 'Confirmar edição'}
              </button>
            </div>
          </div>
        </div>
      )}

      {avisoEdicaoFuturaGrupo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">Confirmar edição</h2>
            <p className="text-sm text-text-secondary">{avisoEdicaoFuturaGrupo.mensagem}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-control border border-border px-4 py-2 text-sm text-text-primary" onClick={() => setAvisoEdicaoFuturaGrupo(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                onClick={() =>
                  finalizarSalvarLote(
                    avisoEdicaoFuturaGrupo.payloads,
                    avisoEdicaoFuturaGrupo.linhasComCalculo,
                    avisoEdicaoFuturaGrupo.idsAntigos
                  )
                }
              >
                {salvando ? 'Salvando...' : 'Confirmar edição'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ModuloGate>
  )
}
