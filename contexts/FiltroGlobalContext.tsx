'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { anoCalendarioAtual, anoInicioSafraAtual, periodoAno, periodoSafra, ultimoDiaDoMes } from '@/lib/periodo'

type Fazenda = { id: string; nome: string }
type Proprietario = { id: string; nome: string }
type ModoFiltro = 'mes' | 'safra' | 'ano' | 'periodo'

type FiltroGlobalValue = {
  fazendas: Fazenda[]
  fazendaIds: string[]
  setFazendaIds: (ids: string[]) => void
  alternarFazenda: (id: string) => void
  alternarTodas: () => void
  todasSelecionadas: boolean
  // proprietários vinculados às fazendas atualmente selecionadas (união,
  // sem duplicar quem está em mais de uma). proprietarioIds vazio =
  // "todos" (sem filtro) — diferente de fazendaIds, onde vazio filtraria
  // tudo fora, já que proprietário é sempre opcional numa movimentação
  // (a maioria não tem nenhum atribuído) e não faria sentido esconder
  // esses lançamentos por padrão.
  proprietarios: Proprietario[]
  proprietarioIds: string[]
  setProprietarioIds: (ids: string[]) => void
  alternarProprietario: (id: string) => void
  modoFiltro: ModoFiltro
  setModoFiltro: (m: ModoFiltro) => void
  mes: string
  setMes: (m: string) => void
  safraAnoInicio: number
  setSafraAnoInicio: (n: number) => void
  anoCalendarioSelecionado: number
  setAnoCalendarioSelecionado: (n: number) => void
  dataInicioCustom: string
  setDataInicioCustom: (d: string) => void
  dataFimCustom: string
  setDataFimCustom: (d: string) => void
  dataInicio: string
  dataFim: string
  periodoInvalido: boolean
}

const FiltroGlobalContext = createContext<FiltroGlobalValue | null>(null)

const STORAGE_KEY = 'orion.filtroGlobal'

