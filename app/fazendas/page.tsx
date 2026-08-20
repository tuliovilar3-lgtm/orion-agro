'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import SaldoInicialPanel from '@/components/fazendas/SaldoInicialPanel'
import DistribuicaoAreaPanel from '@/components/fazendas/DistribuicaoAreaPanel'
import GestaoAreasPanel from '@/components/fazendas/GestaoAreasPanel'
import AreaInicialForm from '@/components/fazendas/AreaInicialForm'
import CadastrarFazendaModal from '@/components/fazendas/CadastrarFazendaModal'
import ModuloGate from '@/components/ModuloGate'
import { formatArea, formatQuantidade } from '@/lib/format'

type Fazenda = {
  id: string
  nome: string
  localizacao: string | null
  area_ha: number | null
  ativo: boolean
}

type Aba = 'saldo' | 'area-inicial' | 'distribuicao' | 'pastos'

type EstatisticasFazenda = {
  areaPecuaria: number | null
  areaAgricultura: number | null
}

function iniciaisFazenda(nome: string) {
  const palavras = nome.trim().split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return '—'
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase()
  return (palavras[0][0] + palavras[1][0]).toUpperCase()
}

function IconLapis() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0-4-4L4 16v4Z" />
    </svg>
  )
}

function IconKebab() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="5" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="12" cy="19" r="1.2" />
    </svg>
  )
}

