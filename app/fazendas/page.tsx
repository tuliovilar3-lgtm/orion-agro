'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatArea } from '@/lib/format'
import SaldoInicialPanel from '@/components/fazendas/SaldoInicialPanel'
import DistribuicaoAreaPanel from '@/components/fazendas/DistribuicaoAreaPanel'
import ModulosPastosPanel from '@/components/fazendas/ModulosPastosPanel'
import CadastrarFazendaModal from '@/components/fazendas/CadastrarFazendaModal'

type Fazenda = {
  id: string
  nome: string
  localizacao: string | null
  area_ha: number | null
  ativo: boolean
}

type TipoUsoArea = { id: string; nome: string }
type SubtipoUsoArea = { id: string; tipo_uso_id: string; nome: string }

type LinhaAreaInicial = {
  tipoUsoId: string
  tipoUsoNome: string
  existingId: string | null
  areaHa: string
}

type ChecagemEdicaoArea = {
  tem_movimentacoes_futuras: boolean
  saldo_ficaria_negativo: boolean
  data_saldo_negativo: string | null
  tipo_uso_saldo_negativo: string | null
  saldo_minimo: number | null
}

type Aba = 'saldo' | 'area' | 'distribuicao' | 'pastos'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
  )
}

const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'

export default function FazendasPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [configuracaoId, setConfiguracaoId] = useState<string | null>(null)
  const [controlaPasto, setControlaPasto] = useState(false)
  const [controlaSubtipoArea, setControlaSubtipoArea] = useState(false)

  const [tiposUso, setTiposUso] = useState<TipoUsoArea[]>([])
  const [subtiposUso, setSubtiposUso] = useState<SubtipoUsoArea[]>([])

  const [modalAberto, setModalAberto] = useState(false)
  const [fazendaEditandoId, setFazendaEditandoId] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  const [fazendaSelecionadaId, setFazendaSelecionadaId] = useState<string | null>(null)
  const [abaSelecionada, setAbaSelecionada] = useState<Aba>('saldo')
  const [fazendaRecemCriadaId, setFazendaRecemCriadaId] = useState<string | null>(null)

  const [dataArea, setDataArea] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhasArea, setLinhasArea] = useState<LinhaAreaInicial[]>([])
  const [loadingArea, setLoadingArea] = useState(false)
  const [salvandoArea, setSalvandoArea] = useState(false)
  const [avisoEdicaoAreaFutura, setAvisoEdicaoAreaFutura] = useState(false)

  const supabase = createClient()

  async function carregarFazendas() {
    setLoading(true)
    const { data, error } = await supabase.from('fazendas').select('*').order('nome')
    if (error) {
      setErro(error.message)
    } else {
      setFazendas(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    carregarFazendas()
    supabase
      .from('tipos_uso_area')
      .select('id, nome')
      .order('ordem')
      .then(({ data }) => setTiposUso(data || []))
    supabase
      .from('subtipos_uso_area')
      .select('id, tipo_uso_id, nome')
      .eq('nome', 'Geral')
      .then(({ data }) => setSubtiposUso(data || []))
    supabase
      .from('configuracoes')
      .select('id, controla_pasto, controla_subtipo_area')
      .single()
      .then(({ data }) => {
        if (data) {
          setConfiguracaoId(data.id)
          setControlaPasto(data.controla_pasto)
          setControlaSubtipoArea(data.controla_subtipo_area)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subtipoGeralPorTipoUso = Object.fromEntries(subtiposUso.map((s) => [s.tipo_uso_id, s.id]))

  function handleFazendaSalva(novaId: string) {
    setModalAberto(false)
    const eraNova = fazendaEditandoId === null
    setFazendaEditandoId(null)
    carregarFazendas().then(() => {
      if (eraNova) {
        setFazendaRecemCriadaId(novaId)
        setFazendaSelecionadaId(novaId)
        setAbaSelecionada('area')
      }
    })
  }

  async function handleAlternarAtivoFazenda(f: Fazenda) {
    const { error } = await supabase.from('fazendas').update({ ativo: !f.ativo }).eq('id', f.id)
    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setFazendas((prev) => prev.map((x) => (x.id === f.id ? { ...x, ativo: !x.ativo } : x)))
    }
  }

  async function handleExcluirFazenda(f: Fazenda) {
    setExcluindo(true)
    const { error } = await supabase.from('fazendas').delete().eq('id', f.id)
    setExcluindo(false)
    setConfirmandoExclusao(false)
    if (error) {
      alert(error.message)
    } else {
      setFazendaSelecionadaId(null)
      await carregarFazendas()
    }
  }

  function selecionarFazenda(fId: string) {
    if (fazendaSelecionadaId === fId) {
      setFazendaSelecionadaId(null)
      return
    }
    setFazendaSelecionadaId(fId)
    setAbaSelecionada('saldo')
  }

  async function carregarLinhasArea(fId: string) {
    setLoadingArea(true)
    const [{ data: tipos }, { data: existentes }] = await Promise.all([
      supabase.from('tipos_uso_area').select('id, nome').order('ordem'),
      supabase
        .from('movimentacoes_area')
        .select('id, tipo_uso_destino_id, area_ha, data')
        .eq('fazenda_id', fId)
        .eq('tipo', 'SALDO_INICIAL'),
    ])

    const mapaExistentes = new Map((existentes || []).map((e) => [e.tipo_uso_destino_id, e]))
    const novasLinhas: LinhaAreaInicial[] = (tipos || []).map((t) => {
      const existente = mapaExistentes.get(t.id)
      return {
        tipoUsoId: t.id,
        tipoUsoNome: t.nome,
        existingId: existente ? existente.id : null,
        areaHa: existente ? String(existente.area_ha) : '',
      }
    })
    setLinhasArea(novasLinhas)

    const primeiraData = (existentes || [])[0]?.data
    setDataArea(primeiraData || new Date().toISOString().slice(0, 10))

    setLoadingArea(false)
  }

  useEffect(() => {
    if (fazendaSelecionadaId && abaSelecionada === 'area') {
      carregarLinhasArea(fazendaSelecionadaId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaSelecionadaId, abaSelecionada])

  function atualizarLinhaArea(tipoUsoId: string, valor: string) {
    setLinhasArea((prev) => prev.map((l) => (l.tipoUsoId === tipoUsoId ? { ...l, areaHa: valor } : l)))
  }

  async function handleSalvarAreaInicialClick() {
    if (!fazendaSelecionadaId) return

    const linhasExistentes = linhasArea.filter((l) => l.existingId)
    if (linhasExistentes.length > 0) {
      setSalvandoArea(true)
      const resultados = await Promise.all(
        linhasExistentes.map((l) =>
          supabase.rpc('fn_checar_edicao_area', {
            p_id: l.existingId,
            p_fazenda_id: fazendaSelecionadaId,
            p_tipo: 'SALDO_INICIAL',
            p_tipo_uso_origem_id: null,
            p_tipo_uso_destino_id: l.tipoUsoId,
            p_data: dataArea,
            p_area_ha: l.areaHa ? parseFloat(l.areaHa) : 0,
          })
        )
      )
      setSalvandoArea(false)

      for (const { data: check, error } of resultados) {
        if (error) {
          alert('Erro ao validar edição: ' + error.message)
          return
        }
        const resultado: ChecagemEdicaoArea | undefined = Array.isArray(check) ? check[0] : check
        if (resultado?.saldo_ficaria_negativo) {
          alert(
            `Não é possível salvar: a área de ${resultado.tipo_uso_saldo_negativo} ficaria negativa (${resultado.saldo_minimo}) em ${resultado.data_saldo_negativo}.`
          )
          return
        }
      }

      const temFuturas = resultados.some((r) => {
        const resultado: ChecagemEdicaoArea | undefined = Array.isArray(r.data) ? r.data[0] : r.data
        return resultado?.tem_movimentacoes_futuras
      })
      if (temFuturas) {
        setAvisoEdicaoAreaFutura(true)
        return
      }
    }

    await executarSalvarAreaInicial()
  }

  async function executarSalvarAreaInicial() {
    if (!fazendaSelecionadaId) return
    setAvisoEdicaoAreaFutura(false)
    setSalvandoArea(true)

    for (const linha of linhasArea) {
      const areaNum = linha.areaHa ? parseFloat(linha.areaHa) : 0
      if (areaNum > 0) {
        if (linha.existingId) {
          const { error } = await supabase
            .from('movimentacoes_area')
            .update({ area_ha: areaNum, data: dataArea })
            .eq('id', linha.existingId)
          if (error) {
            alert('Erro ao salvar: ' + error.message)
            setSalvandoArea(false)
            return
          }
        } else {
          const { error } = await supabase.from('movimentacoes_area').insert({
            fazenda_id: fazendaSelecionadaId,
            tipo: 'SALDO_INICIAL',
            tipo_uso_destino_id: linha.tipoUsoId,
            subtipo_uso_destino_id: subtipoGeralPorTipoUso[linha.tipoUsoId],
            area_ha: areaNum,
            data: dataArea,
          })
          if (error) {
            alert('Erro ao salvar: ' + error.message)
            setSalvandoArea(false)
            return
          }
        }
      } else if (linha.existingId) {
        const { error } = await supabase.from('movimentacoes_area').delete().eq('id', linha.existingId)
        if (error) {
          alert('Erro ao excluir: ' + error.message)
          setSalvandoArea(false)
          return
        }
      }
    }

    await carregarLinhasArea(fazendaSelecionadaId)
    setSalvandoArea(false)
  }

  const totalArea = linhasArea.reduce((s, l) => s + (parseFloat(l.areaHa) || 0), 0)
  const fazendaSelecionada = fazendas.find((f) => f.id === fazendaSelecionadaId)

  async function handleToggleControlaPasto() {
    if (!configuracaoId) return
    const novoValor = !controlaPasto
    setControlaPasto(novoValor)
    const { error } = await supabase.from('configuracoes').update({ controla_pasto: novoValor }).eq('id', configuracaoId)
    if (error) {
      alert('Erro ao atualizar: ' + error.message)
      setControlaPasto(!novoValor)
    }
  }

  async function handleToggleControlaSubtipoArea() {
    if (!configuracaoId) return
    const novoValor = !controlaSubtipoArea
    setControlaSubtipoArea(novoValor)
    const { error } = await supabase
      .from('configuracoes')
      .update({ controla_subtipo_area: novoValor })
      .eq('id', configuracaoId)
    if (error) {
      alert('Erro ao atualizar: ' + error.message)
      setControlaSubtipoArea(!novoValor)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Fazendas</h1>
      <p className="mt-1 text-sm text-text-secondary">Cadastre e acompanhe as fazendas do grupo.</p>

      <div className="mt-6 space-y-3 rounded-card border border-border bg-surface p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <input
            type="checkbox"
            className="accent-brand-500"
            checked={controlaPasto}
            disabled={!configuracaoId}
            onChange={handleToggleControlaPasto}
          />
          Controle de rebanho por pasto
        </label>
        <p className="text-sm text-text-secondary">Habilita o cadastro e controle do rebanho por pastos.</p>

        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <input
            type="checkbox"
            className="accent-brand-500"
            checked={controlaSubtipoArea}
            disabled={!configuracaoId}
            onChange={handleToggleControlaSubtipoArea}
          />
          Controle de subtipo de uso de área
        </label>
        <p className="text-sm text-text-secondary">
          Habilita detalhar Pecuária e Agricultura por subtipo (ex.: Corte/Leite, Soja/Milho) em Gestão de Áreas.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {loading ? (
          <p className="text-sm text-text-secondary">Carregando...</p>
        ) : erro ? (
          <p className="text-sm text-error">Erro: {erro}</p>
        ) : (
          fazendas.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => selecionarFazenda(f.id)}
              className={`rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
                fazendaSelecionadaId === f.id
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-border bg-surface text-text-primary hover:border-brand-500/50'
              } ${!f.ativo ? 'opacity-50' : ''}`}
            >
              {f.nome}
              {!f.ativo ? ' (inativa)' : ''}
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => {
            setFazendaEditandoId(null)
            setModalAberto(true)
          }}
          className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover"
        >
          + Nova Fazenda
        </button>
      </div>

      {!loading && !erro && fazendas.length === 0 && (
        <div className="mt-6 rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Comece cadastrando sua primeira fazenda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Depois de criada, você vai declarar a área inicial por tipo de uso e o saldo inicial do rebanho dela
            antes de lançar movimentações.
          </p>
        </div>
      )}

      {modalAberto && (
        <CadastrarFazendaModal
          fazendaId={fazendaEditandoId || undefined}
          onClose={() => setModalAberto(false)}
          onSaved={handleFazendaSalva}
        />
      )}

      {fazendaSelecionadaId && fazendaSelecionada && (
        <>
          <div className="mt-8 flex flex-wrap gap-1.5 border-b border-border pb-0">
            <button
              type="button"
              onClick={() => setAbaSelecionada('saldo')}
              className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                abaSelecionada === 'saldo'
                  ? 'border-brand-500 font-semibold text-brand-500'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Saldo Inicial
            </button>
            <button
              type="button"
              onClick={() => setAbaSelecionada('area')}
              className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                abaSelecionada === 'area'
                  ? 'border-brand-500 font-semibold text-brand-500'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Área Inicial
            </button>
            <button
              type="button"
              onClick={() => setAbaSelecionada('distribuicao')}
              className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                abaSelecionada === 'distribuicao'
                  ? 'border-brand-500 font-semibold text-brand-500'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Distribuição da Área
            </button>
            {controlaPasto && (
              <button
                type="button"
                onClick={() => setAbaSelecionada('pastos')}
                className={`rounded-t-control border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                  abaSelecionada === 'pastos'
                    ? 'border-brand-500 font-semibold text-brand-500'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                Módulos e Pastos
              </button>
            )}
          </div>

          <div className="mt-5 rounded-card border border-border bg-surface p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">{fazendaSelecionada.nome}</h2>
              {confirmandoExclusao ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-error">Excluir "{fazendaSelecionada.nome}"?</span>
                  <button
                    type="button"
                    disabled={excluindo}
                    className="rounded-control bg-error px-2 py-1 font-semibold text-white disabled:opacity-50"
                    onClick={() => handleExcluirFazenda(fazendaSelecionada)}
                  >
                    {excluindo ? 'Excluindo...' : 'Sim, excluir'}
                  </button>
                  <button type="button" className="text-text-secondary underline" onClick={() => setConfirmandoExclusao(false)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="text-brand-500 underline"
                    onClick={() => {
                      setFazendaEditandoId(fazendaSelecionada.id)
                      setModalAberto(true)
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="text-brand-500 underline"
                    onClick={() => handleAlternarAtivoFazenda(fazendaSelecionada)}
                  >
                    {fazendaSelecionada.ativo ? 'Inativar' : 'Ativar'}
                  </button>
                  <button type="button" className="text-error underline" onClick={() => setConfirmandoExclusao(true)}>
                    Excluir
                  </button>
                </div>
              )}
            </div>

            {fazendaRecemCriadaId === fazendaSelecionadaId && (
              <div className="mt-3 rounded-control border border-brand-500 bg-brand-100 px-4 py-3 text-sm text-text-primary">
                Fazenda cadastrada com sucesso. Declare a área inicial e o saldo inicial do rebanho antes de lançar
                movimentações.
              </div>
            )}

            {abaSelecionada === 'saldo' && (
              <div className="mt-4">
                <SaldoInicialPanel fazendaId={fazendaSelecionadaId} />
              </div>
            )}

            {abaSelecionada === 'area' &&
              (loadingArea ? (
                <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
              ) : (
                <div className="mt-4">
                  <p className="text-sm text-text-secondary">
                    Declare como os hectares dessa fazenda estão divididos entre os tipos de uso do solo. Pode ser
                    corrigido depois aqui ou em "Distribuição da Área".
                  </p>

                  <div className="mt-4">
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">Data de referência</label>
                    <input type="date" className={inputClass} value={dataArea} onChange={(e) => setDataArea(e.target.value)} />
                  </div>

                  <div className="mt-4 overflow-x-auto rounded-card border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-text-secondary">
                          <th className="p-2.5 font-medium">Tipo de uso</th>
                          <th className="p-2.5 text-right font-medium">Área (ha)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhasArea.map((l) => (
                          <tr key={l.tipoUsoId} className="border-b border-border last:border-0">
                            <td className="p-2.5 text-text-primary">{l.tipoUsoNome}</td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className={`w-28 text-right ${inputClass}`}
                                value={l.areaHa}
                                onChange={(e) => atualizarLinhaArea(l.tipoUsoId, e.target.value)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold">
                          <td className="p-2.5 text-text-primary">Total</td>
                          <td
                            className={`p-2.5 text-right tabular-nums ${
                              fazendaSelecionada.area_ha != null && totalArea > fazendaSelecionada.area_ha
                                ? 'text-error'
                                : 'text-text-primary'
                            }`}
                          >
                            {formatArea(round2(totalArea))} ha
                            {fazendaSelecionada.area_ha != null ? ` / ${formatArea(fazendaSelecionada.area_ha)} ha` : ''}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {avisoEdicaoAreaFutura ? (
                    <div className="mt-4 rounded-control border border-warning bg-warning-bg p-3 text-sm">
                      <p className="mb-2 text-text-primary">
                        Existem mudanças de uso posteriores usando um ou mais desses tipos de uso. Confirma a
                        edição mesmo assim?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-control border border-border px-4 py-2 text-text-primary"
                          onClick={() => setAvisoEdicaoAreaFutura(false)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={salvandoArea}
                          className="rounded-control bg-warning px-4 py-2 font-semibold text-white disabled:opacity-50"
                          onClick={executarSalvarAreaInicial}
                        >
                          {salvandoArea ? 'Salvando...' : 'Confirmar edição'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <button
                        type="button"
                        disabled={salvandoArea}
                        onClick={handleSalvarAreaInicialClick}
                        className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
                      >
                        {salvandoArea ? 'Salvando...' : 'Salvar área inicial'}
                      </button>
                    </div>
                  )}
                </div>
              ))}

            {abaSelecionada === 'distribuicao' && <DistribuicaoAreaPanel fazendaId={fazendaSelecionadaId} />}

            {abaSelecionada === 'pastos' && controlaPasto && <ModulosPastosPanel fazendaId={fazendaSelecionadaId} />}
          </div>
        </>
      )}
    </div>
  )
}
