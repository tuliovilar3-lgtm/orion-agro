'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatQuantidade } from '@/lib/format'
import {
  ultimoDiaDoMes,
  periodoSafra,
  periodoAno,
  anoInicioSafraAtual,
  anoCalendarioAtual,
  opcoesSafra,
  opcoesAno,
} from '@/lib/periodo'

type Fazenda = { id: string; nome: string }

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

const COLUNAS_ENTRADA = [
  { key: 'entrada_nascimento', label: 'Nascim.' },
  { key: 'entrada_compra', label: 'Compra' },
  { key: 'entrada_desmame', label: 'Desmame' },
  { key: 'entrada_transferencia', label: 'Transf.' },
  { key: 'entrada_mudanca_categoria', label: 'Categ.' },
] as const

const COLUNAS_SAIDA = [
  { key: 'saida_morte', label: 'Morte' },
  { key: 'saida_venda', label: 'Venda' },
  { key: 'saida_desmame', label: 'Desmame' },
  { key: 'saida_transferencia', label: 'Transf.' },
  { key: 'saida_consumo_doacao', label: 'Cons/Doaç' },
  { key: 'saida_mudanca_categoria', label: 'Categ.' },
] as const

function nomeMes(mes: string) {
  const [ano, mesNum] = mes.split('-').map(Number)
  const data = new Date(ano, mesNum - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function formatarData(iso: string) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
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

export default function RelatorioMovimentacaoPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaIds, setFazendaIds] = useState<string[]>([])
  const [modoFiltro, setModoFiltro] = useState<'mes' | 'safra' | 'ano' | 'periodo'>('mes')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicio] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionado] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustom] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhas, setLinhas] = useState<RelatorioLinha[]>([])
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
  // rebanho não tem "previsão" como área — não é possível lançar
  // movimentação futura, então o estoque final nunca passa de hoje
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  }, [fazendaIds, dataInicio, dataFim])

  function alternarFazenda(id: string) {
    setFazendaIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  function alternarTodas() {
    setFazendaIds(todasSelecionadas ? [] : fazendas.map((f) => f.id))
  }

  const linhasVisiveis = linhas.filter((l) => !linhaEstaZerada(l))

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

  const totalEntradas =
    totais.entrada_nascimento +
    totais.entrada_compra +
    totais.entrada_desmame +
    totais.entrada_transferencia +
    totais.entrada_mudanca_categoria
  const totalSaidas =
    totais.saida_morte +
    totais.saida_venda +
    totais.saida_desmame +
    totais.saida_transferencia +
    totais.saida_consumo_doacao +
    totais.saida_mudanca_categoria

  const distribuicao = linhas
    .filter((l) => l.estoque_final > 0)
    .sort((a, b) => b.estoque_final - a.estoque_final)
  const totalDistribuicao = distribuicao.reduce((s, l) => s + l.estoque_final, 0)

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Relatório de movimentação de rebanho</h1>

      <div className="flex flex-wrap gap-4 mb-6 border p-4 rounded">
        <div>
          <div className="flex items-center justify-between gap-4 mb-1">
            <label className="block text-sm">
              Fazendas
              <Required />
            </label>
            <button type="button" className="text-xs text-blue-600 underline" onClick={alternarTodas}>
              {todasSelecionadas ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
          </div>
          <div className="border rounded p-2 w-56 max-h-32 overflow-y-auto space-y-1">
            {fazendas.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhuma fazenda cadastrada.</p>
            ) : (
              fazendas.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fazendaIds.includes(f.id)}
                    onChange={() => alternarFazenda(f.id)}
                  />
                  {f.nome}
                </label>
              ))
            )}
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1">Período</label>
          <div className="flex flex-wrap gap-3 mb-1 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="modoFiltro"
                checked={modoFiltro === 'mes'}
                onChange={() => setModoFiltro('mes')}
              />
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
              <input
                type="radio"
                name="modoFiltro"
                checked={modoFiltro === 'ano'}
                onChange={() => setModoFiltro('ano')}
              />
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
              className="border rounded px-3 py-2"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          ) : modoFiltro === 'safra' ? (
            <div className="flex items-center gap-2">
              <select
                className="border rounded px-3 py-2"
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
              <p className="text-sm text-gray-500">
                {formatarData(dataInicio)} até {formatarData(dataFim)}
              </p>
            </div>
          ) : modoFiltro === 'ano' ? (
            <div className="flex items-center gap-2">
              <select
                className="border rounded px-3 py-2"
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
              <p className="text-sm text-gray-500">
                {formatarData(dataInicio)} até {formatarData(dataFim)}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="date"
                max={hoje}
                className="border rounded px-3 py-2"
                value={dataInicioCustom}
                onChange={(e) => setDataInicioCustom(e.target.value)}
              />
              <span className="text-gray-500">até</span>
              <input
                type="date"
                max={hoje}
                className="border rounded px-3 py-2"
                value={dataFimCustom}
                onChange={(e) => setDataFimCustom(e.target.value)}
              />
            </div>
          )}
          {periodoInvalido && (
            <p className="text-xs text-red-600 mt-1">A data inicial não pode ser depois da data final.</p>
          )}
        </div>
      </div>

      {fazendaIds.length === 0 ? (
        <p className="text-gray-500">Selecione ao menos uma fazenda para ver o relatório.</p>
      ) : periodoInvalido ? (
        <p className="text-red-600">Corrija o período antes de continuar.</p>
      ) : loading ? (
        <p>Carregando...</p>
      ) : erro ? (
        <p className="text-red-600">Erro: {erro}</p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4 capitalize">
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Estoque inicial ({formatarData(dataInicio)})</div>
              <div className="text-2xl font-semibold">{formatQuantidade(totais.estoque_inicial)}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Entradas</div>
              <div className="text-2xl font-semibold">{formatQuantidade(totalEntradas)}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Saídas</div>
              <div className="text-2xl font-semibold">{formatQuantidade(totalSaidas)}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Estoque final ({formatarData(dataFim)})</div>
              <div className="text-2xl font-semibold">{formatQuantidade(totais.estoque_final)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6 text-sm">
            <div>
              <div className="text-gray-500">Nascimentos</div>
              <div className="font-medium">{formatQuantidade(totais.entrada_nascimento)}</div>
            </div>
            <div>
              <div className="text-gray-500">Compras</div>
              <div className="font-medium">{formatQuantidade(totais.entrada_compra)}</div>
            </div>
            <div>
              <div className="text-gray-500">Vendas</div>
              <div className="font-medium">{formatQuantidade(totais.saida_venda)}</div>
            </div>
            <div>
              <div className="text-gray-500">Mortes</div>
              <div className="font-medium">{formatQuantidade(totais.saida_morte)}</div>
            </div>
            <div>
              <div className="text-gray-500">Consumo/doação</div>
              <div className="font-medium">{formatQuantidade(totais.saida_consumo_doacao)}</div>
            </div>
            <div>
              <div className="text-gray-500">Transf. líquida</div>
              <div className="font-medium">
                {formatQuantidade(totais.entrada_transferencia - totais.saida_transferencia)}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto mb-8">
            <table className="text-sm border-collapse w-full">
              <thead>
                <tr>
                  <th rowSpan={2} className="border p-2 text-left align-bottom">
                    Categoria
                  </th>
                  <th rowSpan={2} className="border p-2 text-right align-bottom">
                    Estoque inicial
                    <div className="font-normal text-gray-400">{formatarData(dataInicio)}</div>
                  </th>
                  <th colSpan={COLUNAS_ENTRADA.length} className="border p-2 text-center">
                    Entrada
                  </th>
                  <th colSpan={COLUNAS_SAIDA.length} className="border p-2 text-center">
                    Saída
                  </th>
                  <th rowSpan={2} className="border p-2 text-right align-bottom">
                    Estoque final
                    <div className="font-normal text-gray-400">{formatarData(dataFim)}</div>
                  </th>
                </tr>
                <tr>
                  {COLUNAS_ENTRADA.map((c) => (
                    <th key={c.key} className="border p-2 text-right font-normal text-gray-600">
                      {c.label}
                    </th>
                  ))}
                  {COLUNAS_SAIDA.map((c) => (
                    <th key={c.key} className="border p-2 text-right font-normal text-gray-600">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((l) => (
                  <tr key={l.categoria_id}>
                    <td className="border p-2">{l.categoria_nome}</td>
                    <td className="border p-2 text-right">{formatQuantidade(l.estoque_inicial)}</td>
                    {COLUNAS_ENTRADA.map((c) => (
                      <td key={c.key} className="border p-2 text-right text-gray-600">
                        {l[c.key] ? formatQuantidade(l[c.key]) : ''}
                      </td>
                    ))}
                    {COLUNAS_SAIDA.map((c) => (
                      <td key={c.key} className="border p-2 text-right text-gray-600">
                        {l[c.key] ? formatQuantidade(l[c.key]) : ''}
                      </td>
                    ))}
                    <td className="border p-2 text-right font-medium">{formatQuantidade(l.estoque_final)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="border p-2">Total</td>
                  <td className="border p-2 text-right">{formatQuantidade(totais.estoque_inicial)}</td>
                  {COLUNAS_ENTRADA.map((c) => (
                    <td key={c.key} className="border p-2 text-right">
                      {formatQuantidade(totais[c.key])}
                    </td>
                  ))}
                  {COLUNAS_SAIDA.map((c) => (
                    <td key={c.key} className="border p-2 text-right">
                      {formatQuantidade(totais[c.key])}
                    </td>
                  ))}
                  <td className="border p-2 text-right">{formatQuantidade(totais.estoque_final)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <h2 className="font-semibold mb-3">Distribuição do rebanho final</h2>
          {distribuicao.length === 0 ? (
            <p className="text-gray-500">Sem estoque nas fazendas selecionadas ao final do período.</p>
          ) : (
            <ul className="space-y-2 max-w-2xl">
              {distribuicao.map((l) => {
                const pct = totalDistribuicao ? (l.estoque_final / totalDistribuicao) * 100 : 0
                return (
                  <li key={l.categoria_id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{l.categoria_nome}</span>
                      <span className="text-gray-500">
                        {formatQuantidade(l.estoque_final)} cab. ·{' '}
                        {pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-black" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
