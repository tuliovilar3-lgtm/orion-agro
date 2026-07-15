'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatArea } from '@/lib/format'

type Fazenda = {
  id: string
  nome: string
  localizacao: string | null
  area_ha: number | null
}

type TipoUsoArea = { id: string; nome: string }

type LinhaAreaInicial = {
  tipoUsoId: string
  tipoUsoNome: string
  existingId: string | null
  areaHa: string
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

  const [tiposUso, setTiposUso] = useState<TipoUsoArea[]>([])
  const [fazendaAreaExpandidaId, setFazendaAreaExpandidaId] = useState<string | null>(null)
  const [fazendaRecemCriadaId, setFazendaRecemCriadaId] = useState<string | null>(null)
  const [dataArea, setDataArea] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhasArea, setLinhasArea] = useState<LinhaAreaInicial[]>([])
  const [loadingArea, setLoadingArea] = useState(false)
  const [salvandoArea, setSalvandoArea] = useState(false)

  const [fazendaPastoExpandidaId, setFazendaPastoExpandidaId] = useState<string | null>(null)
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
      .from('configuracoes')
      .select('id, controla_pasto')
      .single()
      .then(({ data }) => {
        if (data) {
          setConfiguracaoId(data.id)
          setControlaPasto(data.controla_pasto)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      await abrirAreaInicial(novaFazenda.id)
      setSalvando(false)
    }
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

  async function abrirAreaInicial(fId: string) {
    if (fazendaAreaExpandidaId === fId) {
      setFazendaAreaExpandidaId(null)
      return
    }
    setFazendaAreaExpandidaId(fId)
    await carregarLinhasArea(fId)
  }

  function atualizarLinhaArea(tipoUsoId: string, valor: string) {
    setLinhasArea((prev) => prev.map((l) => (l.tipoUsoId === tipoUsoId ? { ...l, areaHa: valor } : l)))
  }

  async function handleSalvarAreaInicial() {
    if (!fazendaAreaExpandidaId) return
    setSalvandoArea(true)

    for (const linha of linhasArea) {
      const areaNum = linha.areaHa ? parseFloat(linha.areaHa) : 0
      if (areaNum > 0) {
        if (linha.existingId) {
          await supabase
            .from('movimentacoes_area')
            .update({ area_ha: areaNum, data: dataArea })
            .eq('id', linha.existingId)
        } else {
          await supabase.from('movimentacoes_area').insert({
            fazenda_id: fazendaAreaExpandidaId,
            tipo: 'SALDO_INICIAL',
            tipo_uso_destino_id: linha.tipoUsoId,
            area_ha: areaNum,
            data: dataArea,
          })
        }
      } else if (linha.existingId) {
        await supabase.from('movimentacoes_area').delete().eq('id', linha.existingId)
      }
    }

    await carregarLinhasArea(fazendaAreaExpandidaId)
    setSalvandoArea(false)
  }

  const totalArea = linhasArea.reduce((s, l) => s + (parseFloat(l.areaHa) || 0), 0)
  const fazendaExpandida = fazendas.find((f) => f.id === fazendaAreaExpandidaId)

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

  async function abrirPastos(fId: string) {
    if (fazendaPastoExpandidaId === fId) {
      setFazendaPastoExpandidaId(null)
      return
    }
    setFazendaPastoExpandidaId(fId)
    await carregarModulosPastos(fId)
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
      if (fazendaPastoExpandidaId) await carregarModulosPastos(fazendaPastoExpandidaId)
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
    } else if (fazendaPastoExpandidaId) {
      await carregarModulosPastos(fazendaPastoExpandidaId)
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

  const fazendaPastoExpandida = fazendas.find((f) => f.id === fazendaPastoExpandidaId)

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Fazendas</h1>
      <p className="mt-1 text-sm text-text-secondary">Cadastre e acompanhe as fazendas do grupo.</p>

      <div className="mt-6 rounded-card border border-border bg-surface p-5">
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
        <p className="mt-1 text-sm text-text-secondary">
          Habilita o cadastro e controle do rebanho por pastos.
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
            <input
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Localização</label>
            <input
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
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
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
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
          {fazendas.map((f) => (
            <div key={f.id} className="rounded-card border border-border bg-surface p-5">
              <div className="font-semibold text-text-primary">{f.nome}</div>
              <div className="mt-1 text-sm text-text-secondary">
                {f.localizacao || 'Localização não informada'}
                {f.area_ha ? ` · ${formatArea(f.area_ha)} ha` : ''}
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-sm text-brand-500 underline"
                  onClick={() => abrirAreaInicial(f.id)}
                >
                  {fazendaAreaExpandidaId === f.id ? 'Fechar área inicial' : 'Área inicial'}
                </button>
                {controlaPasto && (
                  <button
                    type="button"
                    className="text-sm text-brand-500 underline"
                    onClick={() => abrirPastos(f.id)}
                  >
                    {fazendaPastoExpandidaId === f.id ? 'Fechar pastos' : 'Módulos e pastos'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {fazendaAreaExpandidaId && fazendaExpandida && (
        <div className="mt-6 rounded-card border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-text-primary">Área inicial — {fazendaExpandida.nome}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Declare como os hectares dessa fazenda estão divididos entre os tipos de uso do solo. Pode ser
            corrigido depois em "Gestão de áreas".
          </p>

          {fazendaRecemCriadaId === fazendaAreaExpandidaId && (
            <div className="mt-4 rounded-control border border-brand-500 bg-brand-100 px-4 py-3 text-sm text-text-primary">
              Fazenda cadastrada com sucesso.
            </div>
          )}

          {loadingArea ? (
            <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
          ) : (
            <>
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Data de referência</label>
                <input
                  type="date"
                  className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  value={dataArea}
                  onChange={(e) => setDataArea(e.target.value)}
                />
              </div>

              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-border p-2 text-left text-text-secondary">Tipo de uso</th>
                    <th className="border border-border p-2 text-right text-text-secondary">Área (ha)</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasArea.map((l) => (
                    <tr key={l.tipoUsoId}>
                      <td className="border border-border p-2 text-text-primary">{l.tipoUsoNome}</td>
                      <td className="border border-border p-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-28 rounded-control border border-border bg-surface px-2 py-1 text-right text-text-primary outline-none focus:border-brand-500"
                          value={l.areaHa}
                          onChange={(e) => atualizarLinhaArea(l.tipoUsoId, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="border border-border p-2 text-text-primary">Total</td>
                    <td
                      className={`border border-border p-2 text-right ${
                        fazendaExpandida.area_ha != null && totalArea > fazendaExpandida.area_ha ? 'text-error' : 'text-text-primary'
                      }`}
                    >
                      {formatArea(round2(totalArea))} ha
                      {fazendaExpandida.area_ha != null ? ` / ${formatArea(fazendaExpandida.area_ha)} ha` : ''}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={salvandoArea}
                  onClick={handleSalvarAreaInicial}
                  className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
                >
                  {salvandoArea ? 'Salvando...' : 'Salvar área inicial'}
                </button>
                {fazendaRecemCriadaId === fazendaAreaExpandidaId && (
                  <Link
                    href={`/saldo-inicial?fazenda=${fazendaAreaExpandidaId}`}
                    className="text-sm font-medium text-brand-500 underline"
                  >
                    Continuar para o saldo inicial do rebanho →
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {fazendaPastoExpandidaId && fazendaPastoExpandida && (
        <div className="mt-6 rounded-card border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-text-primary">Módulos e pastos — {fazendaPastoExpandida.nome}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Cada módulo roda o pastejo rotacionado entre seus pastos/talhões. A soma das áreas dos pastos não pode
            ultrapassar a área alocada em "Pecuária" na fazenda.
          </p>

          {loadingPastos ? (
            <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
          ) : (
            <>
              <div className="mt-4 space-y-4">
                {modulos.map((m) => {
                  const pastosDoModulo = pastos.filter((p) => p.modulo_id === m.id).sort((a, b) => a.ordem - b.ordem)
                  const ativosDoModulo = pastosDoModulo.filter((p) => p.ativo)
                  const ativosNaFazenda = modulos.filter((x) => x.ativo)
                  return (
                    <div key={m.id} className={`rounded-control border border-border p-4 ${!m.ativo ? 'opacity-60' : ''}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <input
                          className="w-48 rounded-control border border-border bg-surface px-2 py-1 text-sm font-semibold text-text-primary outline-none focus:border-brand-500"
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
                                  className="w-full rounded-control border border-border bg-surface px-2 py-1 text-text-primary outline-none focus:border-brand-500"
                                  defaultValue={p.nome}
                                  onBlur={(e) => handleRenomearPasto(p, e.target.value)}
                                />
                              </td>
                              <td className="border border-border p-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="w-28 rounded-control border border-border bg-surface px-2 py-1 text-right text-text-primary outline-none focus:border-brand-500"
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
                            className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
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
                            className="w-24 rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
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
                  <input
                    className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
                    value={novoModuloNome}
                    onChange={(e) => setNovoModuloNome(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  disabled={criandoModulo}
                  onClick={() => handleCriarModulo(fazendaPastoExpandidaId)}
                  className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
                >
                  {criandoModulo ? 'Salvando...' : 'Adicionar módulo'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
