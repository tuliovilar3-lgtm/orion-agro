'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { anoInicioSafraAtual, anoCalendarioAtual, opcoesSafra, opcoesAno } from '@/lib/periodo'
import { useFiltroGlobal } from '@/contexts/FiltroGlobalContext'
import { MovimentacaoRelatorio, formatarDataBr } from '@/components/relatorios/tipos'
import RelatorioNascimento from '@/components/relatorios/RelatorioNascimento'
import RelatorioDesmame from '@/components/relatorios/RelatorioDesmame'
import RelatorioCompra from '@/components/relatorios/RelatorioCompra'
import RelatorioVendaPe from '@/components/relatorios/RelatorioVendaPe'
import RelatorioVendaAbate from '@/components/relatorios/RelatorioVendaAbate'
import RelatorioMortalidade from '@/components/relatorios/RelatorioMortalidade'
import RelatorioConsumoDoacao from '@/components/relatorios/RelatorioConsumoDoacao'
import RelatorioTransferencia from '@/components/relatorios/RelatorioTransferencia'
import ModuloGate from '@/components/ModuloGate'

type Fazenda = { id: string; nome: string }
type Categoria = { id: string; nome: string }

const TIPOS_RELATORIO = [
  { tipo: 'NASCIMENTO', label: 'Nascimentos' },
  { tipo: 'DESMAME', label: 'Desmame' },
  { tipo: 'COMPRA', label: 'Compras' },
  { tipo: 'VENDA_PE', label: 'Venda em Pé' },
  { tipo: 'VENDA_ABATE', label: 'Venda Abate' },
  { tipo: 'MORTE', label: 'Mortalidade' },
  { tipo: 'CONSUMO_DOACAO', label: 'Consumo/Doação' },
  { tipo: 'TRANSFERENCIA', label: 'Transferência' },
] as const

type TipoRelatorio = (typeof TIPOS_RELATORIO)[number]['tipo']

const SELECT_MOVIMENTACAO = `
  id, data, tipo, quantidade, peso_medio_kg, peso_total_kg, peso_morto_kg, rendimento_carcaca_pct,
  valor_arroba, valor_cabeca, valor_kg, valor_total, causa_morte, subtipo_consumo_doacao,
  safra_nascimento_ano_inicio, observacao,
  fazenda_id, fazenda_origem_id, fazenda_destino_id, categoria_id, categoria_destino_id, cliente_fornecedor_id, proprietario_id,
  fazenda:fazendas!fazenda_id(nome),
  fazenda_origem:fazendas!fazenda_origem_id(nome),
  fazenda_destino:fazendas!fazenda_destino_id(nome),
  categoria:categorias_animal!categoria_id(nome, sexo, grupo:grupos_categoria(nome)),
  categoria_destino:categorias_animal!categoria_destino_id(nome),
  cliente:pessoas!cliente_fornecedor_id(nome),
  proprietario:pessoas!proprietario_id(nome),
  movimentacao_ajustes(valor, item:itens_ajuste_financeiro!item_id(tipo))
`

