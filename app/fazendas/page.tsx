'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatArea } from '@/lib/format'
import SaldoInicialPanel from '@/components/fazendas/SaldoInicialPanel'

type Fazenda = {
  id: string
  nome: string
  localizacao: string | null
  area_ha: number | null
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

type Modulo = {
  id: string
  fazenda_id: string
  nome: string
  ativo: boolean
  ordem: number
  sistema: boolean
}

type Pasto = {
  id: string
  modulo_id: string
  nome: string
  area_ha: number | null
  ativo: boolean
  ordem: number
  sistema: boolean
}

type Aba = 'saldo' | 'area' | 'pastos'

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

  const [nome, setNome] = useState('')
  const [localizacao, setLocalizacao] = useState('')
  const [areaHa, setAreaHa] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [configuracaoId, setConfiguracaoId] = useState<string | null>(null)
  const [controlaPasto, setControlaPasto] = useState(false)
  const [controlaSubtipoArea, setControlaSubtipoArea] = useState(false)

  const [tiposUso, setTiposUso] = useState<TipoUsoArea[]>([])
  const [subtiposUso, setSubtiposUso] = useState<SubtipoUsoArea[]>([])

  const [editandoFazendaId, setEditandoFazendaId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editLocalizacao, setEditLocalizacao] = useState('')
  const [editAreaHa, setEditAreaHa] = useState('')
  const [salvandoEdicaoFazenda, setSalvandoEdicaoFazenda] = useState(false)

  const [fazendaSelecionadaId, setFazendaSelecionadaId] = useState<string | null>(null)
  const [abaSelecionada, setAbaSelecionada] = useState<Aba>('saldo')
  const [fazendaRecemCriadaId, setFazendaRecemCriadaId] = useState<string | null>(null)

  const [dataArea, setDataArea] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhasArea, setLinhasArea] = useState<LinhaAreaInicial[]>([])
  const [loadingArea, setLoadingArea] = useState(false)
  const [salvandoArea, setSalvandoArea] = useState(false)
  const [avisoEdicaoAreaFutura, setAvisoEdicaoAreaFutura] = useState(false)

  const [modulos, setModulos] = useState<Modulo[]>([])
  const [pastos, setPastos] = useState<Pasto[]>([])
  const [loadingPastos, setLoadingPastos] = useState(false)
  const [processandoPastoId, setProcessandoPastoId] = useState<string | null>(null)
  const [novoModuloNome, setNovoModuloNome] = useState('')
  const [criandoModulo, setCriandoModulo] = useState(false)
  const [novoPastoNomePorModulo, setNovoPastoNomePorModulo] = useState<Record<string, string>>({})
  const [novoPastoAreaPorModulo, setNovoPastoAreaPorModulo] = useState<Record<string, string>>({})
  const [criandoPastoModuloId, setCriandoPastoModuloId] = useState<string | null>(null)
  const [confirmandoExclusaoModuloId, setConfirmandoExclusaoModuloId] = useState<string | null>(null)
  const [confirmandoExclusaoPastoId, setConfirmandoExclusaoPastoId] = useState<string | null>(null)

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return

    setSalvando(true)
    const { data: novaFazenda, error } = await supabase
      .from('fazendas')
      .insert({
        nome: nome.trim(),
        localizacao: localizacao.trim() || null,
        area_ha: areaHa ? parseFloat(areaHa) : null,
      })
      .select('id')
      .single()

    if (error) {
      alert('Erro ao salvar: ' + error.message)
      setSalvando(false)
    } else {
      setNome('')
      setLocalizacao('')
      setAreaHa('')
      setFazendaRecemCriadaId(novaFazenda.id)
      await carregarFazendas()
      setFazendaSelecionadaId(novaFazenda.id)
      setAbaSelecionada('area')
      setSalvando(false)
    }
  }

  function iniciarEdicaoFazenda(f: Fazenda) {
    setEditandoFazendaId(f.id)
    setEditNome(f.nome)
    setEditLocalizacao(f.localizacao || '')
    setEditAreaHa(f.area_ha != null ? String(f.area_ha) : '')
  }

  async function handleSalvarEdicaoFazenda() {
    if (!editandoFazendaId || !editNome.trim()) return
    setSalvandoEdicaoFazenda(true)
    const { error } = await supabase
      .from('fazendas')
      .update({
        nome: editNome.trim(),
        localizacao: editLocalizacao.trim() || null,
        area_ha: editAreaHa ? parseFloat(editAreaHa) : null,
      })
      .eq('id', editandoFazendaId)
    setSalvandoEdicaoFazenda(false)
    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setEditandoFazendaId(null)
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

  useEffect(() => {
    if (fazendaSelecionadaId && abaSelecionada === 'pastos') {
      carregarModulosPastos(fazendaSelecionadaId)
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

  async function carregarModulosPastos(fId: string) {
    setLoadingPastos(true)
    const { data: mods } = await supabase
      .from('modulos')
      .select('id, fazenda_id, nome, ativo, ordem, sistema')
      .eq('fazenda_id', fId)
      .order('ordem')
    const modIds = (mods || []).map((m) => m.id)
    const { data: pas } = modIds.length
      ? await supabase
          .from('pastos')
          .select('id, modulo_id, nome, area_ha, ativo, ordem, sistema')
          .in('modulo_id', modIds)
          .order('ordem')
      : { data: [] as Pasto[] }
    setModulos(mods || [])
    setPastos(pas || [])
    setLoadingPastos(false)
  }

  async function handleCriarModulo(fId: string) {
    if (!novoModuloNome.trim()) return
    setCriandoModulo(true)
    const proximaOrdem = modulos.length ? Math.max(...modulos.map((m) => m.ordem)) + 1 : 0
    const { error } = await supabase.from('modulos').insert({
      fazenda_id: fId,
      nome: novoModuloNome.trim(),
      tipo_utilizacao: 'PECUARIA',
      ordem: proximaOrdem,
    })
    if (error) {
      alert('Erro ao criar módulo: ' + error.message)
    } else {
      setNovoModuloNome('')
      await carregarModulosPastos(fId)
    }
    setCriandoModulo(false)
  }

  async function handleRenomearModulo(m: Modulo, novoNome: string) {
    if (!novoNome.trim() || novoNome.trim() === m.nome) return
    const { error } = await supabase.from('modulos').update({ nome: novoNome.trim() }).eq('id', m.id)
    if (error) {
      alert('Erro ao renomear: ' + error.message)
    } else {
      setModulos((prev) => prev.map((x) => (x.id === m.id ? { ...x, nome: novoNome.trim() } : x)))
    }
  }

  async function handleAlternarAtivoModulo(m: Modulo) {
    const ativosNaFazenda = modulos.filter((x) => x.ativo)
    if (m.ativo && ativosNaFazenda.length <= 1) return
    setProcessandoPastoId(m.id)
    const { error } = await supabase.from('modulos').update({ ativo: !m.ativo }).eq('id', m.id)
    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setModulos((prev) => prev.map((x) => (x.id === m.id ? { ...x, ativo: !x.ativo } : x)))
    }
    setProcessandoPastoId(null)
  }

  async function handleCriarPasto(moduloId: string) {
    const nome = (novoPastoNomePorModulo[moduloId] || '').trim()
    if (!nome) return
    const areaStr = novoPastoAreaPorModulo[moduloId] || ''
    setCriandoPastoModuloId(moduloId)
    const pastosDoModulo = pastos.filter((p) => p.modulo_id === moduloId)
    const proximaOrdem = pastosDoModulo.length ? Math.max(...pastosDoModulo.map((p) => p.ordem)) + 1 : 0
    const { error } = await supabase.from('pastos').insert({
      modulo_id: moduloId,
      nome,
      area_ha: areaStr ? parseFloat(areaStr) : null,
      ordem: proximaOrdem,
    })
    if (error) {
      alert('Erro ao criar pasto: ' + error.message)
    } else {
      setNovoPastoNomePorModulo((prev) => ({ ...prev, [moduloId]: '' }))
      setNovoPastoAreaPorModulo((prev) => ({ ...prev, [moduloId]: '' }))
      if (fazendaSelecionadaId) await carregarModulosPastos(fazendaSelecionadaId)
    }
    setCriandoPastoModuloId(null)
  }

  async function handleRenomearPasto(p: Pasto, novoNome: string) {
    if (!novoNome.trim() || novoNome.trim() === p.nome) return
    const { error } = await supabase.from('pastos').update({ nome: novoNome.trim() }).eq('id', p.id)
    if (error) {
      alert('Erro ao renomear: ' + error.message)
    } else {
      setPastos((prev) => prev.map((x) => (x.id === p.id ? { ...x, nome: novoNome.trim() } : x)))
    }
  }

  async function handleAtualizarAreaPasto(p: Pasto, novaAreaStr: string) {
    const novaArea = novaAreaStr ? parseFloat(novaAreaStr) : null
    if (novaArea === p.area_ha) return
    const { error } = await supabase.from('pastos').update({ area_ha: novaArea }).eq('id', p.id)
    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setPastos((prev) => prev.map((x) => (x.id === p.id ? { ...x, area_ha: novaArea } : x)))
    }
  }

  async function handleAlternarAtivoPasto(p: Pasto) {
    const ativosDoModulo = pastos.filter((x) => x.modulo_id === p.modulo_id && x.ativo)
    if (p.ativo && ativosDoModulo.length <= 1) return
    setProcessandoPastoId(p.id)
    const { error } = await supabase.from('pastos').update({ ativo: !p.ativo }).eq('id', p.id)
    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setPastos((prev) => prev.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)))
    }
    setProcessandoPastoId(null)
  }

  async function handleExcluirModulo(m: Modulo) {
    setProcessandoPastoId(m.id)
    const { error } = await supabase.from('modulos').delete().eq('id', m.id)
    if (error) {
      alert('Erro ao excluir: ' + error.message)
    } else if (fazendaSelecionadaId) {
      await carregarModulosPastos(fazendaSelecionadaId)
    }
    setConfirmandoExclusaoModuloId(null)
    setProcessandoPastoId(null)
  }

  async function handleExcluirPasto(p: Pasto) {
    setProcessandoPastoId(p.id)
    const { error } = await supabase.from('pastos').delete().eq('id', p.id)
    if (error) {
      alert('Erro ao excluir: ' + error.message)
    } else {
      setPastos((prev) => prev.filter((x) => x.id !== p.id))
    }
    setConfirmandoExclusaoPastoId(null)
    setProcessandoPastoId(null)
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

      <form
        onSubmit={handleSubmit}
        onKeyDown={bloquearEnvioPorEnter}
        className="mt-6 space-y-4 rounded-card border border-border bg-surface p-6"
      >
        <h2 className="text-sm font-semibold text-text-primary">Nova fazenda</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Nome
              <Required />
            </label>
            <input className={`w-full ${inputClass}`} value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Localização</label>
            <input
              className={`w-full ${inputClass}`}
              value={localizacao}
              onChange={(e) => setLocalizacao(e.target.value)}
              placeholder="Cidade/UF"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Área (ha)</label>
            <input
              type="number"
              step="0.01"
              className={`w-full ${inputClass}`}
              value={areaHa}
              onChange={(e) => setAreaHa(e.target.value)}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={salvando}
          className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar fazenda'}
        </button>
      </form>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-text-primary">Fazendas cadastradas</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Clique numa fazenda pra ver e editar o saldo inicial, a área inicial e os módulos/pastos dela.
      </p>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : erro ? (
        <p className="text-sm text-error">Erro: {erro}</p>
      ) : fazendas.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Comece cadastrando sua primeira fazenda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            Depois de criada, você vai declarar a área inicial por tipo de uso e o saldo inicial do rebanho dela
            antes de lançar movimentações.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {fazendas.map((f) => {
            const emEdicao = editandoFazendaId === f.id
            const selecionada = fazendaSelecionadaId === f.id
            return (
              <div
                key={f.id}
                onClick={() => !emEdicao && selecionarFazenda(f.id)}
                className={`rounded-card border p-5 transition-colors ${
                  emEdicao ? 'border-border bg-surface' : 'cursor-pointer'
                } ${selecionada ? 'border-brand-500 bg-brand-100' : 'border-border bg-surface hover:border-brand-500/50'}`}
              >
                {emEdicao ? (
                  <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-secondary">
                        Nome
                        <Required />
                      </label>
                      <input
                        className={`w-full ${inputClass}`}
                        value={editNome}
                        onChange={(e) => setEditNome(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-secondary">Localização</label>
                      <input
                        className={`w-full ${inputClass}`}
                        value={editLocalizacao}
                        onChange={(e) => setEditLocalizacao(e.target.value)}
                        placeholder="Cidade/UF"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-secondary">Área (ha)</label>
                      <input
                        type="number"
                        step="0.01"
                        className={`w-full ${inputClass}`}
                        value={editAreaHa}
                        onChange={(e) => setEditAreaHa(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={salvandoEdicaoFazenda}
                        onClick={handleSalvarEdicaoFazenda}
                        className="rounded-control bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                      >
                        {salvandoEdicaoFazenda ? 'Salvando...' : 'Salvar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditandoFazendaId(null)}
                        className="rounded-control border border-border px-3 py-1.5 text-sm text-text-primary"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-text-primary">{f.nome}</div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-brand-500 underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          iniciarEdicaoFazenda(f)
                        }}
                      >
                        Editar
                      </button>
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      {f.localizacao || 'Localização não informada'}
                      {f.area_ha ? ` · ${formatArea(f.area_ha)} ha` : ''}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
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
            <h2 className="text-sm font-semibold text-text-primary">{fazendaSelecionada.nome}</h2>

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

            {abaSelecionada === 'pastos' &&
              controlaPasto &&
              (loadingPastos ? (
                <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
              ) : (
                <div className="mt-4">
                  <p className="text-sm text-text-secondary">
                    Cada módulo roda o pastejo rotacionado entre seus pastos/talhões. A soma das áreas dos pastos
                    não pode ultrapassar a área alocada em "Pecuária" na fazenda.
                  </p>

                  <div className="mt-4 space-y-4">
                    {modulos.map((m) => {
                      const pastosDoModulo = pastos.filter((p) => p.modulo_id === m.id).sort((a, b) => a.ordem - b.ordem)
                      const ativosDoModulo = pastosDoModulo.filter((p) => p.ativo)
                      const ativosNaFazenda = modulos.filter((x) => x.ativo)
                      return (
                        <div key={m.id} className={`rounded-control border border-border p-4 ${!m.ativo ? 'opacity-60' : ''}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <input
                              className={`w-48 font-semibold ${inputClass}`}
                              defaultValue={m.nome}
                              onBlur={(e) => handleRenomearModulo(m, e.target.value)}
                            />
                            {confirmandoExclusaoModuloId === m.id ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-error">Excluir módulo "{m.nome}"?</span>
                                <button
                                  type="button"
                                  disabled={processandoPastoId === m.id}
                                  className="rounded-control bg-error px-2 py-1 font-semibold text-white disabled:opacity-50"
                                  onClick={() => handleExcluirModulo(m)}
                                >
                                  {processandoPastoId === m.id ? 'Excluindo...' : 'Sim, excluir'}
                                </button>
                                <button
                                  type="button"
                                  className="text-text-secondary underline"
                                  onClick={() => setConfirmandoExclusaoModuloId(null)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  disabled={processandoPastoId === m.id || (m.ativo && ativosNaFazenda.length <= 1)}
                                  title={m.ativo && ativosNaFazenda.length <= 1 ? 'Precisa haver ao menos um módulo ativo.' : undefined}
                                  className="text-xs text-brand-500 underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
                                  onClick={() => handleAlternarAtivoModulo(m)}
                                >
                                  {m.ativo ? 'Inativar módulo' : 'Ativar módulo'}
                                </button>
                                {!m.sistema && (
                                  <button
                                    type="button"
                                    className="text-xs text-error underline"
                                    onClick={() => setConfirmandoExclusaoModuloId(m.id)}
                                  >
                                    Excluir módulo
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <table className="mt-3 w-full border-collapse text-sm">
                            <thead>
                              <tr>
                                <th className="border border-border p-2 text-left text-text-secondary">Pasto/talhão</th>
                                <th className="border border-border p-2 text-right text-text-secondary">Área (ha)</th>
                                <th className="border border-border p-2 text-right text-text-secondary">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pastosDoModulo.map((p) => (
                                <tr key={p.id} className={!p.ativo ? 'opacity-60' : ''}>
                                  <td className="border border-border p-2">
                                    <input
                                      className={`w-full ${inputClass}`}
                                      defaultValue={p.nome}
                                      onBlur={(e) => handleRenomearPasto(p, e.target.value)}
                                    />
                                  </td>
                                  <td className="border border-border p-2 text-right">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className={`w-28 text-right ${inputClass}`}
                                      defaultValue={p.area_ha ?? ''}
                                      onBlur={(e) => handleAtualizarAreaPasto(p, e.target.value)}
                                    />
                                  </td>
                                  <td className="border border-border p-2 text-right">
                                    {confirmandoExclusaoPastoId === p.id ? (
                                      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                                        <span className="text-error">Excluir?</span>
                                        <button
                                          type="button"
                                          disabled={processandoPastoId === p.id}
                                          className="rounded-control bg-error px-2 py-1 font-semibold text-white disabled:opacity-50"
                                          onClick={() => handleExcluirPasto(p)}
                                        >
                                          {processandoPastoId === p.id ? '...' : 'Sim, excluir'}
                                        </button>
                                        <button
                                          type="button"
                                          className="text-text-secondary underline"
                                          onClick={() => setConfirmandoExclusaoPastoId(null)}
                                        >
                                          Cancelar
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-end gap-3">
                                        <button
                                          type="button"
                                          disabled={processandoPastoId === p.id || (p.ativo && ativosDoModulo.length <= 1)}
                                          title={
                                            p.ativo && ativosDoModulo.length <= 1
                                              ? 'Precisa haver ao menos um pasto ativo no módulo.'
                                              : undefined
                                          }
                                          className="text-xs text-brand-500 underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
                                          onClick={() => handleAlternarAtivoPasto(p)}
                                        >
                                          {p.ativo ? 'Inativar' : 'Ativar'}
                                        </button>
                                        {!p.sistema && (
                                          <button
                                            type="button"
                                            className="text-xs text-error underline"
                                            onClick={() => setConfirmandoExclusaoPastoId(p.id)}
                                          >
                                            Excluir
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-text-secondary">
                                Novo pasto/talhão
                                <Required />
                              </label>
                              <input
                                className={inputClass}
                                value={novoPastoNomePorModulo[m.id] || ''}
                                onChange={(e) => setNovoPastoNomePorModulo((prev) => ({ ...prev, [m.id]: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-text-secondary">Área (ha)</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className={`w-24 ${inputClass}`}
                                value={novoPastoAreaPorModulo[m.id] || ''}
                                onChange={(e) => setNovoPastoAreaPorModulo((prev) => ({ ...prev, [m.id]: e.target.value }))}
                              />
                            </div>
                            <button
                              type="button"
                              disabled={criandoPastoModuloId === m.id}
                              onClick={() => handleCriarPasto(m.id)}
                              className="rounded-control border border-border px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
                            >
                              Adicionar pasto
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-border pt-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-secondary">
                        Novo módulo
                        <Required />
                      </label>
                      <input className={inputClass} value={novoModuloNome} onChange={(e) => setNovoModuloNome(e.target.value)} />
                    </div>
                    <button
                      type="button"
                      disabled={criandoModulo}
                      onClick={() => handleCriarModulo(fazendaSelecionadaId)}
                      className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
                    >
                      {criandoModulo ? 'Salvando...' : 'Adicionar módulo'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
