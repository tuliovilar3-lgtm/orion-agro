'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatQuantidade } from '@/lib/format'
import { anoInicioSafraAtual, anoCalendarioAtual, opcoesSafra, opcoesAno } from '@/lib/periodo'
import { useFiltroGlobal } from '@/contexts/FiltroGlobalContext'
import ModuloGate from '@/components/ModuloGate'
import FiltroMultiSelect from '@/components/relatorios/FiltroMultiSelect'
import PainelFiltroColapsavel from '@/components/relatorios/PainelFiltroColapsavel'
import { type TipoMovimentacao, IconeMovimentacao } from '@/lib/movimentacao-icones'

type RelatorioLinha = {
  categoria_id: string
  categoria_nome: string
  estoque_inicial: number
  entrada_nascimento: number
  entrada_compra: number
  entrada_desmame: number
  entrada_transferencia: number
  entrada_mudanca_categoria: number
  saida_morte: number
  saida_venda: number
  saida_desmame: number
  saida_transferencia: number
  saida_consumo_doacao: number
  saida_mudanca_categoria: number
  estoque_final: number
}

// cada coluna sabe seu próprio ícone de tipo de movimentação (mora no
// cabeçalho, colorido por entrada/saída — nunca repetido dentro de cada
// célula) e, quando faz sentido, pra qual aba de Relatórios de
// Movimentações um número dessa coluna deveria linkar. `tipoRelatorio`
// ausente com `linkavel: true` (só a coluna Venda) ainda linka pra
// Relatórios filtrado por categoria, sem forçar uma aba — Venda em Pé e
// Venda Abate vêm somadas nessa coluna, sem tipo único pra escolher.
// Mudança de Categoria não tem aba própria em Relatórios (a mudança em si
// não é elencada lá), então não é clicável.
type ColunaMovimentacao = {
  key: keyof RelatorioLinha
  label: string
  icone: TipoMovimentacao
  linkavel: boolean
  tipoRelatorio?: string
}

const COLUNAS_ENTRADA: ColunaMovimentacao[] = [
  { key: 'entrada_nascimento', label: 'Nasc.', icone: 'NASCIMENTO', linkavel: true, tipoRelatorio: 'NASCIMENTO' },
  { key: 'entrada_compra', label: 'Compra', icone: 'COMPRA', linkavel: true, tipoRelatorio: 'COMPRA' },
  { key: 'entrada_desmame', label: 'Desmame', icone: 'DESMAME', linkavel: true, tipoRelatorio: 'DESMAME' },
  { key: 'entrada_transferencia', label: 'Transf.', icone: 'TRANSFERENCIA', linkavel: true, tipoRelatorio: 'TRANSFERENCIA' },
  { key: 'entrada_mudanca_categoria', label: 'Categ.', icone: 'MUDANCA_CATEGORIA', linkavel: false },
]

const COLUNAS_SAIDA: ColunaMovimentacao[] = [
  { key: 'saida_morte', label: 'Morte', icone: 'MORTE', linkavel: true, tipoRelatorio: 'MORTE' },
  { key: 'saida_venda', label: 'Venda', icone: 'VENDA_PE', linkavel: true },
  { key: 'saida_desmame', label: 'Desmame', icone: 'DESMAME', linkavel: true, tipoRelatorio: 'DESMAME' },
  { key: 'saida_transferencia', label: 'Transf.', icone: 'TRANSFERENCIA', linkavel: true, tipoRelatorio: 'TRANSFERENCIA' },
  { key: 'saida_consumo_doacao', label: 'Cons/Doaç', icone: 'CONSUMO_DOACAO', linkavel: true, tipoRelatorio: 'CONSUMO_DOACAO' },
  { key: 'saida_mudanca_categoria', label: 'Categ.', icone: 'MUDANCA_CATEGORIA', linkavel: false },
]

