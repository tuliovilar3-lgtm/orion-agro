'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Geometry } from 'geojson'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { formatArea } from '@/lib/format'
import { corCategorica } from '@/lib/relatorio-cores'
import { parseKml } from '@/lib/kml'
import type { PastoMapa } from '@/components/fazendas/MapaPastos'

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
  ativo: boolean
  ordem: number
  sistema: boolean
  geometria: Geometry | null
}

type Modo = 'lista' | 'mapa'

type LinhaRevisaoImportacao = {
  nome: string
  geometria: Geometry
  areaHa: number
  pastoIdCasado: string | null
}

const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'

export default function ModulosPastosPanel({ fazendaId }: { fazendaId: string }) {
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

  const [modo, setModo] = useState<Modo>('lista')
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
          .select('id, modulo_id, nome, area_ha, ativo, ordem, sistema, geometria')
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
        }))
      )
    } catch {
      alert('Erro ao ler o arquivo KML.')
    } finally {
      setImportandoKmlPastos(false)
    }
  }

  function atualizarCasamentoImportacao(indice: number, pastoId: string) {
    setRevisaoImportacao((prev) =>
      prev ? prev.map((r, i) => (i === indice ? { ...r, pastoIdCasado: pastoId || null } : r)) : prev
    )
  }

  async function handleConfirmarImportacaoKml() {
    if (!revisaoImportacao) return
    const validos = revisaoImportacao.filter((r) => r.pastoIdCasado)
    if (validos.length === 0) {
      setRevisaoImportacao(null)
      return
    }
    setImportandoKmlPastos(true)
    for (const r of validos) {
      const { error } = await supabase
        .from('pastos')
        .update({ geometria: r.geometria, area_ha: r.areaHa })
        .eq('id', r.pastoIdCasado as string)
      if (error) alert(`Erro ao importar "${r.nome}": ` + error.message)
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

  if (loadingPastos && modulos.length === 0) {
    return <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
  }

  const corPorModulo = Object.fromEntries(modulos.map((m, i) => [m.id, corCategorica(i)]))
  const pastosParaMapa: PastoMapa[] = pastos
    .filter((p) => p.ativo)
    .map((p) => ({ id: p.id, nome: p.nome, areaHa: p.area_ha, geometria: p.geometria, cor: corPorModulo[p.modulo_id] || '#1C8C7C' }))
  const pastoSelecionadoMapa = pastos.find((p) => p.id === pastoSelecionadoMapaId) || null

  return (
    <div className="mt-4">
      <p className="text-sm text-text-secondary">
        Cada módulo roda o pastejo rotacionado entre seus pastos/talhões. A soma das áreas dos pastos não pode
        ultrapassar a área alocada em "Pecuária" na fazenda.
      </p>

      <div className="mt-4 flex gap-1.5">
        <button
          type="button"
          onClick={() => setModo('lista')}
          className={`rounded-control px-3 py-1.5 text-sm font-medium ${
            modo === 'lista' ? 'bg-brand-500 text-white' : 'border border-border text-text-secondary'
          }`}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setModo('mapa')}
          className={`rounded-control px-3 py-1.5 text-sm font-medium ${
            modo === 'mapa' ? 'bg-brand-500 text-white' : 'border border-border text-text-secondary'
          }`}
        >
          Mapa
        </button>
      </div>

      {modo === 'lista' ? (
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

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
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
              onClick={handleCriarModulo}
              className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
            >
              {criandoModulo ? 'Salvando...' : 'Adicionar módulo'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
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
                  Casa cada polígono com um pasto existente pelo nome — revise antes de confirmar.
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

          {revisaoImportacao && (
            <div className="rounded-control border border-warning bg-warning-bg p-4">
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
                      value={r.pastoIdCasado ?? ''}
                      onChange={(e) => atualizarCasamentoImportacao(i, e.target.value)}
                    >
                      <option value="">Ignorar</option>
                      {pastos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
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

          <MapaPastos
            fazendaGeometria={fazendaGeometria}
            pastos={pastosParaMapa}
            onDesenhado={handleDesenhado}
            onClicarPasto={setPastoSelecionadoMapaId}
          />

          {pastoSelecionadoMapa && (
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
          )}

          {desenhoPendente && (
            <div className="rounded-control border border-brand-500 bg-brand-100 p-4">
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
        </div>
      )}
    </div>
  )
}
