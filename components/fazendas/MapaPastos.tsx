'use client'

import { useEffect, useRef, useState } from 'react'
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

const ICONE_EXPANDIR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
const ICONE_RECOLHER =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'

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

// botão de tela cheia como controle nativo do Leaflet — empilha junto
// com o toolbar de desenho no canto superior direito, sem precisar de
// posicionamento absoluto manual por cima do mapa
function ControleTelaCheia({ ativo, onToggle }: { ativo: boolean; onToggle: () => void }) {
  const map = useMap()
  const botaoRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const TelaCheiaControl = L.Control.extend({
      onAdd() {
        const btn = L.DomUtil.create('button', 'leaflet-bar') as HTMLButtonElement
        btn.type = 'button'
        btn.style.width = '30px'
        btn.style.height = '30px'
        btn.style.display = 'flex'
        btn.style.alignItems = 'center'
        btn.style.justifyContent = 'center'
        btn.style.cursor = 'pointer'
        btn.style.backgroundColor = '#FFFFFF'
        L.DomEvent.disableClickPropagation(btn)
        L.DomEvent.on(btn, 'click', onToggle)
        botaoRef.current = btn
        return btn
      },
    })
    const control = new (TelaCheiaControl as any)({ position: 'topright' })
    control.addTo(map)
    return () => {
      control.remove()
      botaoRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    const btn = botaoRef.current
    if (!btn) return
    btn.innerHTML = ativo ? ICONE_RECOLHER : ICONE_EXPANDIR
    btn.title = ativo ? 'Sair da tela cheia' : 'Tela cheia'
  }, [ativo])

  return null
}

// depois de entrar/sair da tela cheia o container muda de tamanho, mas
// o Leaflet não percebe sozinho — sem isso o mapa fica cortado até o
// usuário arrastar/zoom manualmente
function InvalidarTamanho({ gatilho }: { gatilho: boolean }) {
  const map = useMap()
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 60)
    return () => clearTimeout(id)
  }, [map, gatilho])
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
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [telaCheia, setTelaCheia] = useState(false)

  useEffect(() => {
    function aoMudarTelaCheia() {
      setTelaCheia(document.fullscreenElement === wrapperRef.current)
    }
    document.addEventListener('fullscreenchange', aoMudarTelaCheia)
    return () => document.removeEventListener('fullscreenchange', aoMudarTelaCheia)
  }, [])

  function alternarTelaCheia() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      wrapperRef.current?.requestFullscreen()
    }
  }

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
        <ControleTelaCheia ativo={telaCheia} onToggle={alternarTelaCheia} />
        <InvalidarTamanho gatilho={telaCheia} />
      </MapContainer>
    </div>
  )
}
