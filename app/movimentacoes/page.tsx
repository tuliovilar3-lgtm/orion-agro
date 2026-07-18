'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatMoeda, formatQuantidade, formatPeso, formatDecimal } from '@/lib/format'
import { PAPEIS_BEZERRO_MAMANDO } from '@/lib/faixa-etaria'
import { safraSugeridaParaData, formatSafra, extrairAnoSafraDigitado, formatSafraInput } from '@/lib/periodo'

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

function round2(n: number) {
  return Math.round(n * 100) / 100
}

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

  const [modalClienteAberto, setModalClienteAberto] = useState(false)
  const [novoClienteNome, setNovoClienteNome] = useState('')
  const [novoClienteTipo, setNovoClienteTipo] = useState<TipoClienteFornecedor>('AMBOS')
  const [novoClienteDocumento, setNovoClienteDocumento] = useState('')
  const [salvandoCliente, setSalvandoCliente] = useState(false)

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

  // pasto: seletor só aparece quando o grupo usa controle por pasto e a
  // fazenda tem mais de um pasto ativo — caso contrário o pasto "Geral"
  // é preenchido sozinho (ver useEffects abaixo)
  const fazendaOrigemParaPasto = isTransferencia ? fazendaOrigemId : fazendaId
  const pastosOrigemDisponiveis = pastos.filter((p) => p.modulo?.fazenda_id === fazendaOrigemParaPasto)
  const mostrarSeletorPastoOrigem = controlaPasto && pastosOrigemDisponiveis.length > 1

  const pastosDestinoDisponiveis = pastos.filter((p) => p.modulo?.fazenda_id === fazendaDestinoId)
  const mostrarSeletorPastoDestino = isTransferencia && controlaPasto && pastosDestinoDisponiveis.length > 1

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

  // pasto de origem: some pro "Geral" sozinho quando o seletor está
  // escondido (grupo sem controla_pasto, ou só um pasto ativo)
  useEffect(() => {
    if (!fazendaOrigemParaPasto) {
      setPastoId('')
      return
    }
    if (!mostrarSeletorPastoOrigem) {
      const geral = pastosOrigemDisponiveis.find((p) => p.nome === 'Geral') || pastosOrigemDisponiveis[0]
      setPastoId(geral ? geral.id : '')
    } else if (!pastosOrigemDisponiveis.some((p) => p.id === pastoId)) {
      setPastoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaOrigemParaPasto, mostrarSeletorPastoOrigem, pastos])

  // pasto de destino em TRANSFERENCIA (na fazenda de destino) — mesmo
  // princípio do de origem.
  useEffect(() => {
    if (!isTransferencia) return
    if (!fazendaDestinoId) {
      setPastoDestinoId('')
      return
    }
    if (!mostrarSeletorPastoDestino) {
      const geral = pastosDestinoDisponiveis.find((p) => p.nome === 'Geral') || pastosDestinoDisponiveis[0]
      setPastoDestinoId(geral ? geral.id : '')
    } else if (!pastosDestinoDisponiveis.some((p) => p.id === pastoDestinoId)) {
      setPastoDestinoId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransferencia, fazendaDestinoId, mostrarSeletorPastoDestino, pastos])

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
    const [{ data: f }, { data: c }, { data: p }, { data: cf }, { data: cfg }, { data: ia }, { data: fFiltro }, { data: cFiltro }] =
      await Promise.all([
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
        supabase.from('clientes_fornecedores').select('id, nome').eq('ativo', true).order('nome'),
        supabase.from('configuracoes').select('controla_pasto').single(),
        supabase.from('itens_ajuste_financeiro').select('id, nome, tipo').order('nome'),
        // sem filtro de ativo/ativa — o filtro da listagem precisa achar
        // lançamentos antigos mesmo que a fazenda/categoria tenha sido
        // inativada depois
        supabase.from('fazendas').select('id, nome').order('nome'),
        supabase.from('categorias_animal').select('id, nome').order('nome'),
      ])
    setFazendas(f || [])
    setCategorias((c as unknown as Categoria[]) || [])
    setPastos((p as unknown as Pasto[]) || [])
    setClientesFornecedores(cf || [])
    setControlaPasto(cfg?.controla_pasto ?? false)
    setItensAjuste((ia as unknown as ItemAjuste[]) || [])
    setFazendasFiltro(fFiltro || [])
    setCategoriasFiltro(cFiltro || [])
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
        causa_morte, subtipo_consumo_doacao, safra_nascimento_ano_inicio, observacao, grupo_lancamento_id,
        fazenda_id, fazenda_origem_id, fazenda_destino_id,
        categoria_id, categoria_destino_id, pasto_id, pasto_destino_id, cliente_fornecedor_id,
        fazenda:fazendas!fazenda_id(nome),
        fazenda_origem:fazendas!fazenda_origem_id(nome),
        fazenda_destino:fazendas!fazenda_destino_id(nome),
        categoria:categorias_animal!categoria_id(nome),
        categoria_destino:categorias_animal!categoria_destino_id(nome),
        pasto:pastos!pasto_id(nome),
        pasto_destino:pastos!pasto_destino_id(nome),
        cliente:clientes_fornecedores!cliente_fornecedor_id(nome),
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
    setPastoDestinoId(m.pasto_destino_id || '')
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
    setPastoDestinoId(primeira.pasto_destino_id || '')
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
    setObservacao(primeira.observacao || '')
    setLinhasDesmame(
      rows.map((r) => ({
        safraNascimento: r.safra_nascimento_ano_inicio != null ? String(r.safra_nascimento_ano_inicio) : '',
        quantidade: String(r.quantidade),
        pesoMedio: r.peso_medio_kg != null ? String(r.peso_medio_kg) : '',
      }))
    )
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() {
    setEditandoId(null)
    setEditandoGrupoId(null)
    setEditandoGrupoLinhasOriginais([])
    limparFormulario()
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
      .from('clientes_fornecedores')
      .insert({
        nome: novoClienteNome.trim(),
        tipo: novoClienteTipo,
        documento: novoClienteDocumento.trim() || null,
      })
      .select('id, nome')
      .single()

    if (error) {
      alert('Erro ao salvar: ' + error.message)
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
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Movimentações de rebanho</h1>

      <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mb-8 space-y-3 border p-4 rounded">
        <h2 className="font-semibold">{editandoId ? 'Editar movimentação' : 'Nova movimentação'}</h2>

        <div>
          <label className="block text-sm mb-1">Tipo</label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoMovimentacao)}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">
            Data
            <Required />
          </label>
          <input
            type="date"
            max={hoje}
            className="border rounded px-3 py-2 w-full"
            value={data}
            onChange={(e) => setData(e.target.value)}
            required
          />
        </div>

        {!isTransferencia && (
          <div>
            <label className="block text-sm mb-1">
              Fazenda
              <Required />
            </label>
            <select
              className="border rounded px-3 py-2 w-full"
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
        )}

        {isTransferencia && (
          <>
            <div>
              <label className="block text-sm mb-1">
                Fazenda origem
                <Required />
              </label>
              <select
                className="border rounded px-3 py-2 w-full"
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
            </div>
            <div>
              <label className="block text-sm mb-1">
                Fazenda destino
                <Required />
              </label>
              <select
                className="border rounded px-3 py-2 w-full"
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
          </>
        )}

        {mostrarSeletorPastoOrigem && (
          <div>
            <label className="block text-sm mb-1">
              Pasto
              <Required />
            </label>
            <select
              className="border rounded px-3 py-2 w-full"
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
        )}

        {mostrarSeletorPastoDestino && (
          <div>
            <label className="block text-sm mb-1">
              Pasto destino (fazenda destino)
              <Required />
            </label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={pastoDestinoId}
              onChange={(e) => setPastoDestinoId(e.target.value)}
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
        )}

        {bloqueadoPorSaldoInicial && (
          <div className="border border-red-400 bg-red-50 rounded p-3 text-sm text-red-800">
            {fazendasSemSaldoInicial.length === 1
              ? `A fazenda "${fazendasSemSaldoInicial[0].nome}" ainda não teve o saldo inicial preenchido e confirmado.`
              : `As fazendas ${fazendasSemSaldoInicial.map((f) => `"${f.nome}"`).join(' e ')} ainda não tiveram o saldo inicial preenchido e confirmado.`}{' '}
            Isso precisa ser feito antes de lançar qualquer outra movimentação.{' '}
            <a href="/saldo-inicial" className="underline font-medium">
              Ir para saldo inicial
            </a>
          </div>
        )}

        {isDesmame ? (
        <>
        <div>
          <label className="block text-sm mb-1">
            Categoria (bezerro a desmamar)
            <Required />
          </label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            required
          >
            <option value="">Selecione...</option>
            {categoriasVisiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">
            Categoria destino (após desmame)
            <Required />
          </label>
          <select
            className="border rounded px-3 py-2 w-full"
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
            <p className="text-xs text-gray-500 mt-1">Selecione a categoria de origem primeiro.</p>
          )}
        </div>

        <div className="border rounded p-3 space-y-3">
          <div className="text-sm font-medium">
            Lotes desmamados (por safra de nascimento)
            <Required />
          </div>
          {linhasDesmame.map((linha, i) => {
            return (
              <div key={i} className="border rounded p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Linha {i + 1}</span>
                  {linhasDesmame.length > 1 && (
                    <button
                      type="button"
                      className="text-red-600 text-xs underline"
                      onClick={() => removerLinhaDesmame(i)}
                    >
                      Remover
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-xs mb-1">
                    Lote (safra de nascimento)
                    <Required />
                  </label>
                  <select
                    className="border rounded px-2 py-1 w-full text-sm"
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs mb-1">
                      Quantidade
                      <Required />
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="border rounded px-2 py-1 w-full text-sm"
                      value={linha.quantidade}
                      onChange={(e) => atualizarLinhaDesmame(i, { quantidade: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1">
                      Peso médio (kg)
                      <Required />
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="border rounded px-2 py-1 w-full text-sm"
                      value={linha.pesoMedio}
                      onChange={(e) => atualizarLinhaDesmame(i, { pesoMedio: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )
          })}
          <button type="button" className="text-sm text-blue-600 underline" onClick={adicionarLinhaDesmame}>
            + Adicionar lote
          </button>
        </div>
        </>
        ) : !isLoteCategoria ? (
        <>
        <div>
          <label className="block text-sm mb-1">
            {isMudancaCategoria ? 'Categoria origem' : 'Categoria'}
            <Required />
          </label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            required
          >
            <option value="">Selecione...</option>
            {categoriasVisiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        {isMudancaCategoria && (
          <div>
            <label className="block text-sm mb-1">
              Categoria destino
              <Required />
            </label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={categoriaDestinoId}
              onChange={(e) => setCategoriaDestinoId(e.target.value)}
              required
            >
              <option value="">Selecione...</option>
              {categorias.filter((c) => !categoriaEhBezerro(c)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {mudancaEntreSexosDiferentes && (
          <div className="border border-yellow-400 bg-yellow-50 rounded p-3 text-sm">
            <p className="text-yellow-800">
              Atenção: essa mudança é de <strong>{categoriaOrigemSelecionada?.sexo}</strong> para{' '}
              <strong>{categoriaDestinoSelecionada?.sexo}</strong>. Isso normalmente não deveria acontecer —
              confirme só se for um ajuste de estoque intencional.
            </p>
            <label className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={confirmarMudancaSexo}
                onChange={(e) => setConfirmarMudancaSexo(e.target.checked)}
              />
              Confirmo que é uma mudança entre sexos diferentes (ajuste de estoque)
            </label>
          </div>
        )}

        <div>
          <label className="block text-sm mb-1">
            Quantidade
            <Required />
          </label>
          <input
            type="number"
            min="1"
            step="1"
            className="border rounded px-3 py-2 w-full"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            required
          />
          {precisaChecarSaldo && fazendaParaSaldo && categoriaId && data && (
            <p
              className={`text-xs mt-1 ${
                saldoDisponivel !== null && quantidade && parseInt(quantidade, 10) > saldoDisponivel
                  ? 'text-red-600'
                  : 'text-gray-500'
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
              className={`text-xs mt-1 ${
                saldoPastoDisponivel !== null && quantidade && parseInt(quantidade, 10) > saldoPastoDisponivel
                  ? 'text-red-600'
                  : 'text-gray-500'
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
          <div>
            <label className="block text-sm mb-1">
              Peso médio (kg)
              <Required />
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="border rounded px-3 py-2 w-full"
              value={pesoMedio}
              onChange={(e) => setPesoMedio(e.target.value)}
              required
            />
            {isComPreco && (
              <p className="text-xs text-gray-500 mt-1">
                Peso total (calculado): {pesoTotalCalculado !== null ? `${formatPeso(pesoTotalCalculado)} kg` : '—'}
              </p>
            )}
          </div>
        )}

        {mostrarCamposLoteSingular &&
          (isNascimento || tipo === 'COMPRA' ? (
            <div>
              <label className="block text-sm mb-1">
                Safra do bezerro
                <Required />
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="border rounded px-3 py-2 w-full"
                value={formatSafraInput(safraNascimento || (data ? String(safraSugeridaParaData(data)) : ''))}
                onChange={(e) => setSafraNascimento(extrairAnoSafraDigitado(e.target.value))}
                onFocus={(e) => e.target.select()}
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm mb-1">
                Lote de nascimento (safra)
                <Required />
              </label>
              <select
                className="border rounded px-3 py-2 w-full"
                value={safraNascimento}
                onChange={(e) => setSafraNascimento(e.target.value)}
              >
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
          <div>
            <label className="block text-sm mb-1">
              Peso morto (kg) ou rendimento de carcaça (%) — por animal
              <Required />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Peso morto (kg)"
                className="border rounded px-3 py-2 w-full"
                value={pesoMorto}
                onChange={(e) => handlePesoMortoChange(e.target.value)}
              />
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Rendimento (%)"
                className="border rounded px-3 py-2 w-full"
                value={rendimentoCarcaca}
                onChange={(e) => handleRendimentoChange(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Preencha um dos dois — o outro é calculado automaticamente.
              {arrobaPorAnimalPreview !== null && ` Peso em arrobas: ${formatDecimal(arrobaPorAnimalPreview)} @/animal.`}
            </p>
          </div>
        )}

        </>
        ) : (
        <div className="border rounded p-3 space-y-3">
          <div className="text-sm font-medium">
            Categorias
            <Required />
          </div>
          {linhas.map((linha, i) => {
            const { pesoTotal: pesoTotalLinha, arrobaPorAnimal, valorTotal: valorTotalLinha } = calcularLinha(linha)
            const saldo = saldosLinhas[i]
            const quantidadeNum = linha.quantidade ? parseInt(linha.quantidade, 10) : null
            return (
              <div key={i} className="border rounded p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Linha {i + 1}</span>
                  {linhas.length > 1 && (
                    <button type="button" className="text-red-600 text-xs underline" onClick={() => removerLinha(i)}>
                      Remover
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs mb-1">
                      Categoria
                      <Required />
                    </label>
                    <select
                      className="border rounded px-2 py-1 w-full text-sm"
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
                  </div>
                  <div>
                    <label className="block text-xs mb-1">
                      Quantidade
                      <Required />
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="border rounded px-2 py-1 w-full text-sm"
                      value={linha.quantidade}
                      onChange={(e) => atualizarLinha(i, { quantidade: e.target.value })}
                    />
                    {precisaChecarSaldo && linha.categoriaId && (
                      <p
                        className={`text-xs mt-1 ${
                          saldo != null && quantidadeNum && quantidadeNum > saldo ? 'text-red-600' : 'text-gray-500'
                        }`}
                      >
                        {saldo != null
                          ? `Saldo: ${formatQuantidade(saldo)} cabeça(s)${
                              quantidadeNum && quantidadeNum > saldo ? ' — saldo indisponível para a data' : ''
                            }`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
                {mostrarPesoLinha && (
                  <div>
                    <label className="block text-xs mb-1">
                      Peso médio (kg)
                      <Required />
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="border rounded px-2 py-1 w-full text-sm"
                      value={linha.pesoMedio}
                      onChange={(e) => atualizarLinha(i, { pesoMedio: e.target.value })}
                    />
                  </div>
                )}
                {(() => {
                  const catLinha = categorias.find((c) => c.id === linha.categoriaId)
                  const linhaEhBezerro = isNascimento || categoriaEhBezerro(catLinha)
                  if (!linhaEhBezerro) return null
                  if (isNascimento || tipo === 'COMPRA') {
                    return (
                      <div>
                        <label className="block text-xs mb-1">
                          Safra do bezerro
                          <Required />
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="border rounded px-2 py-1 w-full text-sm"
                          value={formatSafraInput(linha.safraNascimento || (data ? String(safraSugeridaParaData(data)) : ''))}
                          onChange={(e) => atualizarLinha(i, { safraNascimento: extrairAnoSafraDigitado(e.target.value) })}
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                    )
                  }
                  const lotesLinha = lotesDisponiveisLinhas[i] || []
                  return (
                    <div>
                      <label className="block text-xs mb-1">
                        Lote de nascimento (safra)
                        <Required />
                      </label>
                      <select
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={linha.safraNascimento}
                        onChange={(e) => atualizarLinha(i, { safraNascimento: e.target.value })}
                      >
                        <option value="">Selecione...</option>
                        {lotesLinha.map((l) => (
                          <option key={l.safra} value={String(l.safra)}>
                            Safra {formatSafra(l.safra)} ({formatQuantidade(l.saldo)} disponível)
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })()}
                {isVendaAbate && (
                  <div>
                    <label className="block text-xs mb-1">
                      Peso morto (kg) ou rendimento (%) — por animal
                      <Required />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Peso morto (kg)"
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={linha.pesoMorto}
                        onChange={(e) => atualizarPesoMortoLinha(i, e.target.value)}
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Rendimento (%)"
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={linha.rendimentoCarcaca}
                        onChange={(e) => atualizarRendimentoLinha(i, e.target.value)}
                      />
                    </div>
                    {arrobaPorAnimal !== null && (
                      <p className="text-xs text-gray-500 mt-1">Peso em arrobas: {formatDecimal(arrobaPorAnimal)} @/animal</p>
                    )}
                  </div>
                )}
                {isComPreco && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs mb-1">Preço informado como</label>
                      <select
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={linha.campoPreco}
                        onChange={(e) => atualizarLinha(i, { campoPreco: e.target.value as CampoPreco })}
                      >
                        {CAMPOS_PRECO.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1">
                        Valor
                        {isVendaAbate && <Required />}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={linha.valorPreco}
                        onChange={(e) => atualizarLinha(i, { valorPreco: e.target.value })}
                      />
                    </div>
                    <p className="text-xs text-gray-500 col-span-2">
                      Valor total (bruto) dessa categoria: {formatMoeda(valorTotalLinha)}
                      {pesoTotalLinha !== null && ` · Peso total: ${formatPeso(pesoTotalLinha)} kg`}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
          <button type="button" className="text-sm text-blue-600 underline" onClick={adicionarLinha}>
            + Adicionar categoria
          </button>
          {isComPreco && !isComAjuste && (
            <p className="text-sm font-medium">Valor bruto total do lançamento: {formatMoeda(somaValorTotalLote)}</p>
          )}
        </div>
        )}

        {precisaCliente && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm">
                Cliente / fornecedor
                <Required />
              </label>
              <button
                type="button"
                className="text-xs text-blue-600 underline"
                onClick={() => setModalClienteAberto(true)}
              >
                + Novo
              </button>
            </div>
            <select
              className="border rounded px-3 py-2 w-full"
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
            <label className="block text-sm mb-1">
              Causa da morte
              <Required />
            </label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={causaMorte}
              onChange={(e) => setCausaMorte(e.target.value)}
              required
            />
          </div>
        )}

        {isConsumoDoacao && (
          <div>
            <label className="block text-sm mb-1">
              Consumo interno ou doação
              <Required />
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="subtipoConsumoDoacao"
                  checked={subtipoConsumoDoacao === 'CONSUMO_INTERNO'}
                  onChange={() => setSubtipoConsumoDoacao('CONSUMO_INTERNO')}
                />
                Consumo interno
              </label>
              <label className="flex items-center gap-1 text-sm">
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
            <label className="block text-sm mb-1">
              Campo de preço informado
              {isVendaAbate && <Required />}
            </label>
            <div className="flex flex-wrap gap-3 mb-2">
              {CAMPOS_PRECO.map((c) => (
                <label key={c.key} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="campoPreco"
                    checked={campoPreco === c.key}
                    onChange={() => setCampoPreco(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="border rounded px-3 py-2 w-full"
              value={valorPreco}
              onChange={(e) => setValorPreco(e.target.value)}
              placeholder={CAMPOS_PRECO.find((c) => c.key === campoPreco)?.label}
              required={isVendaAbate}
            />
            <div className="text-xs text-gray-500 mt-1 space-y-0.5">
              {CAMPOS_PRECO.filter((c) => c.key !== campoPreco).map((c) => (
                <p key={c.key}>
                  {c.label}: {formatDecimal(valoresCalculados[c.key])}
                </p>
              ))}
            </div>
          </div>
        )}

        {isComAjuste && (
          <div className="border rounded p-3 space-y-3">
            <div>
              <div className="text-sm font-medium mb-1">
                Descontos
                {totalDescontos > 0 && <span className="text-gray-500 font-normal"> · {formatMoeda(totalDescontos)}</span>}
              </div>
              {descontos.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {descontos.map((d, i) => (
                    <li key={i} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1 text-sm">
                      <span>{d.itemNome}</span>
                      <span className="flex items-center gap-2">
                        <span>{formatMoeda(d.valor)}</span>
                        <button
                          type="button"
                          className="text-red-600 text-xs underline"
                          onClick={() => removerAjuste('DESCONTO', i)}
                        >
                          Remover
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm flex-1"
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
                    className="border rounded px-2 py-1 text-sm w-32"
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
                  className="border rounded px-2 py-1 text-sm w-24"
                  value={novoDescontoValor}
                  onChange={(e) => setNovoDescontoValor(e.target.value)}
                />
                <button
                  type="button"
                  disabled={criandoAjusteDesconto}
                  className="border rounded px-3 py-1 text-sm whitespace-nowrap disabled:opacity-50"
                  onClick={() => adicionarAjuste('DESCONTO')}
                >
                  + Adicionar
                </button>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">
                Acréscimos
                {totalAcrescimos > 0 && <span className="text-gray-500 font-normal"> · {formatMoeda(totalAcrescimos)}</span>}
              </div>
              {acrescimos.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {acrescimos.map((a, i) => (
                    <li key={i} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1 text-sm">
                      <span>{a.itemNome}</span>
                      <span className="flex items-center gap-2">
                        <span>{formatMoeda(a.valor)}</span>
                        <button
                          type="button"
                          className="text-red-600 text-xs underline"
                          onClick={() => removerAjuste('ACRESCIMO', i)}
                        >
                          Remover
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm flex-1"
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
                    className="border rounded px-2 py-1 text-sm w-32"
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
                  className="border rounded px-2 py-1 text-sm w-24"
                  value={novoAcrescimoValor}
                  onChange={(e) => setNovoAcrescimoValor(e.target.value)}
                />
                <button
                  type="button"
                  disabled={criandoAjusteAcrescimo}
                  className="border rounded px-3 py-1 text-sm whitespace-nowrap disabled:opacity-50"
                  onClick={() => adicionarAjuste('ACRESCIMO')}
                >
                  + Adicionar
                </button>
              </div>
            </div>

            {valorBrutoPreviewAtual !== null && (
              <div className="border-t pt-2 text-sm space-y-0.5">
                <div className="flex justify-between text-gray-600">
                  <span>Valor bruto{isLoteCategoria ? ' (todas as categorias)' : ''}</span>
                  <span>{formatMoeda(valorBrutoPreviewAtual)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Descontos</span>
                  <span>− {formatMoeda(totalDescontos)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Acréscimos</span>
                  <span>+ {formatMoeda(totalAcrescimos)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Valor líquido</span>
                  <span>{formatMoeda(valorLiquidoPreviewAtual)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm mb-1">Observação</label>
          <textarea
            className="border rounded px-3 py-2 w-full"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={salvando || bloqueadoPorSaldoInicial}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : editandoId ? 'Salvar edição' : 'Salvar movimentação'}
          </button>
          {editandoId && (
            <button type="button" className="px-4 py-2 rounded border" onClick={cancelarEdicao}>
              Cancelar edição
            </button>
          )}
        </div>
      </form>

      <div className="mb-4 flex flex-wrap items-end gap-3 border rounded p-4">
        <div>
          <label className="block text-sm mb-1">Fazenda</label>
          <select
            className="border rounded px-3 py-2"
            value={filtroFazendaId}
            onChange={(e) => setFiltroFazendaId(e.target.value)}
          >
            <option value="">Todas</option>
            {fazendasFiltro.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Tipo</label>
          <select
            className="border rounded px-3 py-2"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as TipoMovimentacao | '')}
          >
            <option value="">Todos</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Categoria</label>
          <select
            className="border rounded px-3 py-2"
            value={filtroCategoriaId}
            onChange={(e) => setFiltroCategoriaId(e.target.value)}
          >
            <option value="">Todas</option>
            {categoriasFiltro.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">De</label>
          <input
            type="date"
            max={hoje}
            className="border rounded px-3 py-2"
            value={filtroDataInicio}
            onChange={(e) => setFiltroDataInicio(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Até</label>
          <input
            type="date"
            max={hoje}
            className="border rounded px-3 py-2"
            value={filtroDataFim}
            onChange={(e) => setFiltroDataFim(e.target.value)}
          />
        </div>
        {filtroAtivo && (
          <button type="button" className="text-xs text-blue-600 underline" onClick={limparFiltros}>
            Limpar filtros
          </button>
        )}
      </div>

      <h2 className="font-semibold mb-3">
        {filtroAtivo ? `Movimentações filtradas (${movimentacoes.length})` : 'Últimas movimentações'}
      </h2>
      {loading ? (
        <p>Carregando...</p>
      ) : erro ? (
        <p className="text-red-600">Erro: {erro}</p>
      ) : movimentacoes.length === 0 ? (
        <p>{filtroAtivo ? 'Nenhuma movimentação encontrada com esse filtro.' : 'Nenhuma movimentação lançada ainda.'}</p>
      ) : (
        <ul className="space-y-2">
          {gruposMovimentacoes.map((grupo) => {
            if (grupo.movimentacoes.length === 1) {
              const m = grupo.movimentacoes[0]
              return (
                <li key={m.id} className="border p-3 rounded">
                  <div className="flex justify-between items-start">
                    <strong>{m.tipo}</strong>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">{m.data}</span>
                      <button
                        type="button"
                        className="text-xs text-blue-600 underline"
                        onClick={() => (m.tipo === 'DESMAME' ? iniciarEdicaoDesmame([m]) : iniciarEdicao(m))}
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                  <div>{descreverMovimentacao(m)}</div>
                  <div className="text-sm text-gray-600">{detalhesMovimentacao(m)}</div>
                  {m.observacao && <div className="text-sm text-gray-500 italic">{m.observacao}</div>}
                </li>
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

            return (
              <li key={grupo.groupId} className="border p-3 rounded">
                <div className="flex justify-between items-start">
                  <strong>
                    {primeira.tipo} · {grupo.movimentacoes.length} categorias
                  </strong>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">{primeira.data}</span>
                    <button
                      type="button"
                      className="text-xs text-blue-600 underline"
                      onClick={() =>
                        primeira.tipo === 'DESMAME'
                          ? iniciarEdicaoDesmame(grupo.movimentacoes)
                          : iniciarEdicaoGrupo(grupo.movimentacoes)
                      }
                    >
                      Editar
                    </button>
                  </div>
                </div>
                <div>
                  {primeira.tipo === 'TRANSFERENCIA'
                    ? `${primeira.fazenda_origem?.nome ?? '—'} → ${primeira.fazenda_destino?.nome ?? '—'}`
                    : (primeira.fazenda?.nome ?? '—')}
                  {primeira.cliente?.nome ? ` · ${primeira.cliente.nome}` : ''}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {grupo.movimentacoes.map((m) => (
                    <li key={m.id} className="text-sm text-gray-600 border-t pt-1">
                      <span className="font-medium text-black">{m.categoria?.nome ?? '—'}</span> —{' '}
                      {detalhesMovimentacao(m, true)}
                    </li>
                  ))}
                </ul>
                <div className="text-sm font-medium mt-1.5">
                  Total: {formatQuantidade(somaQuantidade)} cab.
                  {somaValorTotal > 0 ? ` · bruto ${formatMoeda(somaValorTotal)} · líquido ${formatMoeda(somaLiquido)}` : ''}
                </div>
                {primeira.observacao && <div className="text-sm text-gray-500 italic">{primeira.observacao}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {modalClienteAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
            onSubmit={handleCriarCliente}
            onKeyDown={bloquearEnvioPorEnter}
            className="bg-white p-4 rounded w-full max-w-sm space-y-3"
          >
            <h2 className="font-semibold">Novo cliente/fornecedor</h2>
            <div>
              <label className="block text-sm mb-1">
                Nome
                <Required />
              </label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={novoClienteNome}
                onChange={(e) => setNovoClienteNome(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Tipo</label>
              <select
                className="border rounded px-3 py-2 w-full"
                value={novoClienteTipo}
                onChange={(e) => setNovoClienteTipo(e.target.value as TipoClienteFornecedor)}
              >
                <option value="CLIENTE">Cliente</option>
                <option value="FORNECEDOR">Fornecedor</option>
                <option value="AMBOS">Ambos</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Documento (CPF/CNPJ)</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={novoClienteDocumento}
                onChange={(e) => setNovoClienteDocumento(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 rounded border" onClick={() => setModalClienteAberto(false)}>
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoCliente}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {salvandoCliente ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {avisoEdicaoFutura && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded w-full max-w-sm space-y-3">
            <h2 className="font-semibold">Confirmar edição</h2>
            <p className="text-sm text-gray-700">{avisoEdicaoFutura.mensagem}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={() => setAvisoEdicaoFutura(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
                onClick={() => salvarEdicao(avisoEdicaoFutura.payload)}
              >
                {salvando ? 'Salvando...' : 'Confirmar edição'}
              </button>
            </div>
          </div>
        </div>
      )}

      {avisoEdicaoFuturaGrupo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded w-full max-w-sm space-y-3">
            <h2 className="font-semibold">Confirmar edição</h2>
            <p className="text-sm text-gray-700">{avisoEdicaoFuturaGrupo.mensagem}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={() => setAvisoEdicaoFuturaGrupo(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
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
  )
}