function nomeMesLongo(anoMes: string) {
  const [ano, mesNum] = anoMes.split('-').map(Number)
  const data = new Date(ano, mesNum - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// filtro de linha única (mesmo formato pros 3 filtros de cima — Fazendas,
// Categoria, Proprietário) que abre um popover de checkboxes pra marcar/
// desmarcar, em vez da lista sempre expandida que cada um tinha antes.
function FiltroMultiSelect({
  label,
  required,
  itens,
  selecionados,
  onToggleItem,
  onToggleTodos,
  todosSelecionados,
  vazioLabel,
}: {
  label: string
  required?: boolean
  itens: { id: string; nome: string }[]
  selecionados: string[]
  onToggleItem: (id: string) => void
  onToggleTodos: () => void
  todosSelecionados: boolean
  vazioLabel?: string
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onClickFora)
    return () => document.removeEventListener('mousedown', onClickFora)
  }, [aberto])

  const resumo =
    itens.length === 0
      ? vazioLabel || 'Nenhuma opção'
      : todosSelecionados
        ? `Todas (${itens.length})`
        : selecionados.length === 0
          ? 'Nenhuma selecionada'
          : `${selecionados.length} de ${itens.length} selecionada${selecionados.length > 1 ? 's' : ''}`

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">
        {label}
        {required && <Required />}
      </label>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-56 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2 text-left text-sm text-text-primary outline-none focus:border-brand-500"
      >
        <span className="truncate">{resumo}</span>
        <span className="text-text-muted">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-64 rounded-control border border-border bg-surface p-2 shadow-lg">
          <div className="mb-1.5 flex items-center justify-between border-b border-border pb-1.5">
            <span className="text-xs text-text-muted">
              {selecionados.length} de {itens.length}
            </span>
            <button type="button" className="text-xs font-medium text-brand-500 underline" onClick={onToggleTodos}>
              {todosSelecionados ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {itens.length === 0 ? (
              <p className="px-1 py-1 text-xs text-text-muted">{vazioLabel || 'Nenhuma opção cadastrada.'}</p>
            ) : (
              itens.map((it) => (
                <label
                  key={it.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm text-text-primary hover:bg-bg"
                >
                  <input type="checkbox" checked={selecionados.includes(it.id)} onChange={() => onToggleItem(it.id)} />
                  {it.nome}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function RelatoriosPage() {
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

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriaIds, setCategoriaIds] = useState<string[]>([])
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoRelatorio>('NASCIMENTO')

  function alternarCategoria(id: string) {
    setCategoriaIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }
  function alternarTodasCategorias() {
    setCategoriaIds((prev) => (prev.length === categorias.length ? [] : categorias.map((c) => c.id)))
  }
  const todasCategoriasSelecionadas = categorias.length > 0 && categoriaIds.length === categorias.length

  const [linhas, setLinhas] = useState<MovimentacaoRelatorio[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)
  const mesAtual = hoje.slice(0, 7)

  useEffect(() => {
    // categorias sem filtro de ativa — o relatório precisa continuar
    // achando histórico de categoria já inativada. Todas selecionadas por
    // padrão ao carregar (mesmo princípio de fazendaIds/proprietarioIds).
    supabase
      .from('categorias_animal')
      .select('id, nome')
      .order('nome')
      .then(({ data }) => {
        const lista = data || []
        setCategorias(lista)
        setCategoriaIds(lista.map((c) => c.id))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (fazendaIds.length === 0 || periodoInvalido) {
      setLinhas([])
      return
    }
    // categoria_id nunca é nulo numa movimentação — diferente de
    // proprietário, "nenhuma categoria marcada" aqui só pode significar
    // "não mostrar nada", nunca "sem filtro" (só chega nesse estado se o
    // usuário desmarcar tudo de propósito, já que o padrão é todas
    // marcadas assim que a lista carrega)
    if (categorias.length > 0 && categoriaIds.length === 0) {
      setLinhas([])
      return
    }
    let cancelado = false
    setLoading(true)
    setErro(null)

    let query = supabase
      .from('movimentacoes_rebanho')
      .select(SELECT_MOVIMENTACAO)
      .eq('tipo', tipoSelecionado)
      .gte('data', dataInicio)
      .lte('data', dataFim)

    query =
      tipoSelecionado === 'TRANSFERENCIA'
        ? query.or(`fazenda_origem_id.in.(${fazendaIds.join(',')}),fazenda_destino_id.in.(${fazendaIds.join(',')})`)
        : query.in('fazenda_id', fazendaIds)

    // todas marcadas = sem filtro; só filtra de verdade numa seleção
    // parcial deliberada
    if (categorias.length > 0 && categoriaIds.length < categorias.length) {
      query = query.or(`categoria_id.in.(${categoriaIds.join(',')}),categoria_destino_id.in.(${categoriaIds.join(',')})`)
    }
    // todas marcadas = sem filtro. Numa seleção parcial (inclusive
    // "nenhuma marcada"), lançamentos sem proprietário atribuído nunca
    // somem — eles não pertencem a nenhum dos proprietários
    // desmarcados, então ficar de fora da lista de exclusão é o
    // comportamento certo, não uma falha do filtro.
    if (proprietarios.length > 0 && proprietarioIds.length < proprietarios.length) {
      query =
        proprietarioIds.length > 0
          ? query.or(`proprietario_id.in.(${proprietarioIds.join(',')}),proprietario_id.is.null`)
          : query.is('proprietario_id', null)
    }

    query.order('data', { ascending: true }).then(({ data, error }) => {
      if (cancelado) return
      if (error) {
        setErro(error.message)
      } else {
        setLinhas((data as unknown as MovimentacaoRelatorio[]) || [])
      }
      setLoading(false)
    })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoSelecionado, fazendaIds, categorias, categoriaIds, proprietarioIds, dataInicio, dataFim])

  const rotuloPeriodo =
    modoFiltro === 'mes'
      ? nomeMesLongo(mes)
      : modoFiltro === 'safra'
        ? `Safra ${safraAnoInicio}/${safraAnoInicio + 1} (${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)})`
        : modoFiltro === 'ano'
          ? `Ano ${anoCalendarioSelecionado} (${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)})`
          : `${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)}`

  return (
    <ModuloGate modulo="relatorios_movimentacoes">
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Relatórios de Movimentações</h1>
      <p className="mt-1 text-sm text-text-secondary">
        KPIs, gráficos e detalhamento por tipo de movimentação — use os filtros abaixo para restringir período,
        fazenda e categoria.
      </p>

      {/* abas por tipo de movimentação — sticky ao rolar, mesmo padrão já
          usado na barra de tipo colapsada de Lançamento de Movimentações
          (top-14 no mobile pra não sobrepor a topbar fixa de 56px da
          Sidebar, top-0 no desktop, que não tem topbar) */}
      <div className="sticky top-14 z-20 -mx-6 flex flex-wrap gap-1.5 border-b border-border bg-bg px-6 pb-0 pt-2 md:top-0 md:mx-0 md:px-0 md:pt-0">
        {TIPOS_RELATORIO.map((t) => {
          const ativo = t.tipo === tipoSelecionado
          return (
            <button
              key={t.tipo}
              type="button"
              onClick={() => setTipoSelecionado(t.tipo)}
              className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                ativo
                  ? 'border-brand-500 text-brand-500 font-semibold'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* filtros compartilhados */}
      <div className="mt-5 flex flex-wrap gap-5 rounded-card border border-border bg-surface p-5">
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

        <FiltroMultiSelect
          label="Categoria"
          itens={categorias}
          selecionados={categoriaIds}
          onToggleItem={alternarCategoria}
          onToggleTodos={alternarTodasCategorias}
          todosSelecionados={todasCategoriasSelecionadas}
          vazioLabel="Nenhuma categoria cadastrada."
        />

        {proprietarios.length > 1 && (
          <FiltroMultiSelect
            label="Proprietário"
            itens={proprietarios}
            selecionados={proprietarioIds}
            onToggleItem={alternarProprietario}
            onToggleTodos={alternarTodosProprietarios}
            todosSelecionados={todosProprietariosSelecionados}
          />
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Período</label>
          <div className="mb-1.5 flex flex-wrap gap-3 text-sm text-text-primary">
            <label className="flex items-center gap-1">
              <input type="radio" name="modoFiltro" checked={modoFiltro === 'mes'} onChange={() => setModoFiltro('mes')} />
              Mês
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="modoFiltro"
                checked={modoFiltro === 'safra'}
                onChange={() => setModoFiltro('safra')}
              />
              Ano Safra
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="modoFiltro" checked={modoFiltro === 'ano'} onChange={() => setModoFiltro('ano')} />
              Ano Calendário
            </label>
            <label className="flex items-center gap-1">
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
          ) : modoFiltro === 'ano' ? (
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
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="date"
                max={hoje}
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={dataInicioCustom}
                onChange={(e) => setDataInicioCustom(e.target.value)}
              />
              <span className="text-sm text-text-secondary">até</span>
              <input
                type="date"
                max={hoje}
                className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                value={dataFimCustom}
                onChange={(e) => setDataFimCustom(e.target.value)}
              />
            </div>
          )}
          {periodoInvalido && <p className="mt-1 text-xs text-error">A data inicial não pode ser depois da final.</p>}
        </div>
      </div>

      <div className="mt-6">
        {fazendaIds.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="font-semibold text-text-primary">Selecione ao menos uma fazenda</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              O relatório precisa de pelo menos uma fazenda marcada no filtro acima para trazer dados.
            </p>
          </div>
        ) : periodoInvalido ? (
          <p className="text-sm text-error">Corrija o período antes de continuar.</p>
        ) : loading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-card border border-border bg-surface p-5">
                  <div className="h-3 w-20 rounded bg-border" />
                  <div className="mt-3 h-6 w-16 rounded bg-border" />
                </div>
              ))}
            </div>
            <div className="h-64 rounded-card border border-border bg-surface" />
          </div>
        ) : erro ? (
          <p className="text-sm text-error">Erro: {erro}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-text-secondary">
              {rotuloPeriodo} · {fazendaIds.length} fazenda{fazendaIds.length > 1 ? 's' : ''} selecionada
              {fazendaIds.length > 1 ? 's' : ''}
            </p>
            {tipoSelecionado === 'NASCIMENTO' && <RelatorioNascimento linhas={linhas} />}
            {tipoSelecionado === 'DESMAME' && <RelatorioDesmame linhas={linhas} />}
            {tipoSelecionado === 'COMPRA' && <RelatorioCompra linhas={linhas} />}
            {tipoSelecionado === 'VENDA_PE' && <RelatorioVendaPe linhas={linhas} />}
            {tipoSelecionado === 'VENDA_ABATE' && <RelatorioVendaAbate linhas={linhas} />}
            {tipoSelecionado === 'MORTE' && <RelatorioMortalidade linhas={linhas} />}
            {tipoSelecionado === 'CONSUMO_DOACAO' && <RelatorioConsumoDoacao linhas={linhas} />}
            {tipoSelecionado === 'TRANSFERENCIA' && <RelatorioTransferencia linhas={linhas} />}
          </>
        )}
      </div>
    </div>
    </ModuloGate>
  )
}