export default function FazendasPage() {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [configuracaoId, setConfiguracaoId] = useState<string | null>(null)
  const [controlaPasto, setControlaPasto] = useState(false)
  const [controlaSubtipoArea, setControlaSubtipoArea] = useState(false)

  const [modalAberto, setModalAberto] = useState(false)
  const [fazendaEditandoId, setFazendaEditandoId] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  const [fazendaSelecionadaId, setFazendaSelecionadaId] = useState<string | null>(null)
  const [abaSelecionada, setAbaSelecionada] = useState<Aba>('saldo')
  const [fazendaRecemCriadaId, setFazendaRecemCriadaId] = useState<string | null>(null)

  const [tipoPecuariaId, setTipoPecuariaId] = useState<string | null>(null)
  const [tipoAgriculturaId, setTipoAgriculturaId] = useState<string | null>(null)
  const [estatisticas, setEstatisticas] = useState<EstatisticasFazenda | null>(null)
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)
  const [cabecasPorFazenda, setCabecasPorFazenda] = useState<Record<string, number>>({})
  const [kebabAberto, setKebabAberto] = useState(false)
  const kebabRef = useRef<HTMLDivElement>(null)

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
    supabase
      .from('tipos_uso_area')
      .select('id, nome')
      .in('nome', ['Pecuária', 'Agricultura'])
      .then(({ data }) => {
        setTipoPecuariaId(data?.find((t) => t.nome === 'Pecuária')?.id ?? null)
        setTipoAgriculturaId(data?.find((t) => t.nome === 'Agricultura')?.id ?? null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // cabeças por fazenda (todas de uma vez, reaproveitado nos cards e na
  // barra fixa) — mesma RPC já usada no Painel (fn_resumo_rebanho_atual)
  useEffect(() => {
    if (fazendas.length === 0) {
      setCabecasPorFazenda({})
      return
    }
    let cancelado = false
    supabase
      .rpc('fn_resumo_rebanho_atual', { p_fazenda_ids: fazendas.map((f) => f.id) })
      .then(({ data }) => {
        if (cancelado) return
        const mapa: Record<string, number> = {}
        for (const l of (data || []) as { fazenda_id: string; quantidade: number }[]) {
          mapa[l.fazenda_id] = (mapa[l.fazenda_id] || 0) + l.quantidade
        }
        setCabecasPorFazenda(mapa)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendas])

  // área em Pecuária/Agricultura da fazenda selecionada, pra barra fixa —
  // mesma RPC (fn_area_por_uso) já usada em Distribuição da Área
  useEffect(() => {
    if (!fazendaSelecionadaId) {
      setEstatisticas(null)
      return
    }
    let cancelado = false
    const hoje = new Date().toISOString().slice(0, 10)
    Promise.all([
      tipoPecuariaId
        ? supabase.rpc('fn_area_por_uso', { p_fazenda_id: fazendaSelecionadaId, p_tipo_uso_id: tipoPecuariaId, p_data: hoje })
        : Promise.resolve({ data: null }),
      tipoAgriculturaId
        ? supabase.rpc('fn_area_por_uso', { p_fazenda_id: fazendaSelecionadaId, p_tipo_uso_id: tipoAgriculturaId, p_data: hoje })
        : Promise.resolve({ data: null }),
    ]).then(([pec, agr]) => {
      if (cancelado) return
      setEstatisticas({ areaPecuaria: pec.data ?? null, areaAgricultura: agr.data ?? null })
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaSelecionadaId, tipoPecuariaId, tipoAgriculturaId, statsRefreshKey])

  // avisado por DistribuicaoAreaPanel quando incorporação/desincorporação
  // ou mudança de uso alteram Área total/Pecuária/Agricultura — essa
  // barra vive fora daquele componente, sem remount ao editar lá dentro
  function handleAreaChanged() {
    setStatsRefreshKey((k) => k + 1)
    carregarFazendas()
  }

  useEffect(() => {
    if (!kebabAberto) return
    function onClickFora(e: MouseEvent) {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabAberto(false)
      }
    }
    document.addEventListener('mousedown', onClickFora)
    return () => document.removeEventListener('mousedown', onClickFora)
  }, [kebabAberto])

  function handleFazendaSalva(novaId: string) {
    setModalAberto(false)
    const eraNova = fazendaEditandoId === null
    setFazendaEditandoId(null)
    carregarFazendas().then(() => {
      if (eraNova) {
        setFazendaRecemCriadaId(novaId)
        setFazendaSelecionadaId(novaId)
      }
    })
  }

  function handleAreaInicialConcluida() {
    setFazendaRecemCriadaId(null)
    setAbaSelecionada('saldo')
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

  const fazendaSelecionada = fazendas.find((f) => f.id === fazendaSelecionadaId)

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
    <ModuloGate modulo="fazendas">
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Fazendas</h1>
      <p className="mt-1 text-sm text-text-secondary">Cadastre e acompanhe as fazendas do grupo.</p>

      <div className="mt-6 space-y-3 rounded-card border border-border bg-surface p-5">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
            Controle de rebanho por pasto
            {controlaPasto ? (
              <span className="rounded-control bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">
                Ativo
              </span>
            ) : (
              <span className="rounded-control bg-bg px-2 py-0.5 text-xs font-semibold text-text-muted">
                Não contratado
              </span>
            )}
          </p>
          <p className="text-sm text-text-secondary">
            {controlaPasto
              ? 'Habilita o cadastro e controle do rebanho por pastos.'
              : 'Recurso vendido à parte — fale com o Suporte pra contratar.'}
          </p>
        </div>

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

      <div className="mt-6 flex flex-wrap items-center gap-2.5">
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
              className={`flex min-w-[190px] items-center gap-2.5 rounded-card border px-3.5 py-2.5 text-left transition-colors ${
                fazendaSelecionadaId === f.id
                  ? 'border-brand-500 bg-brand-100'
                  : 'border-border bg-surface hover:border-brand-500/50'
              } ${!f.ativo ? 'opacity-50' : ''}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-xs font-extrabold ${
                  fazendaSelecionadaId === f.id ? 'bg-brand-500 text-white' : 'bg-brand-100 text-brand-700'
                }`}
              >
                {iniciaisFazenda(f.nome)}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="truncate text-sm font-bold text-text-primary">
                  {f.nome}
                  {!f.ativo ? ' (inativa)' : ''}
                </span>
                <span className="text-xs text-text-muted">
                  {formatArea(f.area_ha)} ha · {formatQuantidade(cabecasPorFazenda[f.id] ?? 0)} cabeças
                </span>
              </span>
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

      {fazendaSelecionadaId && fazendaSelecionada && fazendaRecemCriadaId === fazendaSelecionadaId && (
        <div className="mt-8 rounded-card border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-text-primary">{fazendaSelecionada.nome} cadastrada com sucesso</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Declare como os hectares dessa fazenda estão divididos entre os tipos de uso do solo — pode ser corrigido
            depois em "Distribuição da Área".
          </p>
          <div className="mt-4">
            <AreaInicialForm fazendaId={fazendaSelecionadaId} onSalvo={handleAreaInicialConcluida} />
          </div>
          <button
            type="button"
            className="mt-3 text-xs text-text-secondary underline"
            onClick={handleAreaInicialConcluida}
          >
            Pular por enquanto
          </button>
        </div>
      )}

      {fazendaSelecionadaId && fazendaSelecionada && fazendaRecemCriadaId !== fazendaSelecionadaId && (
        <>
          <div className="sticky top-14 z-20 mt-8 bg-bg pb-3 pt-1 md:top-0">
            <div className="flex items-stretch overflow-x-auto rounded-card border border-border bg-surface shadow-sm">
              <div className="flex min-w-[168px] items-center gap-2 border-r border-border px-5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                <span className="text-sm font-extrabold text-text-primary">{fazendaSelecionada.nome}</span>
              </div>
              <div className="min-w-[110px] border-r border-border px-5 py-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-text-muted">Área total</div>
                <div className="text-lg font-extrabold text-text-primary">
                  {formatArea(fazendaSelecionada.area_ha)} <span className="text-xs font-normal text-text-muted">ha</span>
                </div>
              </div>
              <div className="min-w-[110px] border-r border-border px-5 py-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-text-muted">Pecuária</div>
                <div className="text-lg font-extrabold text-text-primary">
                  {formatArea(estatisticas?.areaPecuaria ?? null)} <span className="text-xs font-normal text-text-muted">ha</span>
                </div>
              </div>
              <div className="min-w-[110px] border-r border-border px-5 py-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-text-muted">Agricultura</div>
                <div className="text-lg font-extrabold text-text-primary">
                  {formatArea(estatisticas?.areaAgricultura ?? null)} <span className="text-xs font-normal text-text-muted">ha</span>
                </div>
              </div>
              <div className="min-w-[110px] px-5 py-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-text-muted">Cabeças</div>
                <div className="text-lg font-extrabold text-text-primary">
                  {formatQuantidade(cabecasPorFazenda[fazendaSelecionada.id] ?? 0)}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2 px-3">
                <button
                  type="button"
                  onClick={() => {
                    setFazendaEditandoId(fazendaSelecionada.id)
                    setModalAberto(true)
                  }}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-control border border-border px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:border-brand-500 hover:bg-brand-100"
                >
                  <IconLapis />
                  Dados Cadastrais
                </button>
                <div className="relative" ref={kebabRef}>
                  <button
                    type="button"
                    title="Mais ações"
                    onClick={() => setKebabAberto((v) => !v)}
                    className={`flex h-8 w-8 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-bg ${
                      kebabAberto ? 'bg-bg text-text-primary' : ''
                    }`}
                  >
                    <IconKebab />
                  </button>
                  {kebabAberto && (
                    <div className="absolute right-0 top-9 z-30 w-44 rounded-control border border-border bg-surface p-1.5 text-sm shadow-lg">
                      <button
                        type="button"
                        className="block w-full rounded px-2.5 py-1.5 text-left text-text-primary hover:bg-bg"
                        onClick={() => {
                          setKebabAberto(false)
                          handleAlternarAtivoFazenda(fazendaSelecionada)
                        }}
                      >
                        {fazendaSelecionada.ativo ? 'Inativar' : 'Ativar'}
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        className="block w-full rounded px-2.5 py-1.5 text-left text-error hover:bg-error-bg"
                        onClick={() => {
                          setKebabAberto(false)
                          setConfirmandoExclusao(true)
                        }}
                      >
                        Excluir fazenda
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {confirmandoExclusao && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-control border border-error bg-error-bg px-4 py-3 text-sm">
                <span className="text-text-primary">
                  Excluir <strong className="text-error">{fazendaSelecionada.nome}</strong>? Essa ação não pode ser desfeita.
                </span>
                <button
                  type="button"
                  disabled={excluindo}
                  className="rounded-control bg-error px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={() => handleExcluirFazenda(fazendaSelecionada)}
                >
                  {excluindo ? 'Excluindo...' : 'Sim, excluir'}
                </button>
                <button
                  type="button"
                  className="text-xs text-text-secondary underline"
                  onClick={() => setConfirmandoExclusao(false)}
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-border pb-0">
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
                  Gestão de Áreas
                </button>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAbaSelecionada('saldo')}
                  className={`rounded-t-control border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${
                    abaSelecionada === 'saldo'
                      ? 'border-brand-500 font-semibold text-brand-500'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  Saldo Inicial
                </button>
                <button
                  type="button"
                  onClick={() => setAbaSelecionada('area-inicial')}
                  className={`rounded-t-control border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${
                    abaSelecionada === 'area-inicial'
                      ? 'border-brand-500 font-semibold text-brand-500'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  Área Inicial
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-card border border-border bg-surface p-6">
            {abaSelecionada === 'saldo' && <SaldoInicialPanel fazendaId={fazendaSelecionadaId} />}

            {abaSelecionada === 'area-inicial' && <AreaInicialForm fazendaId={fazendaSelecionadaId} />}

            {abaSelecionada === 'distribuicao' && (
              <DistribuicaoAreaPanel fazendaId={fazendaSelecionadaId} onAreaChanged={handleAreaChanged} />
            )}

            {abaSelecionada === 'pastos' && controlaPasto && <GestaoAreasPanel fazendaId={fazendaSelecionadaId} />}
          </div>
        </>
      )}
    </div>
    </ModuloGate>
  )
}
