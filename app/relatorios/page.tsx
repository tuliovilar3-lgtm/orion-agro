'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import {
  ultimoDiaDoMes,
  periodoSafra,
  periodoAno,
  anoInicioSafraAtual,
  anoCalendarioAtual,
  opcoesSafra,
  opcoesAno,
} from '@/lib/periodo'
import { MovimentacaoRelatorio, formatarDataBr } from '@/components/relatorios/tipos'
import RelatorioNascimento from '@/components/relatorios/RelatorioNascimento'
import RelatorioDesmame from '@/components/relatorios/RelatorioDesmame'
import RelatorioCompra from '@/components/relatorios/RelatorioCompra'
import RelatorioVendaPe from '@/components/relatorios/RelatorioVendaPe'
import RelatorioVendaAbate from '@/components/relatorios/RelatorioVendaAbate'
import RelatorioMortalidade from '@/components/relatorios/RelatorioMortalidade'
import RelatorioConsumoDoacao from '@/components/relatorios/RelatorioConsumoDoacao'
import RelatorioTransferencia from '@/components/relatorios/RelatorioTransferencia'

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
  fazenda_id, fazenda_origem_id, fazenda_destino_id, categoria_id, categoria_destino_id, cliente_fornecedor_id,
  fazenda:fazendas!fazenda_id(nome),
  fazenda_origem:fazendas!fazenda_origem_id(nome),
  fazenda_destino:fazendas!fazenda_destino_id(nome),
  categoria:categorias_animal!categoria_id(nome, sexo, grupo:grupos_categoria(nome)),
  categoria_destino:categorias_animal!categoria_destino_id(nome),
  cliente:clientes_fornecedores!cliente_fornecedor_id(nome),
  movimentacao_ajustes(valor, item:itens_ajuste_financeiro!item_id(tipo))
`

function nomeMesLongo(anoMes: string) {
  const [ano, mesNum] = anoMes.split('-').map(Number)
  const data = new Date(ano, mesNum - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export default function RelatoriosPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaIds, setFazendaIds] = useState<string[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriaId, setCategoriaId] = useState('')
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoRelatorio>('NASCIMENTO')

  const [modoFiltro, setModoFiltro] = useState<'mes' | 'safra' | 'ano' | 'periodo'>('mes')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicio] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionado] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustom] = useState(() => new Date().toISOString().slice(0, 10))

  const [linhas, setLinhas] = useState<MovimentacaoRelatorio[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const supabase = createClient()
  const hoje = new Date().toISOString().slice(0, 10)
  const mesAtual = hoje.slice(0, 7)

  const safra = periodoSafra(safraAnoInicio)
  const anoCalendario = periodoAno(anoCalendarioSelecionado)
  const dataInicio =
    modoFiltro === 'mes'
      ? `${mes}-01`
      : modoFiltro === 'safra'
        ? safra.dataInicio
        : modoFiltro === 'ano'
          ? anoCalendario.dataInicio
          : dataInicioCustom
  const dataFimBruta =
    modoFiltro === 'mes'
      ? `${mes}-${String(ultimoDiaDoMes(mes)).padStart(2, '0')}`
      : modoFiltro === 'safra'
        ? safra.dataFim
        : modoFiltro === 'ano'
          ? anoCalendario.dataFim
          : dataFimCustom
  const dataFim = dataFimBruta > hoje ? hoje : dataFimBruta
  const periodoInvalido = modoFiltro === 'periodo' && dataInicioCustom > dataFimCustom
  const todasSelecionadas = fazendas.length > 0 && fazendaIds.length === fazendas.length

  useEffect(() => {
    supabase
      .from('fazendas')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => {
        setFazendas(data || [])
        setFazendaIds((data || []).map((f) => f.id))
      })
    // categorias sem filtro de ativa — o relatório precisa continuar
    // achando histórico de categoria já inativada
    supabase
      .from('categorias_animal')
      .select('id, nome')
      .order('nome')
      .then(({ data }) => setCategorias(data || []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (fazendaIds.length === 0 || periodoInvalido) {
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

    if (categoriaId) {
      query = query.or(`categoria_id.eq.${categoriaId},categoria_destino_id.eq.${categoriaId}`)
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
  }, [tipoSelecionado, fazendaIds, categoriaId, dataInicio, dataFim])

  function alternarFazenda(id: string) {
    setFazendaIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  function alternarTodas() {
    setFazendaIds(todasSelecionadas ? [] : fazendas.map((f) => f.id))
  }

  const rotuloPeriodo =
    modoFiltro === 'mes'
      ? nomeMesLongo(mes)
      : modoFiltro === 'safra'
        ? `Safra ${safraAnoInicio}/${safraAnoInicio + 1} (${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)})`
        : modoFiltro === 'ano'
          ? `Ano ${anoCalendarioSelecionado} (${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)})`
          : `${formatarDataBr(dataInicio)} até ${formatarDataBr(dataFim)}`

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Relatórios de Movimentações</h1>
      <p className="mt-1 text-sm text-text-secondary">
        KPIs, gráficos e detalhamento por tipo de movimentação — use os filtros abaixo para restringir período,
        fazenda e categoria.
      </p>

      {/* abas por tipo de movimentação */}
      <div className="mt-6 flex flex-wrap gap-1.5 border-b border-border pb-0">
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
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <label className="text-sm font-medium text-text-secondary">
              Fazendas
              <Required />
            </label>
            <button type="button" className="text-xs font-medium text-brand-500 underline" onClick={alternarTodas}>
              {todasSelecionadas ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
          </div>
          <div className="max-h-32 w-56 space-y-1 overflow-y-auto rounded-control border border-border p-2">
            {fazendas.length === 0 ? (
              <p className="text-xs text-text-muted">Nenhuma fazenda cadastrada.</p>
            ) : (
              fazendas.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm text-text-primary">
                  <input type="checkbox" checked={fazendaIds.includes(f.id)} onChange={() => alternarFazenda(f.id)} />
                  {f.nome}
                </label>
              ))
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Categoria</label>
          <select
            className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

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
  )
}