function nomeMes(mes: string) {
  const [ano, mesNum] = mes.split('-').map(Number)
  const data = new Date(ano, mesNum - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function formatarData(iso: string) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

function hrefRelatorio(categoriaId: string, tipoRelatorio?: string) {
  return `/relatorios?categoria=${categoriaId}${tipoRelatorio ? `&tipo=${tipoRelatorio}` : ''}`
}

// categoria sem nenhum dado no período (nem estoque, nem movimento) não
// precisa poluir o relatório — vale tanto pra categoria nunca usada
// quanto pra categoria inativada sem atividade nesse período específico
function linhaEstaZerada(l: RelatorioLinha) {
  return (
    l.estoque_inicial === 0 &&
    l.entrada_nascimento === 0 &&
    l.entrada_compra === 0 &&
    l.entrada_desmame === 0 &&
    l.entrada_transferencia === 0 &&
    l.entrada_mudanca_categoria === 0 &&
    l.saida_morte === 0 &&
    l.saida_venda === 0 &&
    l.saida_desmame === 0 &&
    l.saida_transferencia === 0 &&
    l.saida_consumo_doacao === 0 &&
    l.saida_mudanca_categoria === 0 &&
    l.estoque_final === 0
  )
}

const TIPO_LABEL: Record<TipoMovimentacao, string> = {
  NASCIMENTO: 'Nascimento',
  COMPRA: 'Compra',
  VENDA_PE: 'Venda em Pé',
  VENDA_ABATE: 'Venda Abate',
  MORTE: 'Morte',
  CONSUMO_DOACAO: 'Consumo/Doação',
  DESMAME: 'Desmame',
  MUDANCA_CATEGORIA: 'Mudança de Categoria',
  TRANSFERENCIA: 'Transferência',
}

// um lançamento individual dentro do detalhe de uma categoria — data +,
// pras movimentações externas (compra/venda/transferência/causa da
// morte/consumo-doação), quem/o quê do outro lado
type ItemDetalheLancamento = {
  id: string
  data: string
  tipo: TipoMovimentacao
  quantidade: number
  quem: string | null
}
type DetalheCategoria = { entradas: ItemDetalheLancamento[]; saidas: ItemDetalheLancamento[] }

// linha crua de movimentacoes_rebanho usada só pra montar o detalhe
// lançamento a lançamento — bem mais enxuta que o SELECT completo de
// Relatórios de Movimentações (sem valores/pesos, que não aparecem aqui)
type MovimentacaoDetalheRaw = {
  id: string
  data: string
  tipo: TipoMovimentacao
  quantidade: number
  causa_morte: string | null
  subtipo_consumo_doacao: 'CONSUMO_INTERNO' | 'DOACAO' | null
  fazenda_id: string | null
  fazenda_origem_id: string | null
  fazenda_destino_id: string | null
  categoria_id: string
  categoria_destino_id: string | null
  fazenda_origem: { nome: string } | null
  fazenda_destino: { nome: string } | null
  categoria_origem: { nome: string } | null
  categoria_destino: { nome: string } | null
  cliente: { nome: string } | null
}

function IconeCabecalho({ coluna, direcao }: { coluna: ColunaMovimentacao; direcao: 'entrada' | 'saida' }) {
  const cor = direcao === 'entrada' ? 'text-brand-500' : 'text-warning'
  return (
    <span className="flex flex-col items-center gap-0.5" title={coluna.label}>
      <span className={`h-[18px] w-[18px] ${cor}`}>
        <IconeMovimentacao tipo={coluna.icone} />
      </span>
      <span className="text-[10px] font-semibold normal-case tracking-normal text-text-muted">{coluna.label}</span>
    </span>
  )
}

// número de uma célula da tabela — vira link pra Relatórios de
// Movimentações (já filtrado por categoria + tipo, quando a coluna tem um
// tipo único) quando há valor e a coluna é linkável; senão só o número, ou
// um traço sutil quando zerado.
function CelulaValor({
  valor,
  categoriaId,
  coluna,
  direcao,
}: {
  valor: number
  categoriaId: string
  coluna: ColunaMovimentacao
  direcao: 'entrada' | 'saida'
}) {
  if (!valor) return <span className="text-border">—</span>
  const corTexto = direcao === 'entrada' ? 'text-brand-700' : 'text-warning'
  if (!coluna.linkavel) return <span className={`font-semibold tabular-nums ${corTexto}`}>{formatQuantidade(valor)}</span>
  return (
    <Link
      href={hrefRelatorio(categoriaId, coluna.tipoRelatorio)}
      className={`rounded font-semibold tabular-nums ${corTexto} hover:underline hover:decoration-2 hover:underline-offset-2`}
      onClick={(e) => e.stopPropagation()}
    >
      {formatQuantidade(valor)}
    </Link>
  )
}

function EsqueletoDetalhe() {
  return (
    <div className="rounded-control border border-border bg-surface p-3.5">
      <div className="h-3 w-24 animate-pulse rounded bg-bg" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-bg" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-bg" />
      </div>
    </div>
  )
}

// painel de detalhe (accordion) — lançamento a lançamento (data + quem, do
// tipo aplicável), buscado sob demanda em movimentacoes_rebanho na
// primeira vez que a categoria é aberta (ver buscarDetalheCategoria) — não
// só o total por tipo que a própria linha da tabela já mostra.
function PainelDetalheLancamentos({
  categoriaId,
  itens,
  direcao,
  titulo,
  carregando,
  erro,
}: {
  categoriaId: string
  itens: ItemDetalheLancamento[]
  direcao: 'entrada' | 'saida'
  titulo: string
  carregando: boolean
  erro: boolean
}) {
  if (carregando) return <EsqueletoDetalhe />

  const total = itens.reduce((s, it) => s + it.quantidade, 0)
  const corTitulo = direcao === 'entrada' ? 'text-brand-700' : 'text-warning'
  const iconFg = direcao === 'entrada' ? 'text-brand-500' : 'text-warning'
  const qtyFg = direcao === 'entrada' ? 'text-brand-700' : 'text-warning'

  return (
    <div className="rounded-control border border-border bg-surface p-3.5">
      <h4 className={`text-xs font-extrabold uppercase tracking-wide ${corTitulo}`}>
        {titulo} {itens.length > 0 && `(${direcao === 'entrada' ? '+' : '-'}${total})`}
      </h4>
      {erro ? (
        <p className="mt-2 text-xs text-error">Não foi possível carregar o detalhe. Tente reabrir a categoria.</p>
      ) : itens.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          Nenhuma movimentação de {direcao === 'entrada' ? 'entrada' : 'saída'} no período.
        </p>
      ) : (
        <div className="mt-2">
          {itens.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-2.5 border-b border-dashed border-border py-1.5 text-xs last:border-b-0"
            >
              <span className={`h-3.5 w-3.5 flex-none ${iconFg}`}>
                <IconeMovimentacao tipo={it.tipo} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-text-primary">{TIPO_LABEL[it.tipo]}</div>
                {it.quem && <div className="truncate text-[11px] text-text-secondary">{it.quem}</div>}
              </div>
              <div className="flex-none text-[11px] text-text-muted">{formatarData(it.data)}</div>
              {it.tipo === 'MUDANCA_CATEGORIA' ? (
                <span className={`flex-none font-extrabold ${qtyFg}`}>
                  {direcao === 'entrada' ? '+' : '-'}
                  {formatQuantidade(it.quantidade)}
                </span>
              ) : (
                <Link
                  href={hrefRelatorio(categoriaId, it.tipo)}
                  className={`flex-none font-extrabold hover:underline ${qtyFg}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {direcao === 'entrada' ? '+' : '-'}
                  {formatQuantidade(it.quantidade)}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RelatorioMovimentacaoPage() {
  const {
    fazendas,
    fazendaIds,
    alternarFazenda,
    alternarTodas,
    todasSelecionadas,
    proprietarios,
    proprietarioIds,
    alternarProprietario,
    alternarTodosProprietarios,
    todosProprietariosSelecionados,
    modoFiltro,
    setModoFiltro,
    mes,
    setMes,
    safraAnoInicio,
    setSafraAnoInicio,
    anoCalendarioSelecionado,
    setAnoCalendarioSelecionado,
    dataInicioCustom,
    setDataInicioCustom,
    dataFimCustom,
    setDataFimCustom,
    dataInicio,
    dataFim,
    periodoInvalido,
  } = useFiltroGlobal()

  const [linhas, setLinhas] = useState<RelatorioLinha[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [categoriaAbertaId, setCategoriaAbertaId] = useState<string | null>(null)
  // detalhe lançamento a lançamento, buscado sob demanda ao abrir uma
  // categoria — cacheado por categoria pra não refazer a busca reabrindo
  // a mesma categoria de novo na mesma visita à página
  const [detalhesPorCategoria, setDetalhesPorCategoria] = useState<Record<string, DetalheCategoria>>({})
  const [carregandoDetalheId, setCarregandoDetalheId] = useState<string | null>(null)
  const [erroDetalheId, setErroDetalheId] = useState<string | null>(null)

  const supabase = createClient()

  const hoje = new Date().toISOString().slice(0, 10)
  const mesAtual = hoje.slice(0, 7)

  // busca as movimentações reais da categoria (mesma tabela que
  // Relatórios de Movimentações já consulta) e reparte cada linha em
  // entrada ou saída daquela categoria especificamente — espelhando a
  // mesma regra que fn_relatorio_movimentacao_rebanho usa por coluna, já
  // que a função só devolve totais, nunca o lançamento individual.
  async function buscarDetalheCategoria(categoriaId: string): Promise<DetalheCategoria> {
    let query = supabase
      .from('movimentacoes_rebanho')
      .select(
        `id, data, tipo, quantidade, causa_morte, subtipo_consumo_doacao,
         fazenda_id, fazenda_origem_id, fazenda_destino_id, categoria_id, categoria_destino_id,
         fazenda_origem:fazendas!fazenda_origem_id(nome),
         fazenda_destino:fazendas!fazenda_destino_id(nome),
         categoria_origem:categorias_animal!categoria_id(nome),
         categoria_destino:categorias_animal!categoria_destino_id(nome),
         cliente:pessoas!cliente_fornecedor_id(nome)`
      )
      .neq('tipo', 'SALDO_INICIAL')
      .or(`categoria_id.eq.${categoriaId},categoria_destino_id.eq.${categoriaId}`)
      .or(`fazenda_id.in.(${fazendaIds.join(',')}),fazenda_origem_id.in.(${fazendaIds.join(',')}),fazenda_destino_id.in.(${fazendaIds.join(',')})`)
      .gte('data', dataInicio)
      .lte('data', dataFim)

    // mesmo princípio já usado na busca agregada: vazio ou todos marcados
    // = sem filtro, nunca esconder lançamento sem proprietário atribuído
    if (proprietarioIds.length > 0 && proprietarioIds.length < proprietarios.length) {
      query = query.or(`proprietario_id.in.(${proprietarioIds.join(',')}),proprietario_id.is.null`)
    }

    const { data, error } = await query.order('data', { ascending: true })
    if (error || !data) throw error || new Error('sem dados')

    const entradas: ItemDetalheLancamento[] = []
    const saidas: ItemDetalheLancamento[] = []

    for (const m of data as unknown as MovimentacaoDetalheRaw[]) {
      switch (m.tipo) {
        case 'NASCIMENTO':
          if (m.categoria_id === categoriaId) {
            entradas.push({ id: m.id, data: m.data, tipo: 'NASCIMENTO', quantidade: m.quantidade, quem: null })
          }
          break
        case 'COMPRA':
          if (m.categoria_id === categoriaId) {
            entradas.push({
              id: m.id,
              data: m.data,
              tipo: 'COMPRA',
              quantidade: m.quantidade,
              quem: m.cliente?.nome ? `Fornecedor: ${m.cliente.nome}` : null,
            })
          }
          break
        case 'MORTE':
          if (m.categoria_id === categoriaId) {
            saidas.push({
              id: m.id,
              data: m.data,
              tipo: 'MORTE',
              quantidade: m.quantidade,
              quem: m.causa_morte ? `Causa: ${m.causa_morte}` : null,
            })
          }
          break
        case 'VENDA_PE':
        case 'VENDA_ABATE':
          if (m.categoria_id === categoriaId) {
            saidas.push({
              id: m.id,
              data: m.data,
              tipo: m.tipo,
              quantidade: m.quantidade,
              quem: m.cliente?.nome ? `Cliente: ${m.cliente.nome}` : null,
            })
          }
          break
        case 'CONSUMO_DOACAO':
          if (m.categoria_id === categoriaId) {
            saidas.push({
              id: m.id,
              data: m.data,
              tipo: 'CONSUMO_DOACAO',
              quantidade: m.quantidade,
              quem: m.subtipo_consumo_doacao === 'DOACAO' ? 'Doação' : 'Consumo interno',
            })
          }
          break
        case 'DESMAME':
          if (m.categoria_destino_id === categoriaId) {
            entradas.push({
              id: m.id,
              data: m.data,
              tipo: 'DESMAME',
              quantidade: m.quantidade,
              quem: m.categoria_origem?.nome ? `De: ${m.categoria_origem.nome}` : null,
            })
          }
          if (m.categoria_id === categoriaId) {
            saidas.push({
              id: m.id,
              data: m.data,
              tipo: 'DESMAME',
              quantidade: m.quantidade,
              quem: m.categoria_destino?.nome ? `Para: ${m.categoria_destino.nome}` : null,
            })
          }
          break
        case 'MUDANCA_CATEGORIA':
          if (m.categoria_destino_id === categoriaId) {
            entradas.push({
              id: m.id,
              data: m.data,
              tipo: 'MUDANCA_CATEGORIA',
              quantidade: m.quantidade,
              quem: m.categoria_origem?.nome ? `De: ${m.categoria_origem.nome}` : null,
            })
          }
          if (m.categoria_id === categoriaId) {
            saidas.push({
              id: m.id,
              data: m.data,
              tipo: 'MUDANCA_CATEGORIA',
              quantidade: m.quantidade,
              quem: m.categoria_destino?.nome ? `Para: ${m.categoria_destino.nome}` : null,
            })
          }
          break
        case 'TRANSFERENCIA': {
          if (m.categoria_id !== categoriaId) break
          // só conta como entrada/saída quando cruza a fronteira das
          // fazendas selecionadas — mesma regra da RPC
          const entrouNoGrupo =
            !!m.fazenda_destino_id &&
            fazendaIds.includes(m.fazenda_destino_id) &&
            !(m.fazenda_origem_id && fazendaIds.includes(m.fazenda_origem_id))
          const saiuDoGrupo =
            !!m.fazenda_origem_id &&
            fazendaIds.includes(m.fazenda_origem_id) &&
            !(m.fazenda_destino_id && fazendaIds.includes(m.fazenda_destino_id))
          if (entrouNoGrupo) {
            entradas.push({
              id: m.id,
              data: m.data,
              tipo: 'TRANSFERENCIA',
              quantidade: m.quantidade,
              quem: m.fazenda_origem?.nome ? `De: ${m.fazenda_origem.nome}` : null,
            })
          }
          if (saiuDoGrupo) {
            saidas.push({
              id: m.id,
              data: m.data,
              tipo: 'TRANSFERENCIA',
              quantidade: m.quantidade,
              quem: m.fazenda_destino?.nome ? `Para: ${m.fazenda_destino.nome}` : null,
            })
          }
          break
        }
        default:
          break
      }
    }

    return { entradas, saidas }
  }

  function alternarCategoriaAberta(categoriaId: string) {
    const aberta = categoriaAbertaId === categoriaId
    setCategoriaAbertaId(aberta ? null : categoriaId)
    if (!aberta && !detalhesPorCategoria[categoriaId]) {
      setCarregandoDetalheId(categoriaId)
      setErroDetalheId(null)
      buscarDetalheCategoria(categoriaId)
        .then((detalhe) => setDetalhesPorCategoria((prev) => ({ ...prev, [categoriaId]: detalhe })))
        .catch(() => setErroDetalheId(categoriaId))
        .finally(() => setCarregandoDetalheId((atual) => (atual === categoriaId ? null : atual)))
    }
  }

  useEffect(() => {
    if (fazendaIds.length === 0 || periodoInvalido) {
      setLinhas([])
      return
    }
    setLoading(true)
    setErro(null)
    supabase
      .rpc('fn_relatorio_movimentacao_rebanho', {
        p_fazenda_ids: fazendaIds,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        // vazio OU todos marcados = sem filtro (nunca esconder lançamentos
        // sem proprietário atribuído, a maioria); só filtra de verdade
        // quando é uma seleção parcial deliberada
        p_proprietario_ids:
          proprietarioIds.length > 0 && proprietarioIds.length < proprietarios.length ? proprietarioIds : null,
      })
      .then(({ data, error }) => {
        if (error) {
          setErro(error.message)
        } else {
          setLinhas(data || [])
        }
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaIds, dataInicio, dataFim, proprietarioIds])

  const linhasVisiveis = linhas.filter((l) => !linhaEstaZerada(l))
  const linhasExibidas = busca.trim()
    ? linhasVisiveis.filter((l) => l.categoria_nome.toLowerCase().includes(busca.trim().toLowerCase()))
    : linhasVisiveis

  const totais = linhasVisiveis.reduce(
    (acc, l) => ({
      estoque_inicial: acc.estoque_inicial + l.estoque_inicial,
      entrada_nascimento: acc.entrada_nascimento + l.entrada_nascimento,
      entrada_compra: acc.entrada_compra + l.entrada_compra,
      entrada_desmame: acc.entrada_desmame + l.entrada_desmame,
      entrada_transferencia: acc.entrada_transferencia + l.entrada_transferencia,
      entrada_mudanca_categoria: acc.entrada_mudanca_categoria + l.entrada_mudanca_categoria,
      saida_morte: acc.saida_morte + l.saida_morte,
      saida_venda: acc.saida_venda + l.saida_venda,
      saida_desmame: acc.saida_desmame + l.saida_desmame,
      saida_transferencia: acc.saida_transferencia + l.saida_transferencia,
      saida_consumo_doacao: acc.saida_consumo_doacao + l.saida_consumo_doacao,
      saida_mudanca_categoria: acc.saida_mudanca_categoria + l.saida_mudanca_categoria,
      estoque_final: acc.estoque_final + l.estoque_final,
    }),
    {
      estoque_inicial: 0,
      entrada_nascimento: 0,
      entrada_compra: 0,
      entrada_desmame: 0,
      entrada_transferencia: 0,
      entrada_mudanca_categoria: 0,
      saida_morte: 0,
      saida_venda: 0,
      saida_desmame: 0,
      saida_transferencia: 0,
      saida_consumo_doacao: 0,
      saida_mudanca_categoria: 0,
      estoque_final: 0,
    }
  )

  // Entradas/Saídas dos KPIs (e da variação) somam só movimentação real de
  // entrada/saída do rebanho — Desmame e Mudança de Categoria ficam de
  // fora de propósito, mesmo princípio já usado em FluxoRebanho: são
  // reclassificação interna (a saída de uma categoria = a entrada de
  // outra), sempre se cancelam quando somadas em todas as categorias, e
  // contá-las aqui infla os dois totais sem representar nenhum animal
  // entrando ou saindo de fato.
  const totalEntradas = totais.entrada_nascimento + totais.entrada_compra + totais.entrada_transferencia
  const totalSaidas = totais.saida_morte + totais.saida_venda + totais.saida_consumo_doacao + totais.saida_transferencia
  const variacaoPeriodo = totais.estoque_final - totais.estoque_inicial
  const variacaoPct = totais.estoque_inicial > 0 ? (variacaoPeriodo / totais.estoque_inicial) * 100 : null
  const variacaoPositiva = variacaoPeriodo >= 0

  const distribuicao = linhas
    .filter((l) => l.estoque_final > 0)
    .sort((a, b) => b.estoque_final - a.estoque_final)
  const totalDistribuicao = distribuicao.reduce((s, l) => s + l.estoque_final, 0)

  const rotuloPeriodoCurto =
    modoFiltro === 'mes'
      ? nomeMes(mes)
      : modoFiltro === 'safra'
        ? `Safra ${safraAnoInicio}/${safraAnoInicio + 1}`
        : modoFiltro === 'ano'
          ? `Ano ${anoCalendarioSelecionado}`
          : `${formatarData(dataInicio)} – ${formatarData(dataFim)}`

  const resumoFiltro = [
    `${fazendaIds.length} fazenda${fazendaIds.length === 1 ? '' : 's'}`,
    proprietarios.length > 1
      ? todosProprietariosSelecionados
        ? 'todos os proprietários'
        : `${proprietarioIds.length} proprietário${proprietarioIds.length === 1 ? '' : 's'}`
      : null,
    rotuloPeriodoCurto,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <ModuloGate modulo="resumo_movimentacao">
      <div className="px-6 py-8 md:px-10">
        <PainelFiltroColapsavel titulo="Resumo de Movimentação de Rebanho" resumoFiltro={resumoFiltro}>
          <FiltroMultiSelect
            label="Fazendas"
            required
            itens={fazendas}
            selecionados={fazendaIds}
            onToggleItem={alternarFazenda}
            onToggleTodos={alternarTodas}
            todosSelecionados={todasSelecionadas}
            vazioLabel="Nenhuma fazenda cadastrada."
          />

          {proprietarios.length > 1 && (
            <FiltroMultiSelect
              label="Proprietário"
              itens={proprietarios}
              selecionados={proprietarioIds}
              onToggleItem={alternarProprietario}
              onToggleTodos={alternarTodosProprietarios}
              todosSelecionados={todosProprietariosSelecionados}
              pluralMasculino
            />
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Período</label>
            <div className="mb-1.5 flex flex-wrap gap-3 text-sm text-text-primary">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'mes'} onChange={() => setModoFiltro('mes')} />
                Mês
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'safra'} onChange={() => setModoFiltro('safra')} />
                Ano Safra
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="modoFiltro" checked={modoFiltro === 'ano'} onChange={() => setModoFiltro('ano')} />
                Ano Calendário
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="modoFiltro"
                  checked={modoFiltro === 'periodo'}
                  onChange={() => setModoFiltro('periodo')}
                />
                Período personalizado
              </label>
            </div>
            {modoFiltro === 'mes' ? (
              <input
                type="month"
                max={mesAtual}
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              />
            ) : modoFiltro === 'safra' ? (
              <div className="flex items-center gap-2">
                <select
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={safraAnoInicio}
                  onChange={(e) => setSafraAnoInicio(Number(e.target.value))}
                >
                  {opcoesSafra().map((ano) => (
                    <option key={ano} value={ano}>
                      {ano}/{ano + 1}
                      {ano === anoInicioSafraAtual() ? ' (atual)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-text-secondary">
                  {formatarData(dataInicio)} até {formatarData(dataFim)}
                </p>
              </div>
            ) : modoFiltro === 'ano' ? (
              <div className="flex items-center gap-2">
                <select
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={anoCalendarioSelecionado}
                  onChange={(e) => setAnoCalendarioSelecionado(Number(e.target.value))}
                >
                  {opcoesAno().map((ano) => (
                    <option key={ano} value={ano}>
                      {ano}
                      {ano === anoCalendarioAtual() ? ' (atual)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-text-secondary">
                  {formatarData(dataInicio)} até {formatarData(dataFim)}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  max={hoje}
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={dataInicioCustom}
                  onChange={(e) => setDataInicioCustom(e.target.value)}
                />
                <span className="text-text-secondary">até</span>
                <input
                  type="date"
                  max={hoje}
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={dataFimCustom}
                  onChange={(e) => setDataFimCustom(e.target.value)}
                />
              </div>
            )}
            {periodoInvalido && <p className="mt-1 text-xs text-error">A data inicial não pode ser depois da data final.</p>}
          </div>
        </PainelFiltroColapsavel>

        <p className="mt-4 text-sm text-text-secondary">
          Estoque, entradas e saídas do rebanho por categoria — clique numa categoria pra ver o detalhe, ou num
          número pra abrir em Relatórios de Movimentações já filtrado.
        </p>

        {fazendaIds.length === 0 ? (
          <p className="mt-6 text-text-secondary">Selecione ao menos uma fazenda para ver o relatório.</p>
        ) : periodoInvalido ? (
          <p className="mt-6 text-error">Corrija o período antes de continuar.</p>
        ) : loading ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-card border border-border bg-surface p-4">
                <div className="h-3 w-20 rounded bg-bg" />
                <div className="mt-3 h-7 w-16 rounded bg-bg" />
                <div className="mt-2 h-3 w-24 rounded bg-bg" />
              </div>
            ))}
          </div>
        ) : erro ? (
          <p className="mt-6 text-error">Erro: {erro}</p>
        ) : (
          <>
            <p className="mt-5 text-sm capitalize text-text-secondary">
              {modoFiltro === 'mes'
                ? nomeMes(mes)
                : modoFiltro === 'safra'
                  ? `Safra ${safraAnoInicio}/${safraAnoInicio + 1} (${formatarData(dataInicio)} até ${formatarData(dataFim)})`
                  : modoFiltro === 'ano'
                    ? `Ano ${anoCalendarioSelecionado} (${formatarData(dataInicio)} até ${formatarData(dataFim)})`
                    : `${formatarData(dataInicio)} até ${formatarData(dataFim)}`}
              {' · '}
              {fazendaIds.length} fazenda{fazendaIds.length > 1 ? 's' : ''} selecionada{fazendaIds.length > 1 ? 's' : ''}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-card border border-border bg-surface p-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Estoque inicial</div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums text-text-primary">
                  {formatQuantidade(totais.estoque_inicial)}
                </div>
                <div className="mt-0.5 text-xs font-medium text-text-secondary">cabeças em {formatarData(dataInicio)}</div>
              </div>
              <div className="relative overflow-hidden rounded-card border border-border bg-surface p-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Entradas</div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums text-brand-700">
                  +{formatQuantidade(totalEntradas)}
                </div>
                <div className="mt-0.5 text-xs font-medium text-text-secondary">cabeças no período</div>
                <div className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-control bg-brand-100 text-brand-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </div>
              </div>
              <div className="relative overflow-hidden rounded-card border border-border bg-surface p-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Saídas</div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums text-warning">
                  -{formatQuantidade(totalSaidas)}
                </div>
                <div className="mt-0.5 text-xs font-medium text-text-secondary">cabeças no período</div>
                <div className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-control bg-warning-bg text-warning">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                </div>
              </div>
              <div className="rounded-card border border-border bg-surface p-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Estoque final</div>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums text-text-primary">
                  {formatQuantidade(totais.estoque_final)}
                </div>
                <div className="mt-0.5 text-xs font-medium text-text-secondary">cabeças em {formatarData(dataFim)}</div>
              </div>
            </div>

            <div
              className={`mt-4 flex flex-wrap items-center gap-3 rounded-control border p-3 text-sm ${
                variacaoPositiva ? 'border-border bg-success-bg' : 'border-border bg-bg'
              }`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className={variacaoPositiva ? 'text-success' : 'text-text-muted'}
              >
                {variacaoPositiva ? (
                  <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
                ) : (
                  <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />
                )}
              </svg>
              <span className="text-text-primary">
                Variação do período:{' '}
                <strong className="font-extrabold">
                  {variacaoPeriodo > 0 ? `+${formatQuantidade(variacaoPeriodo)}` : formatQuantidade(variacaoPeriodo)} cabeças
                </strong>
              </span>
              {variacaoPct !== null && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${
                    variacaoPositiva ? 'bg-success' : 'bg-text-muted'
                  }`}
                >
                  {variacaoPct > 0 ? '+' : ''}
                  {variacaoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                </span>
              )}
              <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${variacaoPositiva ? 'bg-success' : 'bg-text-muted'}`}
                  style={{ width: `${Math.min(100, Math.abs(variacaoPct ?? 0))}%` }}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="relative">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  placeholder="Buscar categoria..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-60 rounded-control border border-border bg-surface py-2 pl-8 pr-3 text-sm text-text-primary outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="p-2"></th>
                      <th className="p-2"></th>
                      <th colSpan={COLUNAS_ENTRADA.length} className="border-b border-border p-2 pb-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-brand-500">
                        Entradas
                      </th>
                      <th colSpan={COLUNAS_SAIDA.length} className="border-b border-border p-2 pb-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-warning">
                        Saídas
                      </th>
                      <th className="p-2"></th>
                      <th className="p-2"></th>
                    </tr>
                    <tr>
                      <th className="border-b border-border p-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-text-muted">
                        Categoria
                      </th>
                      <th className="border-b border-border p-2 text-center text-[10.5px] font-bold uppercase tracking-wide text-text-muted">
                        Estoque inicial
                        <div className="mt-0.5 font-normal normal-case text-text-muted">{formatarData(dataInicio)}</div>
                      </th>
                      {COLUNAS_ENTRADA.map((c) => (
                        <th key={c.key} className="border-b border-border p-2 text-center">
                          <IconeCabecalho coluna={c} direcao="entrada" />
                        </th>
                      ))}
                      {COLUNAS_SAIDA.map((c) => (
                        <th key={c.key} className="border-b border-border p-2 text-center">
                          <IconeCabecalho coluna={c} direcao="saida" />
                        </th>
                      ))}
                      <th className="border-b border-border p-2 text-center text-[10.5px] font-bold uppercase tracking-wide text-text-muted">
                        Variação
                      </th>
                      <th className="border-b border-border p-2 text-center text-[10.5px] font-bold uppercase tracking-wide text-text-muted">
                        Estoque final
                        <div className="mt-0.5 font-normal normal-case text-text-muted">{formatarData(dataFim)}</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasExibidas.length === 0 ? (
                      <tr>
                        <td colSpan={2 + COLUNAS_ENTRADA.length + COLUNAS_SAIDA.length + 2} className="p-6 text-center text-sm text-text-muted">
                          Nenhuma categoria encontrada.
                        </td>
                      </tr>
                    ) : (
                      linhasExibidas.map((l) => {
                        const aberta = categoriaAbertaId === l.categoria_id
                        const variacaoLinha = l.estoque_final - l.estoque_inicial
                        return (
                          <Fragment key={l.categoria_id}>
                            <tr
                              onClick={() => alternarCategoriaAberta(l.categoria_id)}
                              className={`cursor-pointer border-b border-border transition-colors hover:bg-bg ${aberta ? 'bg-brand-100 hover:bg-brand-100' : ''}`}
                            >
                              <td className="p-2 text-left font-semibold text-text-primary">
                                <span className="flex items-center gap-1.5">
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className={`flex-none text-text-muted transition-transform ${aberta ? 'rotate-90 text-brand-500' : ''}`}
                                  >
                                    <path d="M9 6l6 6-6 6" />
                                  </svg>
                                  <span className="whitespace-nowrap">{l.categoria_nome}</span>
                                </span>
                              </td>
                              <td className="p-2 text-center tabular-nums text-text-primary">{formatQuantidade(l.estoque_inicial)}</td>
                              {COLUNAS_ENTRADA.map((c) => (
                                <td key={c.key} className="p-2 text-center">
                                  <CelulaValor valor={l[c.key] as number} categoriaId={l.categoria_id} coluna={c} direcao="entrada" />
                                </td>
                              ))}
                              {COLUNAS_SAIDA.map((c) => (
                                <td key={c.key} className="p-2 text-center">
                                  <CelulaValor valor={l[c.key] as number} categoriaId={l.categoria_id} coluna={c} direcao="saida" />
                                </td>
                              ))}
                              <td
                                className={`p-2 text-center font-extrabold tabular-nums ${
                                  variacaoLinha > 0 ? 'text-success' : variacaoLinha < 0 ? 'text-error' : 'text-text-muted'
                                }`}
                              >
                                {variacaoLinha > 0 ? `+${formatQuantidade(variacaoLinha)}` : formatQuantidade(variacaoLinha)}
                              </td>
                              <td className="p-2 text-center font-extrabold tabular-nums text-text-primary">
                                {formatQuantidade(l.estoque_final)}
                              </td>
                            </tr>
                            {aberta && (
                              <tr className="border-b border-border bg-bg">
                                <td colSpan={2 + COLUNAS_ENTRADA.length + COLUNAS_SAIDA.length + 2} className="p-4">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <PainelDetalheLancamentos
                                      categoriaId={l.categoria_id}
                                      itens={detalhesPorCategoria[l.categoria_id]?.entradas || []}
                                      direcao="entrada"
                                      titulo="Entradas"
                                      carregando={carregandoDetalheId === l.categoria_id}
                                      erro={erroDetalheId === l.categoria_id}
                                    />
                                    <PainelDetalheLancamentos
                                      categoriaId={l.categoria_id}
                                      itens={detalhesPorCategoria[l.categoria_id]?.saidas || []}
                                      direcao="saida"
                                      titulo="Saídas"
                                      carregando={carregandoDetalheId === l.categoria_id}
                                      erro={erroDetalheId === l.categoria_id}
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-bg font-extrabold">
                      <td className="p-3 text-left text-text-primary">Total</td>
                      <td className="p-3 text-center tabular-nums text-text-primary">{formatQuantidade(totais.estoque_inicial)}</td>
                      {COLUNAS_ENTRADA.map((c) => (
                        <td key={c.key} className="p-3 text-center tabular-nums text-text-primary">
                          {formatQuantidade(totais[c.key as keyof typeof totais])}
                        </td>
                      ))}
                      {COLUNAS_SAIDA.map((c) => (
                        <td key={c.key} className="p-3 text-center tabular-nums text-text-primary">
                          {formatQuantidade(totais[c.key as keyof typeof totais])}
                        </td>
                      ))}
                      <td
                        className={`p-3 text-center tabular-nums ${
                          variacaoPeriodo > 0 ? 'text-success' : variacaoPeriodo < 0 ? 'text-error' : 'text-text-muted'
                        }`}
                      >
                        {variacaoPeriodo > 0 ? `+${formatQuantidade(variacaoPeriodo)}` : formatQuantidade(variacaoPeriodo)}
                      </td>
                      <td className="p-3 text-center tabular-nums text-text-primary">{formatQuantidade(totais.estoque_final)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <h2 className="mt-8 mb-3 font-semibold text-text-primary">Distribuição do rebanho final</h2>
            {distribuicao.length === 0 ? (
              <p className="text-text-secondary">Sem estoque nas fazendas selecionadas ao final do período.</p>
            ) : (
              <ul className="max-w-2xl space-y-2">
                {distribuicao.map((l) => {
                  const pct = totalDistribuicao ? (l.estoque_final / totalDistribuicao) * 100 : 0
                  return (
                    <li key={l.categoria_id}>
                      <div className="mb-1 flex justify-between text-sm text-text-primary">
                        <span>{l.categoria_nome}</span>
                        <span className="text-text-secondary">
                          {formatQuantidade(l.estoque_final)} cab. ·{' '}
                          {pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-bg">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </ModuloGate>
  )
}
