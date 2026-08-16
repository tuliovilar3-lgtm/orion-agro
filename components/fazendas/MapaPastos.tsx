'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import type { Geometry } from 'geojson'
import { calcularAreaHa } from '@/lib/kml'
import { useTelaCheia, ControleTelaCheia, InvalidarTamanho } from '@/components/fazendas/MapaTelaCheia'

export type PastoMapa = {
  id: string
  nome: string
  areaHa: number | null
  geometria: Geometry | null
  cor: string
}

export type MapaPastosHandle = {
  obterGeometriaEditada: () => { geometria: Geometry; areaHa: number } | null
}

// pasto em edição de vértice: renderizado como L.Polygon imperativo (fora
// do fluxo declarativo de <GeoJSON>) com a edição nativa do leaflet-draw
// habilitada direto na camada (layer.editing, disponível em qualquer
// L.Polygon assim que 'leaflet-draw' é importado — não precisa do
// FeatureGroup/toolbar completo, só isso já dá os vértices arrastáveis).
// Só o primeiro polígono é editável se a geometria for um MultiPolygon
// (feature rara aqui — os pastos são sempre desenhados como Polygon único).
function EdicaoVerticesPasto({
  pasto,
  layerRef,
}: {
  pasto: PastoMapa
  layerRef: React.MutableRefObject<L.Polygon | null>
}) {
  const map = useMap()

  useEffect(() => {
    if (!pasto.geometria) return
    const grupo = L.geoJSON(pasto.geometria as any, {
      style: { color: pasto.cor, weight: 3, fillColor: pasto.cor, fillOpacity: 0.35 },
    })
    const layer = grupo.getLayers()[0] as L.Polygon
    layer.addTo(map)
    ;(layer as any).editing.enable()
    layerRef.current = layer
    return () => {
      map.removeLayer(layer)
      layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pasto.id])

  return null
}

// só a ferramenta de desenhar polígono novo — a edição de um contorno já
// existente é feita por vértice (ver EdicaoVerticesPasto acima), não por
// aqui; as duas coisas nunca ficam ativas ao mesmo tempo (GestaoAreasPanel
// não deixa iniciar um desenho novo enquanto pastoEmEdicaoId está setado)
function ControleDesenho({ onDesenhado }: { onDesenhado: (geometria: Geometry, areaHa: number) => void }) {
  const map = useMap()

  useEffect(() => {
    const drawControl = new (L.Control as any).Draw({
      position: 'topright',
      draw: {
        polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#1C8C7C' } },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: false,
    })
    map.addControl(drawControl)

    function aoCriar(e: any) {
      const layer = e.layer as L.Layer
      const geojson = (layer as any).toGeoJSON()
      onDesenhado(geojson.geometry, calcularAreaHa(geojson.geometry))
      map.removeLayer(layer)
    }

    map.on((L as any).Draw.Event.CREATED, aoCriar)
    return () => {
      map.off((L as any).Draw.Event.CREATED, aoCriar)
      map.removeControl(drawControl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  return null
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

const MapaPastos = forwardRef<
  MapaPastosHandle,
  {
    fazendaGeometria: Geometry | null
    pastos: PastoMapa[]
    pastoDestacadoId?: string | null
    pastoEmEdicaoId?: string | null
    onDesenhado: (geometria: Geometry, areaHa: number) => void
    onClicarPasto: (pastoId: string) => void
  }
>(function MapaPastos(
  { fazendaGeometria, pastos, pastoDestacadoId, pastoEmEdicaoId, onDesenhado, onClicarPasto },
  ref
) {
  const { wrapperRef, telaCheia, alternarTelaCheia } = useTelaCheia()
  const layerEmEdicaoRef = useRef<L.Polygon | null>(null)

  useImperativeHandle(ref, () => ({
    obterGeometriaEditada() {
      const layer = layerEmEdicaoRef.current
      if (!layer) return null
      const geojson = (layer as any).toGeoJSON()
      return { geometria: geojson.geometry as Geometry, areaHa: calcularAreaHa(geojson.geometry) }
    },
  }))

  const todasGeometrias = [
    ...(fazendaGeometria ? [fazendaGeometria] : []),
    ...pastos.filter((p) => p.geometria).map((p) => p.geometria as Geometry),
  ]
  // centro genérico (Brasil) até algo ser desenhado/importado — AjustarZoom
  // recentraliza assim que houver geometria
  const centroInicial: [number, number] = [-15.78, -47.93]

  return (
    <div
      ref={wrapperRef}
      className="overflow-hidden rounded-control border border-border bg-surface"
      style={{ height: telaCheia ? '100vh' : 560 }}
    >
      <MapContainer center={centroInicial} zoom={4} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        {fazendaGeometria && (
          <GeoJSON
            data={fazendaGeometria as any}
            style={{ color: '#FFFFFF', weight: 2, dashArray: '6 4', fill: false }}
            interactive={false}
          />
        )}
        {pastos
          .filter((p) => p.geometria && p.id !== pastoEmEdicaoId)
          .map((p) => {
            const destacado = p.id === pastoDestacadoId
            return (
              <GeoJSON
                key={`${p.id}-${destacado}`}
                data={p.geometria as any}
                style={{ color: p.cor, weight: destacado ? 4 : 2, fillColor: p.cor, fillOpacity: destacado ? 0.45 : 0.25 }}
                eventHandlers={{ click: () => onClicarPasto(p.id) }}
              />
            )
          })}
        {pastoEmEdicaoId &&
          (() => {
            const pasto = pastos.find((p) => p.id === pastoEmEdicaoId)
            return pasto?.geometria ? (
              <EdicaoVerticesPasto key={pasto.id} pasto={pasto} layerRef={layerEmEdicaoRef} />
            ) : null
          })()}
        <AjustarZoom geometrias={todasGeometrias} />
        {!pastoEmEdicaoId && <ControleDesenho onDesenhado={onDesenhado} />}
        <ControleTelaCheia ativo={telaCheia} onToggle={alternarTelaCheia} />
        <InvalidarTamanho gatilho={telaCheia} />
      </MapContainer>
    </div>
  )
})

export default MapaPastos
