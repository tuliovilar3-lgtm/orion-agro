'use client'

import { createContext, useContext, useEffect, useState } from 'react'
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
  // lista global de proprietários (qualquer pessoa com papel
  // PROPRIETARIO, sem vínculo por fazenda — o gado pode ser transferido
  // entre fazendas). Mesmo princípio de fazendaIds: começa com todos
  // marcados (explícito, não um "vazio implícito") — o filtro de query
  // (abaixo) já trata "todos marcados" como "sem filtro", então
  // lançamentos sem proprietário atribuído continuam aparecendo por
  // padrão sem precisar de nenhuma lógica de vazio-significa-tudo.
  proprietarios: Proprietario[]
  proprietarioIds: string[]
  setProprietarioIds: (ids: string[]) => void
  alternarProprietario: (id: string) => void
  alternarTodosProprietarios: () => void
  todosProprietariosSelecionados: boolean
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
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
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
      supabase.from('pessoa_papeis').select('pessoa:pessoas!pessoa_id(id, nome)').eq('papel', 'PROPRIETARIO'),
    ]).then(([{ data }, { data: prop }]) => {
        const lista = data || []
        setFazendas(lista)
        setProprietarios(
          ((prop || []) as any[])
            .map((r) => r.pessoa)
            .filter(Boolean)
            .sort((a: Proprietario, b: Proprietario) => a.nome.localeCompare(b.nome))
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

        const listaProp = ((prop || []) as any[]).map((r) => r.pessoa).filter(Boolean) as Proprietario[]
        const propIdsSalvos = Array.isArray(salvo?.proprietarioIds) ? (salvo!.proprietarioIds as string[]) : []
        const propIdsValidos = propIdsSalvos.filter((id) => listaProp.some((p) => p.id === id))
        setProprietarioIdsState(propIdsValidos.length > 0 ? propIdsValidos : listaProp.map((p) => p.id))
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

  // poda seleções que deixaram de existir na lista (ex.: proprietário
  // excluído do sistema)
  useEffect(() => {
    setProprietarioIdsState((prev) => {
      const podado = prev.filter((id) => proprietarios.some((p) => p.id === id))
      return podado.length === prev.length ? prev : podado
    })
  }, [proprietarios])

  function alternarProprietario(id: string) {
    setProprietarioIdsState((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  // espelha alternarTodas — alterna entre todos marcados e nenhum
  // marcado. "Nenhum marcado" não esconde lançamentos sem proprietário
  // atribuído (quem consome isso decide como tratar esse caso — ver
  // app/relatorios/page.tsx, que mostra só os sem proprietário nesse
  // estado, em vez de escondê-los).
  function alternarTodosProprietarios() {
    setProprietarioIdsState((prev) => (prev.length === proprietarios.length ? [] : proprietarios.map((p) => p.id)))
  }

  const todosProprietariosSelecionados = proprietarios.length > 0 && proprietarioIds.length === proprietarios.length
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
    alternarTodosProprietarios,
    todosProprietariosSelecionados,
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
