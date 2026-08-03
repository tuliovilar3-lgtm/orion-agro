'use client'

import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import type { Geometry } from 'geojson'
import { calcularAreaHa } from '@/lib/kml'

export type PastoMapa = {
  id: string
  nome: string
  areaHa: number | null
  geometria: Geometry | null
  cor: string
}

// só a ferramenta de desenhar polígono — sem edição de vértice nativa
// nesta fase: "editar" um contorno é desenhar de novo e escolher qual
// pasto ele substitui (ver ConfirmacaoDesenho no painel que usa este
// componente) — evita o conflito entre o FeatureGroup exigido pelo
// leaflet-draw pra edição e as camadas declarativas do react-leaflet
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

export default function MapaPastos({
  fazendaGeometria,
  pastos,
  pastoDestacadoId,
  onDesenhado,
  onClicarPasto,
}: {
  fazendaGeometria: Geometry | null
  pastos: PastoMapa[]
  pastoDestacadoId?: string | null
  onDesenhado: (geometria: Geometry, areaHa: number) => void
  onClicarPasto: (pastoId: string) => void
}) {
  const todasGeometrias = [
    ...(fazendaGeometria ? [fazendaGeometria] : []),
    ...pastos.filter((p) => p.geometria).map((p) => p.geometria as Geometry),
  ]
  // centro genérico (Brasil) até algo ser desenhado/importado — AjustarZoom
  // recentraliza assim que houver geometria
  const centroInicial: [number, number] = [-15.78, -47.93]

  return (
    <div className="overflow-hidden rounded-control border border-border" style={{ height: 560 }}>
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
          .filter((p) => p.geometria)
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
        <AjustarZoom geometrias={todasGeometrias} />
        <ControleDesenho onDesenhado={onDesenhado} />
      </MapContainer>
    </div>
  )
}
