'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Geometry } from 'geojson'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatArea } from '@/lib/format'
import { corCategorica } from '@/lib/relatorio-cores'
import { parseKml } from '@/lib/kml'
import type { PastoMapa, MapaPastosHandle } from '@/components/fazendas/MapaPastos'

// leaflet acessa `window` na importação — precisa ficar fora do SSR
const MapaPastos = dynamic(() => import('@/components/fazendas/MapaPastos'), { ssr: false })

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
  cor: string | null
  ativo: boolean
  ordem: number
  sistema: boolean
  geometria: Geometry | null
}

const NOVO_PASTO = '__novo__'

type LinhaRevisaoImportacao = {
  nome: string
  geometria: Geometry
  areaHa: number
  pastoIdCasado: string | null
  criarNovo: boolean
  moduloIdNovo: string
}

const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'

function IconToggle({ ativo }: { ativo: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      {ativo ? <path d="M8 12.5l2.5 2.5L16 9.5" /> : <path d="M9 9l6 6M15 9l-6 6" />}
    </svg>
  )
}

function IconExcluir() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  )
}

function IconEditarContorno() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="M15 5l4 4" />
    </svg>
  )
}

export default function GestaoAreasPanel({ fazendaId }: { fazendaId: string }) {
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

  const [fazendaGeometria, setFazendaGeometria] = useState<Geometry | null>(null)
  const [importandoContornoFazenda, setImportandoContornoFazenda] = useState(false)
  const [importandoKmlPastos, setImportandoKmlPastos] = useState(false)
  const [revisaoImportacao, setRevisaoImportacao] = useState<LinhaRevisaoImportacao[] | null>(null)
  const [pastoSelecionadoMapaId, setPastoSelecionadoMapaId] = useState<string | null>(null)

  const [desenhoPendente, setDesenhoPendente] = useState<{ geometria: Geometry; areaHa: number } | null>(null)
  const [modoAtribuicao, setModoAtribuicao] = useState<'novo' | 'existente'>('novo')
  const [atribuirNovoNome, setAtribuirNovoNome] = useState('')
  const [atribuirNovoModuloId, setAtribuirNovoModuloId] = useState('')
  const [atribuirPastoExistenteId, setAtribuirPastoExistenteId] = useState('')
  const [salvandoAtribuicao, setSalvandoAtribuicao] = useState(false)

  const [pastoEmEdicaoId, setPastoEmEdicaoId] = useState<string | null>(null)
  const [salvandoEdicaoVertices, setSalvandoEdicaoVertices] = useState(false)
  const mapaPastosRef = useRef<MapaPastosHandle>(null)

  const supabase = createClient()

  async function carregarModulosPastos() {
    setLoadingPastos(true)
    const { data: mods } = await supabase
      .from('modulos')
      .select('id, fazenda_id, nome, ativo, ordem, sistema')
      .eq('fazenda_id', fazendaId)
      .order('ordem')
    const modIds = (mods || []).map((m) => m.id)
    const { data: pas } = modIds.length
      ? await supabase
          .from('pastos')
          .select('id, modulo_id, nome, area_ha, cor, ativo, ordem, sistema, geometria')
          .in('modulo_id', modIds)
          .order('ordem')
      : { data: [] as Pasto[] }
    setModulos(mods || [])
    setPastos(pas || [])
    setLoadingPastos(false)
  }

  async function carregarFazendaGeometria() {
    const { data } = await supabase.from('fazendas').select('geometria').eq('id', fazendaId).single()
    setFazendaGeometria((data?.geometria as Geometry | null) ?? null)
  }

  useEffect(() => {
    carregarModulosPastos()
    carregarFazendaGeometria()
    setPastoSelecionadoMapaId(null)
    setDesenhoPendente(null)
    setRevisaoImportacao(null)
    setPastoEmEdicaoId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  async function handleCriarModulo() {
    if (!novoModuloNome.trim()) return
    setCriandoModulo(true)
    const proximaOrdem = modulos.length ? Math.max(...modulos.map((m) => m.ordem)) + 1 : 0
    const { error } = await supabase.from('modulos').insert({
      fazenda_id: fazendaId,
      nome: novoModuloNome.trim(),
      tipo_utilizacao: 'PECUARIA',
      ordem: proximaOrdem,
    })
    if (error) {
      alert('Erro ao criar módulo: ' + error.message)
    } else {
      setNovoModuloNome('')
      await carregarModulosPastos()
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
      await carregarModulosPastos()
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

  async function handleAtualizarCorPasto(p: Pasto, novaCor: string) {
    if (novaCor === p.cor) return
    const { error } = await supabase.from('pastos').update({ cor: novaCor }).eq('id', p.id)
    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setPastos((prev) => prev.map((x) => (x.id === p.id ? { ...x, cor: novaCor } : x)))
    }
  }

  async function handleMoverPastoModulo(p: Pasto, novoModuloId: string) {
    if (!novoModuloId || novoModuloId === p.modulo_id) return
    const { error } = await supabase.from('pastos').update({ modulo_id: novoModuloId }).eq('id', p.id)
    if (error) {
      alert('Erro ao mover pasto: ' + error.message)
    } else {
      await carregarModulosPastos()
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
    } else {
      await carregarModulosPastos()
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

  async function handleUploadContornoFazenda(file: File) {
    setImportandoContornoFazenda(true)
    try {
      const texto = await file.text()
      const features = parseKml(texto)
      if (features.length === 0) {
        alert('Nenhum polígono encontrado nesse KML.')
        return
      }
      const geometria = features[0].geometria
      const { error } = await supabase.from('fazendas').update({ geometria }).eq('id', fazendaId)
      if (error) {
        alert('Erro ao salvar contorno: ' + error.message)
      } else {
        setFazendaGeometria(geometria)
      }
    } catch {
      alert('Erro ao ler o arquivo KML.')
    } finally {
      setImportandoContornoFazenda(false)
    }
  }

  async function handleUploadKmlPastos(file: File) {
    setImportandoKmlPastos(true)
    try {
      const texto = await file.text()
      const features = parseKml(texto)
      if (features.length === 0) {
        alert('Nenhum polígono encontrado nesse KML.')
        return
      }
      const normalizar = (s: string) => s.trim().toLowerCase()
      const porNome = new Map(pastos.map((p) => [normalizar(p.nome), p]))
      setRevisaoImportacao(
        features.map((f) => ({
          nome: f.nome,
          geometria: f.geometria,
          areaHa: f.areaHa,
          pastoIdCasado: porNome.get(normalizar(f.nome))?.id ?? null,
          criarNovo: false,
          moduloIdNovo: modulos[0]?.id ?? '',
        }))
      )
    } catch {
      alert('Erro ao ler o arquivo KML.')
    } finally {
      setImportandoKmlPastos(false)
    }
  }

  function atualizarSelecaoImportacao(indice: number, valor: string) {
    setRevisaoImportacao((prev) =>
      prev
        ? prev.map((r, i) =>
            i === indice
              ? valor === NOVO_PASTO
                ? { ...r, criarNovo: true, pastoIdCasado: null }
                : { ...r, criarNovo: false, pastoIdCasado: valor || null }
              : r
          )
        : prev
    )
  }

  function atualizarModuloNovoImportacao(indice: number, moduloId: string) {
    setRevisaoImportacao((prev) => (prev ? prev.map((r, i) => (i === indice ? { ...r, moduloIdNovo: moduloId } : r)) : prev))
  }

  async function handleConfirmarImportacaoKml() {
    if (!revisaoImportacao) return
    const paraCasar = revisaoImportacao.filter((r) => r.pastoIdCasado)
    const paraCriar = revisaoImportacao.filter((r) => r.criarNovo && r.moduloIdNovo)
    if (paraCasar.length === 0 && paraCriar.length === 0) {
      setRevisaoImportacao(null)
      return
    }
    setImportandoKmlPastos(true)

    for (const r of paraCasar) {
      const { error } = await supabase
        .from('pastos')
        .update({ geometria: r.geometria, area_ha: r.areaHa })
        .eq('id', r.pastoIdCasado as string)
      if (error) alert(`Erro ao importar "${r.nome}": ` + error.message)
    }

    const proximaOrdemPorModulo: Record<string, number> = {}
    for (const r of paraCriar) {
      if (proximaOrdemPorModulo[r.moduloIdNovo] === undefined) {
        const pastosDoModulo = pastos.filter((p) => p.modulo_id === r.moduloIdNovo)
        proximaOrdemPorModulo[r.moduloIdNovo] = pastosDoModulo.length
          ? Math.max(...pastosDoModulo.map((p) => p.ordem)) + 1
          : 0
      }
      const { error } = await supabase.from('pastos').insert({
        modulo_id: r.moduloIdNovo,
        nome: r.nome || 'Sem nome',
        area_ha: r.areaHa,
        geometria: r.geometria,
        ordem: proximaOrdemPorModulo[r.moduloIdNovo],
      })
      proximaOrdemPorModulo[r.moduloIdNovo] += 1
      if (error) alert(`Erro ao criar pasto "${r.nome}": ` + error.message)
    }

    setImportandoKmlPastos(false)
    setRevisaoImportacao(null)
    await carregarModulosPastos()
  }

  function handleDesenhado(geometria: Geometry, areaHa: number) {
    setDesenhoPendente({ geometria, areaHa })
    setModoAtribuicao('novo')
    setAtribuirNovoNome('')
    setAtribuirNovoModuloId(modulos[0]?.id ?? '')
    setAtribuirPastoExistenteId('')
  }

  async function handleConfirmarAtribuicao() {
    if (!desenhoPendente) return
    if (modoAtribuicao === 'novo') {
      if (!atribuirNovoNome.trim() || !atribuirNovoModuloId) {
        alert('Preencha o nome e o módulo do novo pasto.')
        return
      }
      setSalvandoAtribuicao(true)
      const pastosDoModulo = pastos.filter((p) => p.modulo_id === atribuirNovoModuloId)
      const proximaOrdem = pastosDoModulo.length ? Math.max(...pastosDoModulo.map((p) => p.ordem)) + 1 : 0
      const { error } = await supabase.from('pastos').insert({
        modulo_id: atribuirNovoModuloId,
        nome: atribuirNovoNome.trim(),
        area_ha: desenhoPendente.areaHa,
        geometria: desenhoPendente.geometria,
        ordem: proximaOrdem,
      })
      setSalvandoAtribuicao(false)
      if (error) {
        alert('Erro ao criar pasto: ' + error.message)
        return
      }
    } else {
      if (!atribuirPastoExistenteId) {
        alert('Selecione o pasto que vai receber esse contorno.')
        return
      }
      setSalvandoAtribuicao(true)
      const { error } = await supabase
        .from('pastos')
        .update({ geometria: desenhoPendente.geometria, area_ha: desenhoPendente.areaHa })
        .eq('id', atribuirPastoExistenteId)
      setSalvandoAtribuicao(false)
      if (error) {
        alert('Erro ao atualizar pasto: ' + error.message)
        return
      }
    }
    setDesenhoPendente(null)
    await carregarModulosPastos()
  }

  function handleIniciarEdicaoVertices(p: Pasto) {
    setPastoSelecionadoMapaId(p.id)
    setPastoEmEdicaoId(p.id)
  }

  function handleCancelarEdicaoVertices() {
    // nada foi salvo — sair do modo de edição já reverte o mapa pro
    // contorno declarativo original (MapaPastos desmonta a camada editável)
    setPastoEmEdicaoId(null)
  }

  async function handleSalvarEdicaoVertices() {
    const resultado = mapaPastosRef.current?.obterGeometriaEditada()
    if (!resultado) {
      alert('Não foi possível ler o contorno editado.')
      return
    }
    setSalvandoEdicaoVertices(true)
    const { error } = await supabase
      .from('pastos')
      .update({ geometria: resultado.geometria, area_ha: resultado.areaHa })
      .eq('id', pastoEmEdicaoId as string)
    setSalvandoEdicaoVertices(false)
    if (error) {
      alert('Erro ao salvar contorno: ' + error.message)
      return
    }
    setPastoEmEdicaoId(null)
    await carregarModulosPastos()
  }

  if (loadingPastos && modulos.length === 0) {
    return <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
  }

  const corPorModulo = Object.fromEntries(modulos.map((m, i) => [m.id, corCategorica(i)]))
  const pastosParaMapa: PastoMapa[] = pastos
    .filter((p) => p.ativo)
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      areaHa: p.area_ha,
      geometria: p.geometria,
      cor: p.cor || corPorModulo[p.modulo_id] || '#1C8C7C',
    }))
  const pastoSelecionadoMapa = pastos.find((p) => p.id === pastoSelecionadoMapaId) || null
  const pastosSemContorno = pastos.filter((p) => p.ativo && !p.geometria)

  return (
    <div className="mt-4">
      <p className="text-sm text-text-secondary">
        Cada módulo roda o pastejo rotacionado entre seus pastos/talhões. A soma das áreas dos pastos não pode
        ultrapassar a área alocada em "Pecuária" na fazenda.
      </p>

      {pastosSemContorno.length > 0 && (
        <div className="mt-4 rounded-control border border-dashed border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text-primary">
            {pastosSemContorno.length} pasto{pastosSemContorno.length === 1 ? '' : 's'} sem contorno no mapa
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {pastosSemContorno.map((p) => p.nome).join(', ')} — desenhe ou importe um KML pra ver a área calculada
            automaticamente.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-control border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Contorno da fazenda</h3>
              <p className="text-xs text-text-secondary">Usado só como referência visual de fundo — nunca obrigatório.</p>
            </div>
            <label className="cursor-pointer rounded-control border border-border px-3 py-1.5 text-sm text-text-primary">
              {importandoContornoFazenda ? 'Importando...' : fazendaGeometria ? 'Substituir KML' : 'Importar KML'}
              <input
                type="file"
                accept=".kml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUploadContornoFazenda(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        <div className="rounded-control border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Importar pastos de um KML</h3>
              <p className="text-xs text-text-secondary">
                Casa cada polígono com um pasto existente pelo nome, ou crie pastos novos — revise antes de confirmar.
              </p>
            </div>
            <label className="cursor-pointer rounded-control border border-border px-3 py-1.5 text-sm text-text-primary">
              {importandoKmlPastos ? 'Lendo...' : 'Importar KML'}
              <input
                type="file"
                accept=".kml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUploadKmlPastos(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {revisaoImportacao && (
        <div className="mt-4 rounded-control border border-warning bg-warning-bg p-4">
          <h3 className="text-sm font-semibold text-text-primary">
            Revisar importação ({revisaoImportacao.length} polígono{revisaoImportacao.length === 1 ? '' : 's'})
          </h3>
          <div className="mt-3 space-y-2">
            {revisaoImportacao.map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface p-2.5 text-sm"
              >
                <span className="min-w-32 font-medium text-text-primary">{r.nome || '(sem nome)'}</span>
                <span className="text-text-secondary">{formatArea(r.areaHa)} ha</span>
                <select
                  className={inputClass}
                  value={r.criarNovo ? NOVO_PASTO : r.pastoIdCasado ?? ''}
                  onChange={(e) => atualizarSelecaoImportacao(i, e.target.value)}
                >
                  <option value="">Ignorar</option>
                  <option value={NOVO_PASTO}>+ Criar novo pasto</option>
                  {pastos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
                {r.criarNovo && (
                  <select
                    className={inputClass}
                    value={r.moduloIdNovo}
                    onChange={(e) => atualizarModuloNovoImportacao(i, e.target.value)}
                  >
                    {modulos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setRevisaoImportacao(null)}
              className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={importandoKmlPastos}
              onClick={handleConfirmarImportacaoKml}
              className="rounded-control bg-warning px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {importandoKmlPastos ? 'Salvando...' : 'Confirmar importação'}
            </button>
          </div>
        </div>
      )}

      {desenhoPendente && (
        <div className="mt-4 rounded-control border border-brand-500 bg-brand-100 p-4">
          <h3 className="text-sm font-semibold text-text-primary">Novo contorno desenhado</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Área calculada: {formatArea(desenhoPendente.areaHa)} ha. Escolha a quem atribuir.
          </p>

          <div className="mt-3 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={modoAtribuicao === 'novo'} onChange={() => setModoAtribuicao('novo')} />
              Novo pasto
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={modoAtribuicao === 'existente'}
                onChange={() => setModoAtribuicao('existente')}
              />
              Substituir pasto existente
            </label>
          </div>

          {modoAtribuicao === 'novo' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  Nome
                  <Required />
                </label>
                <input className={inputClass} value={atribuirNovoNome} onChange={(e) => setAtribuirNovoNome(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  Módulo
                  <Required />
                </label>
                <select
                  className={inputClass}
                  value={atribuirNovoModuloId}
                  onChange={(e) => setAtribuirNovoModuloId(e.target.value)}
                >
                  {modulos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Pasto
                <Required />
              </label>
              <select
                className={inputClass}
                value={atribuirPastoExistenteId}
                onChange={(e) => setAtribuirPastoExistenteId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {pastos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setDesenhoPendente(null)}
              className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={salvandoAtribuicao}
              onClick={handleConfirmarAtribuicao}
              className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {salvandoAtribuicao ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <div className="overflow-hidden rounded-control border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-bg">
                <th className="border-b border-border p-2 text-left text-text-secondary">Módulo / Pasto</th>
                <th className="border-b border-border p-2 text-right text-text-secondary">Área (ha)</th>
                <th className="border-b border-border p-2 text-right text-text-secondary">Ações</th>
              </tr>
            </thead>
            <tbody>
              {modulos.map((m) => {
                const pastosDoModulo = pastos.filter((p) => p.modulo_id === m.id).sort((a, b) => a.ordem - b.ordem)
                const ativosDoModulo = pastosDoModulo.filter((p) => p.ativo)
                const ativosNaFazenda = modulos.filter((x) => x.ativo)
                return (
                  <Fragment key={m.id}>
                    <tr className={`bg-bg ${!m.ativo ? 'opacity-60' : ''}`}>
                      <td className="border-b border-border p-2">
                        <input
                          className={`w-full font-semibold ${inputClass}`}
                          defaultValue={m.nome}
                          onBlur={(e) => handleRenomearModulo(m, e.target.value)}
                        />
                      </td>
                      <td className="border-b border-border p-2" />
                      <td className="border-b border-border p-2 text-right">
                        {confirmandoExclusaoModuloId === m.id ? (
                          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                            <span className="text-error">Excluir "{m.nome}"?</span>
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
                          <div className="flex items-center justify-end gap-2 text-text-secondary">
                            <button
                              type="button"
                              disabled={processandoPastoId === m.id || (m.ativo && ativosNaFazenda.length <= 1)}
                              title={
                                m.ativo && ativosNaFazenda.length <= 1
                                  ? 'Precisa haver ao menos um módulo ativo.'
                                  : m.ativo
                                    ? 'Inativar módulo'
                                    : 'Ativar módulo'
                              }
                              className="hover:text-success disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => handleAlternarAtivoModulo(m)}
                            >
                              <IconToggle ativo={m.ativo} />
                            </button>
                            {!m.sistema && (
                              <button
                                type="button"
                                title="Excluir módulo"
                                className="hover:text-error"
                                onClick={() => setConfirmandoExclusaoModuloId(m.id)}
                              >
                                <IconExcluir />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {pastosDoModulo.map((p) => (
                      <tr
                        key={p.id}
                        className={`cursor-pointer ${!p.ativo ? 'opacity-60' : ''} ${
                          pastoSelecionadoMapaId === p.id ? 'bg-brand-100' : ''
                        }`}
                        onClick={() => p.geometria && setPastoSelecionadoMapaId(p.id)}
                      >
                        <td className="border-b border-border p-2 pl-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              title="Cor no mapa"
                              className="h-8 w-8 shrink-0 cursor-pointer rounded-control border border-border bg-surface p-0.5"
                              value={p.cor || corPorModulo[p.modulo_id] || '#1C8C7C'}
                              onChange={(e) => handleAtualizarCorPasto(p, e.target.value)}
                            />
                            <input
                              className={`w-full ${inputClass}`}
                              defaultValue={p.nome}
                              onBlur={(e) => handleRenomearPasto(p, e.target.value)}
                            />
                            {!p.sistema && modulos.length > 1 && (
                              <select
                                title="Mover pra outro módulo"
                                className={`shrink-0 ${inputClass}`}
                                value={p.modulo_id}
                                onChange={(e) => handleMoverPastoModulo(p, e.target.value)}
                              >
                                {modulos.map((mod) => (
                                  <option key={mod.id} value={mod.id}>
                                    {mod.nome}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        <td className="border-b border-border p-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className={`w-24 text-right ${inputClass}`}
                            defaultValue={p.area_ha ?? ''}
                            onBlur={(e) => handleAtualizarAreaPasto(p, e.target.value)}
                          />
                        </td>
                        <td className="border-b border-border p-2 text-right" onClick={(e) => e.stopPropagation()}>
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
                            <div className="flex items-center justify-end gap-2 text-text-secondary">
                              {p.geometria && (
                                <button
                                  type="button"
                                  disabled={!!pastoEmEdicaoId && pastoEmEdicaoId !== p.id}
                                  title={pastoEmEdicaoId === p.id ? 'Cancelar edição de contorno' : 'Editar contorno'}
                                  className={`disabled:cursor-not-allowed disabled:opacity-40 ${
                                    pastoEmEdicaoId === p.id ? 'text-brand-500' : 'hover:text-brand-500'
                                  }`}
                                  onClick={() =>
                                    pastoEmEdicaoId === p.id
                                      ? handleCancelarEdicaoVertices()
                                      : handleIniciarEdicaoVertices(p)
                                  }
                                >
                                  <IconEditarContorno />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={processandoPastoId === p.id || (p.ativo && ativosDoModulo.length <= 1)}
                                title={
                                  p.ativo && ativosDoModulo.length <= 1
                                    ? 'Precisa haver ao menos um pasto ativo no módulo.'
                                    : p.ativo
                                      ? 'Inativar'
                                      : 'Ativar'
                                }
                                className="hover:text-success disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => handleAlternarAtivoPasto(p)}
                              >
                                <IconToggle ativo={p.ativo} />
                              </button>
                              {!p.sistema && (
                                <button
                                  type="button"
                                  title="Excluir"
                                  className="hover:text-error"
                                  onClick={() => setConfirmandoExclusaoPastoId(p.id)}
                                >
                                  <IconExcluir />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <td className="p-2 pl-6">
                        <input
                          className={`w-full ${inputClass}`}
                          placeholder="Novo pasto/talhão"
                          value={novoPastoNomePorModulo[m.id] || ''}
                          onChange={(e) => setNovoPastoNomePorModulo((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={`w-24 text-right ${inputClass}`}
                          value={novoPastoAreaPorModulo[m.id] || ''}
                          onChange={(e) => setNovoPastoAreaPorModulo((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          disabled={criandoPastoModuloId === m.id}
                          onClick={() => handleCriarPasto(m.id)}
                          className="rounded-control border border-border px-3 py-1.5 text-xs text-text-primary disabled:opacity-50"
                        >
                          + Pasto
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}

              <tr className="border-t border-border">
                <td className="p-2">
                  <input
                    className={`w-full ${inputClass}`}
                    placeholder="Novo módulo"
                    value={novoModuloNome}
                    onChange={(e) => setNovoModuloNome(e.target.value)}
                  />
                </td>
                <td className="p-2" />
                <td className="p-2 text-right">
                  <button
                    type="button"
                    disabled={criandoModulo}
                    onClick={handleCriarModulo}
                    className="rounded-control bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
                  >
                    {criandoModulo ? 'Salvando...' : '+ Módulo'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <MapaPastos
            ref={mapaPastosRef}
            fazendaGeometria={fazendaGeometria}
            pastos={pastosParaMapa}
            pastoDestacadoId={pastoSelecionadoMapaId}
            pastoEmEdicaoId={pastoEmEdicaoId}
            onDesenhado={handleDesenhado}
            onClicarPasto={setPastoSelecionadoMapaId}
          />

          {pastoEmEdicaoId && pastoSelecionadoMapa ? (
            <div className="rounded-control border border-brand-500 bg-brand-100 p-4 text-sm">
              <p className="font-semibold text-text-primary">Editando contorno — {pastoSelecionadoMapa.nome}</p>
              <p className="mt-1 text-text-secondary">
                Arraste os vértices do polígono no mapa pra ajustar o traçado.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleCancelarEdicaoVertices}
                  className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={salvandoEdicaoVertices}
                  onClick={handleSalvarEdicaoVertices}
                  className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {salvandoEdicaoVertices ? 'Salvando...' : 'Salvar contorno'}
                </button>
              </div>
            </div>
          ) : (
            pastoSelecionadoMapa && (
              <div className="rounded-control border border-border bg-surface p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary">{pastoSelecionadoMapa.nome}</span>
                  <button
                    type="button"
                    className="text-xs text-text-secondary underline"
                    onClick={() => setPastoSelecionadoMapaId(null)}
                  >
                    Fechar
                  </button>
                </div>
                <p className="mt-1 text-text-secondary">
                  Área: {pastoSelecionadoMapa.area_ha != null ? `${formatArea(pastoSelecionadoMapa.area_ha)} ha` : '—'}
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
