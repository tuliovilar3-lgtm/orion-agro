'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import SaldoInicialPanel from '@/components/fazendas/SaldoInicialPanel'
import DistribuicaoAreaPanel from '@/components/fazendas/DistribuicaoAreaPanel'
import GestaoAreasPanel from '@/components/fazendas/GestaoAreasPanel'
import AreaInicialForm from '@/components/fazendas/AreaInicialForm'
import CadastrarFazendaModal from '@/components/fazendas/CadastrarFazendaModal'
import ModuloGate from '@/components/ModuloGate'

type Fazenda = {
  id: string
  nome: string
  localizacao: string | null
  area_ha: number | null
  ativo: boolean
}

type Aba = 'saldo' | 'distribuicao' | 'pastos'

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <ModuloGate modulo="fazendas">
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
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

            {abaSelecionada === 'saldo' && (
              <div className="mt-4">
                <SaldoInicialPanel fazendaId={fazendaSelecionadaId} />
              </div>
            )}

            {abaSelecionada === 'distribuicao' && <DistribuicaoAreaPanel fazendaId={fazendaSelecionadaId} />}

            {abaSelecionada === 'pastos' && controlaPasto && <GestaoAreasPanel fazendaId={fazendaSelecionadaId} />}
          </div>
        </>
      )}
    </div>
    </ModuloGate>
  )
}