// filtro de fazendas + período compartilhado entre Painel, Relatório de
// Lotação, Relatórios de Movimentações e Resumo de Movimentação — antes
// cada página reimplementava esse estado isoladamente, então trocar de
// fazenda/período numa tela exigia repetir a escolha ao navegar pra outra
export function FiltroGlobalProvider({ children }: { children: React.ReactNode }) {
  const [fazendas, setFazendas] = useState<Fazenda[]>([])
  const [fazendaIds, setFazendaIdsState] = useState<string[]>([])
  // dados crus de fazenda_proprietarios (todas, sem filtro) — a lista
  // exposta (proprietarios) é derivada disso cruzando com fazendaIds
  const [fazendaProprietarios, setFazendaProprietarios] = useState<{ fazenda_id: string; pessoa_id: string; nome: string }[]>([])
  const [proprietarioIds, setProprietarioIdsState] = useState<string[]>([])
  const [modoFiltro, setModoFiltroState] = useState<ModoFiltro>('safra')
  const [mes, setMesState] = useState(() => new Date().toISOString().slice(0, 7))
  const [safraAnoInicio, setSafraAnoInicioState] = useState(() => anoInicioSafraAtual())
  const [anoCalendarioSelecionado, setAnoCalendarioSelecionadoState] = useState(() => anoCalendarioAtual())
  const [dataInicioCustom, setDataInicioCustomState] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [dataFimCustom, setDataFimCustomState] = useState(() => new Date().toISOString().slice(0, 10))
  const [hidratado, setHidratado] = useState(false)

  const supabase = createClient()

  // carrega a lista de fazendas uma única vez e aplica a seleção salva —
  // se nada foi salvo ainda (primeira visita), começa com todas marcadas,
  // mesmo comportamento que cada página já tinha isoladamente
  useEffect(() => {
    Promise.all([
      supabase.from('fazendas').select('id, nome').order('nome'),
      supabase.from('fazenda_proprietarios').select('fazenda_id, pessoa:pessoas!pessoa_id(id, nome)'),
    ]).then(([{ data }, { data: fp }]) => {
        const lista = data || []
        setFazendas(lista)
        setFazendaProprietarios(
          ((fp || []) as any[])
            .filter((r) => r.pessoa)
            .map((r) => ({ fazenda_id: r.fazenda_id, pessoa_id: r.pessoa.id, nome: r.pessoa.nome }))
        )

        let salvo: Record<string, unknown> | null = null
        try {
          salvo = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
        } catch {
          salvo = null
        }

        const idsSalvos = Array.isArray(salvo?.fazendaIds) ? (salvo!.fazendaIds as string[]) : []
        const idsValidos = idsSalvos.filter((id) => lista.some((f) => f.id === id))
        setFazendaIdsState(idsValidos.length > 0 ? idsValidos : lista.map((f) => f.id))

        if (Array.isArray(salvo?.proprietarioIds)) setProprietarioIdsState(salvo!.proprietarioIds as string[])
        if (typeof salvo?.modoFiltro === 'string') setModoFiltroState(salvo.modoFiltro as ModoFiltro)
        if (typeof salvo?.mes === 'string') setMesState(salvo.mes)
        if (typeof salvo?.safraAnoInicio === 'number') setSafraAnoInicioState(salvo.safraAnoInicio)
        if (typeof salvo?.anoCalendarioSelecionado === 'number') setAnoCalendarioSelecionadoState(salvo.anoCalendarioSelecionado)
        if (typeof salvo?.dataInicioCustom === 'string') setDataInicioCustomState(salvo.dataInicioCustom)
        if (typeof salvo?.dataFimCustom === 'string') setDataFimCustomState(salvo.dataFimCustom)

        setHidratado(true)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // persiste qualquer mudança feita depois da hidratação inicial — nunca
  // antes dela, pra não sobrescrever o que acabou de ser lido do storage
  useEffect(() => {
    if (!hidratado) return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        fazendaIds,
        proprietarioIds,
        modoFiltro,
        mes,
        safraAnoInicio,
        anoCalendarioSelecionado,
        dataInicioCustom,
        dataFimCustom,
      })
    )
  }, [
    hidratado,
    fazendaIds,
    proprietarioIds,
    modoFiltro,
    mes,
    safraAnoInicio,
    anoCalendarioSelecionado,
    dataInicioCustom,
    dataFimCustom,
  ])

  function alternarFazenda(id: string) {
    setFazendaIdsState((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  function alternarTodas() {
    setFazendaIdsState((prev) => (prev.length === fazendas.length ? [] : fazendas.map((f) => f.id)))
  }

  const todasSelecionadas = fazendas.length > 0 && fazendaIds.length === fazendas.length

  // união dos proprietários vinculados às fazendas selecionadas — quem
  // está em mais de uma fazenda aparece uma vez só
  const proprietarios = useMemo(() => {
    const porId = new Map<string, string>()
    for (const fp of fazendaProprietarios) {
      if (fazendaIds.includes(fp.fazenda_id)) porId.set(fp.pessoa_id, fp.nome)
    }
    return [...porId.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [fazendaProprietarios, fazendaIds])

  // poda seleções que deixaram de existir na lista atual (ex.: usuário
  // desmarcou a fazenda cujo proprietário estava selecionado)
  useEffect(() => {
    setProprietarioIdsState((prev) => {
      const podado = prev.filter((id) => proprietarios.some((p) => p.id === id))
      return podado.length === prev.length ? prev : podado
    })
  }, [proprietarios])

  function alternarProprietario(id: string) {
    setProprietarioIdsState((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }
  const hoje = new Date().toISOString().slice(0, 10)
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

  const value: FiltroGlobalValue = {
    fazendas,
    fazendaIds,
    setFazendaIds: setFazendaIdsState,
    alternarFazenda,
    alternarTodas,
    todasSelecionadas,
    proprietarios,
    proprietarioIds,
    setProprietarioIds: setProprietarioIdsState,
    alternarProprietario,
    modoFiltro,
    setModoFiltro: setModoFiltroState,
    mes,
    setMes: setMesState,
    safraAnoInicio,
    setSafraAnoInicio: setSafraAnoInicioState,
    anoCalendarioSelecionado,
    setAnoCalendarioSelecionado: setAnoCalendarioSelecionadoState,
    dataInicioCustom,
    setDataInicioCustom: setDataInicioCustomState,
    dataFimCustom,
    setDataFimCustom: setDataFimCustomState,
    dataInicio,
    dataFim,
    periodoInvalido,
  }

  return <FiltroGlobalContext.Provider value={value}>{children}</FiltroGlobalContext.Provider>
}

export function useFiltroGlobal() {
  const ctx = useContext(FiltroGlobalContext)
  if (!ctx) throw new Error('useFiltroGlobal precisa ser usado dentro de FiltroGlobalProvider')
  return ctx
}
