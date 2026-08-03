'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatArea } from '@/lib/format'
import { parseKml, type FeatureNomeada } from '@/lib/kml'

type TipoUsoArea = { id: string; nome: string }
type SubtipoUsoArea = { id: string; tipo_uso_id: string; nome: string }

type LinhaAreaInicial = {
  tipoUsoId: string
  tipoUsoNome: string
  existingId: string | null
  areaHa: string
}

type LinhaRevisaoKml = {
  nome: string
  geometria: FeatureNomeada['geometria']
  areaHa: number
  tipoUsoId: string
}

type ChecagemEdicaoArea = {
  tem_movimentacoes_futuras: boolean
  saldo_ficaria_negativo: boolean
  data_saldo_negativo: string | null
  tipo_uso_saldo_negativo: string | null
  saldo_minimo: number | null
}

const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export default function AreaInicialForm({ fazendaId, onSalvo }: { fazendaId: string; onSalvo?: () => void }) {
  const [carregando, setCarregando] = useState(true)
  const [areaTotalFazenda, setAreaTotalFazenda] = useState<number | null>(null)
  const [subtipoGeralPorTipoUso, setSubtipoGeralPorTipoUso] = useState<Record<string, string>>({})

  const [dataArea, setDataArea] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhasArea, setLinhasArea] = useState<LinhaAreaInicial[]>([])
  const [salvando, setSalvando] = useState(false)
  const [avisoEdicaoAreaFutura, setAvisoEdicaoAreaFutura] = useState(false)

  const [importandoKml, setImportandoKml] = useState(false)
  const [revisaoKml, setRevisaoKml] = useState<LinhaRevisaoKml[] | null>(null)

  const supabase = createClient()

  async function carregarDados() {
    setCarregando(true)
    const [{ data: fazenda }, { data: tipos }, { data: subtipos }, { data: existentes }] = await Promise.all([
      supabase.from('fazendas').select('area_ha').eq('id', fazendaId).single(),
      supabase.from('tipos_uso_area').select('id, nome').order('ordem'),
      supabase.from('subtipos_uso_area').select('id, tipo_uso_id, nome').eq('nome', 'Geral'),
      supabase
        .from('movimentacoes_area')
        .select('id, tipo_uso_destino_id, area_ha, data')
        .eq('fazenda_id', fazendaId)
        .eq('tipo', 'SALDO_INICIAL'),
    ])

    setAreaTotalFazenda(fazenda?.area_ha ?? null)
    setSubtipoGeralPorTipoUso(Object.fromEntries(((subtipos || []) as SubtipoUsoArea[]).map((s) => [s.tipo_uso_id, s.id])))

    const mapaExistentes = new Map((existentes || []).map((e) => [e.tipo_uso_destino_id, e]))
    const novasLinhas: LinhaAreaInicial[] = ((tipos || []) as TipoUsoArea[]).map((t) => {
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

    setCarregando(false)
  }

  useEffect(() => {
    carregarDados()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaId])

  function atualizarLinhaArea(tipoUsoId: string, valor: string) {
    setLinhasArea((prev) => prev.map((l) => (l.tipoUsoId === tipoUsoId ? { ...l, areaHa: valor } : l)))
  }

  async function handleUploadKml(file: File) {
    setImportandoKml(true)
    try {
      const texto = await file.text()
      const features = parseKml(texto)
      if (features.length === 0) {
        alert('Nenhum polígono encontrado nesse KML.')
        return
      }
      setRevisaoKml(features.map((f) => ({ nome: f.nome, geometria: f.geometria, areaHa: f.areaHa, tipoUsoId: '' })))
    } catch {
      alert('Erro ao ler o arquivo KML.')
    } finally {
      setImportandoKml(false)
    }
  }

  function atualizarTipoUsoRevisao(indice: number, tipoUsoId: string) {
    setRevisaoKml((prev) => (prev ? prev.map((r, i) => (i === indice ? { ...r, tipoUsoId } : r)) : prev))
  }

  function handleConfirmarRevisaoKml() {
    if (!revisaoKml) return
    const somaPorTipoUso: Record<string, number> = {}
    for (const r of revisaoKml) {
      if (!r.tipoUsoId) continue
      somaPorTipoUso[r.tipoUsoId] = (somaPorTipoUso[r.tipoUsoId] || 0) + r.areaHa
    }
    setLinhasArea((prev) =>
      prev.map((l) => {
        const soma = somaPorTipoUso[l.tipoUsoId]
        if (!soma) return l
        const atual = l.areaHa ? parseFloat(l.areaHa) : 0
        return { ...l, areaHa: String(round2(atual + soma)) }
      })
    )
    setRevisaoKml(null)
  }

  async function handleSalvarClick() {
    const linhasExistentes = linhasArea.filter((l) => l.existingId)
    if (linhasExistentes.length > 0) {
      setSalvando(true)
      const resultados = await Promise.all(
        linhasExistentes.map((l) =>
          supabase.rpc('fn_checar_edicao_area', {
            p_id: l.existingId,
            p_fazenda_id: fazendaId,
            p_tipo: 'SALDO_INICIAL',
            p_tipo_uso_origem_id: null,
            p_tipo_uso_destino_id: l.tipoUsoId,
            p_data: dataArea,
            p_area_ha: l.areaHa ? parseFloat(l.areaHa) : 0,
          })
        )
      )
      setSalvando(false)

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

    await executarSalvar()
  }

  async function executarSalvar() {
    setAvisoEdicaoAreaFutura(false)
    setSalvando(true)

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
            setSalvando(false)
            return
          }
        } else {
          const { error } = await supabase.from('movimentacoes_area').insert({
            fazenda_id: fazendaId,
            tipo: 'SALDO_INICIAL',
            tipo_uso_destino_id: linha.tipoUsoId,
            subtipo_uso_destino_id: subtipoGeralPorTipoUso[linha.tipoUsoId],
            area_ha: areaNum,
            data: dataArea,
          })
          if (error) {
            alert('Erro ao salvar: ' + error.message)
            setSalvando(false)
            return
          }
        }
      } else if (linha.existingId) {
        const { error } = await supabase.from('movimentacoes_area').delete().eq('id', linha.existingId)
        if (error) {
          alert('Erro ao excluir: ' + error.message)
          setSalvando(false)
          return
        }
      }
    }

    await carregarDados()
    setSalvando(false)
    onSalvo?.()
  }

  if (carregando) {
    return <p className="text-sm text-text-secondary">Carregando...</p>
  }

  const totalArea = linhasArea.reduce((s, l) => s + (parseFloat(l.areaHa) || 0), 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="cursor-pointer rounded-control border border-border px-3 py-1.5 text-sm text-text-primary">
          {importandoKml ? 'Lendo...' : 'Importar KML'}
          <input
            type="file"
            accept=".kml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUploadKml(f)
              e.target.value = ''
            }}
          />
        </label>
        <span className="text-xs text-text-secondary">
          Um polígono por tipo de uso, ou vários — a área de cada tipo de uso escolhido é somada automaticamente.
        </span>
      </div>

      {revisaoKml && (
        <div className="mt-4 rounded-control border border-warning bg-warning-bg p-4">
          <h4 className="text-sm font-semibold text-text-primary">
            Revisar importação ({revisaoKml.length} polígono{revisaoKml.length === 1 ? '' : 's'})
          </h4>
          <div className="mt-3 space-y-2">
            {revisaoKml.map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface p-2.5 text-sm"
              >
                <span className="min-w-32 font-medium text-text-primary">{r.nome || '(sem nome)'}</span>
                <span className="text-text-secondary">{formatArea(r.areaHa)} ha</span>
                <select
                  className={inputClass}
                  value={r.tipoUsoId}
                  onChange={(e) => atualizarTipoUsoRevisao(i, e.target.value)}
                >
                  <option value="">Ignorar</option>
                  {linhasArea.map((l) => (
                    <option key={l.tipoUsoId} value={l.tipoUsoId}>
                      {l.tipoUsoNome}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setRevisaoKml(null)}
              className="rounded-control border border-border px-4 py-2 text-sm text-text-primary"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmarRevisaoKml}
              className="rounded-control bg-warning px-4 py-2 text-sm font-semibold text-white"
            >
              Confirmar importação
            </button>
          </div>
        </div>
      )}

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
                  areaTotalFazenda != null && totalArea > areaTotalFazenda ? 'text-error' : 'text-text-primary'
                }`}
              >
                {formatArea(round2(totalArea))} ha
                {areaTotalFazenda != null ? ` / ${formatArea(areaTotalFazenda)} ha` : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {avisoEdicaoAreaFutura ? (
        <div className="mt-4 rounded-control border border-warning bg-warning-bg p-3 text-sm">
          <p className="mb-2 text-text-primary">
            Existem mudanças de uso posteriores usando um ou mais desses tipos de uso. Confirma a edição mesmo assim?
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
              disabled={salvando}
              className="rounded-control bg-warning px-4 py-2 font-semibold text-white disabled:opacity-50"
              onClick={executarSalvar}
            >
              {salvando ? 'Salvando...' : 'Confirmar edição'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            disabled={salvando}
            onClick={handleSalvarClick}
            className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : 'Salvar área inicial'}
          </button>
        </div>
      )}
    </div>
  )
}
