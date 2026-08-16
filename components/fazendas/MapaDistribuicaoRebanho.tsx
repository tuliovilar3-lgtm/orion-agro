'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Geometry } from 'geojson'
import { ICONE_SRC, ICONE_TIER, TIER_SIZE_PX, type CodigoIconeCategoria } from '@/lib/categoria-icones'
import { formatQuantidade, formatPeso, formatArea, formatLotacao } from '@/lib/format'

// 1 UA (Unidade Animal) = 450 kg de peso vivo — mesma convenção usada no
// Painel e no Relatório de Lotação
const KG_POR_UA = 450

export type CategoriaDistribuicao = {
  codigo: CodigoIconeCategoria
  nome: string
  quantidade: number
  pesoMedio: number | null
}

export type PastoDistribuicao = {
  id: string
  nome: string
  fazendaNome: string
  areaHa: number | null
  geometria: Geometry | null
  cor: string
  categorias: CategoriaDistribuicao[]
}

// anel externo do polígono (sem o ponto de fechamento, que repete o
// primeiro) — só o suficiente pra centróide/raio aproximados, não precisa
// de precisão geodésica pra posicionar ícones dentro de um pasto
function anelExterno(geometria: Geometry): [number, number][] | null {
  if (geometria.type === 'Polygon') return geometria.coordinates[0]?.slice(0, -1) as [number, number][]
  if (geometria.type === 'MultiPolygon') return geometria.coordinates[0]?.[0]?.slice(0, -1) as [number, number][]
  return null
}

function centroide(geometria: Geometry): [number, number] | null {
  const anel = anelExterno(geometria)
  if (!anel || anel.length === 0) return null
  const lng = anel.reduce((s, p) => s + p[0], 0) / anel.length
  const lat = anel.reduce((s, p) => s + p[1], 0) / anel.length
  return [lat, lng]
}

function raioIcones(geometria: Geometry): number {
  const anel = anelExterno(geometria)
  if (!anel) return 0
  const lngs = anel.map((p) => p[0])
  const lats = anel.map((p) => p[1])
  const largura = Math.max(...lngs) - Math.min(...lngs)
  const altura = Math.max(...lats) - Math.min(...lats)
  return Math.min(largura, altura) * 0.16
}

// posiciona N ícones num pequeno anel ao redor do centróide do pasto —
// só um vira o próprio centróide, evita empilhar marcadores exatamente no
// mesmo ponto quando há várias categorias no mesmo pasto
function posicoesIcones(geometria: Geometry, quantidade: number): [number, number][] {
  const centro = centroide(geometria)
  if (!centro) return []
  if (quantidade <= 1) return [centro]
  const raio = raioIcones(geometria)
  const [latCentro, lngCentro] = centro
  const correcaoLatitude = Math.cos((latCentro * Math.PI) / 180) || 1
  const posicoes: [number, number][] = []
  for (let i = 0; i < quantidade; i++) {
    const angulo = (2 * Math.PI * i) / quantidade - Math.PI / 2
    posicoes.push([latCentro + raio * Math.sin(angulo), lngCentro + (raio * Math.cos(angulo)) / correcaoLatitude])
  }
  return posicoes
}

function iconeLeaflet(codigo: CodigoIconeCategoria) {
  const tamanho = TIER_SIZE_PX[ICONE_TIER[codigo]]
  return L.icon({
    iconUrl: ICONE_SRC[codigo],
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
    className: 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]',
  })
}

function AjustarZoom({ geometrias }: { geometrias: Geometry[] }) {
  const map = useMap()
  useEffect(() => {
    if (geometrias.length === 0) return
    const grupo = L.geoJSON(geometrias as any)
    const bounds = grupo.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, JSON.stringify(geometrias)])
  return null
}

export default function MapaDistribuicaoRebanho({
  fazendasGeometria,
  pastos,
  pastoSelecionadoId,
  onSelecionarPasto,
  altura = 480,
}: {
  fazendasGeometria: Geometry[]
  pastos: PastoDistribuicao[]
  pastoSelecionadoId?: string | null
  onSelecionarPasto?: (pastoId: string) => void
  altura?: number
}) {
  const pastosComGeometria = useMemo(() => pastos.filter((p) => p.geometria), [pastos])

  const todasGeometrias = [
    ...fazendasGeometria,
    ...pastosComGeometria.map((p) => p.geometria as Geometry),
  ]
  const centroInicial: [number, number] = [-15.78, -47.93]

  return (
    <div className="overflow-hidden rounded-control border border-border bg-surface" style={{ height: altura }}>
      <MapContainer center={centroInicial} zoom={4} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        {fazendasGeometria.map((g, i) => (
          <GeoJSON
            key={i}
            data={g as any}
            style={{ color: '#FFFFFF', weight: 2, dashArray: '6 4', fill: false }}
            interactive={false}
          />
        ))}
        {pastosComGeometria.map((p) => {
          const selecionado = p.id === pastoSelecionadoId
          const totalQuantidade = p.categorias.reduce((s, c) => s + c.quantidade, 0)
          const pesoVivoTotal = p.categorias.reduce((s, c) => s + (c.pesoMedio ?? 0) * c.quantidade, 0)
          const pesoMedio = totalQuantidade > 0 ? pesoVivoTotal / totalQuantidade : null
          const lotacao = p.areaHa && p.areaHa > 0 && totalQuantidade > 0 ? pesoVivoTotal / KG_POR_UA / p.areaHa : null
          return (
            <GeoJSON
              key={`${p.id}-${selecionado}`}
              data={p.geometria as any}
              style={{ color: p.cor, weight: selecionado ? 4 : 2, fillColor: p.cor, fillOpacity: selecionado ? 0.4 : 0.22 }}
              eventHandlers={{ click: () => onSelecionarPasto?.(p.id) }}
            >
              <Tooltip direction="top" sticky>
                <div>
                  <div className="font-semibold">{p.nome}</div>
                  <div>{p.fazendaNome}</div>
                  <div>Área útil: {p.areaHa != null ? `${formatArea(p.areaHa)} ha` : '—'}</div>
                  {totalQuantidade > 0 ? (
                    <div>
                      {formatQuantidade(totalQuantidade)} cab. · peso médio {formatPeso(pesoMedio)} kg
                      {lotacao != null ? ` · ${formatLotacao(lotacao)} UA/ha` : ''}
                    </div>
                  ) : (
                    <div>Sem rebanho</div>
                  )}
                </div>
              </Tooltip>
            </GeoJSON>
          )
        })}
        {pastosComGeometria.flatMap((p) => {
          const posicoes = posicoesIcones(p.geometria as Geometry, p.categorias.length)
          return p.categorias.map((c, i) => (
            <Marker
              key={`${p.id}-${c.codigo}-${i}`}
              position={posicoes[i] ?? posicoes[0]}
              icon={iconeLeaflet(c.codigo)}
              eventHandlers={{ click: () => onSelecionarPasto?.(p.id) }}
            >
              <Tooltip direction="top">
                <div>
                  <div className="font-semibold">{c.nome}</div>
                  <div>
                    {formatQuantidade(c.quantidade)} cab. · peso médio {formatPeso(c.pesoMedio)} kg
                  </div>
                </div>
              </Tooltip>
            </Marker>
          ))
        })}
        <AjustarZoom geometrias={todasGeometrias} />
      </MapContainer>
    </div>
  )
}
