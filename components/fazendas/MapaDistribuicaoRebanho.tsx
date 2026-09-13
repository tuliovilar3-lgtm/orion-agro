'use client'

import { forwardRef, useEffect, useMemo, useReducer } from 'react'
import { MapContainer, TileLayer, GeoJSON, Marker, Tooltip, useMap } from 'react-leaflet'
import type { LeafletEvent } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Geometry, Polygon, MultiPolygon } from 'geojson'
import { ICONE_SRC, type CodigoIconeCategoria } from '@/lib/categoria-icones'
import type { ProprietarioQuantidade } from '@/lib/distribuicao-pasto'
import { formatQuantidade, formatPeso, formatArea, formatLotacao } from '@/lib/format'
import { useTelaCheia, ControleTelaCheia, InvalidarTamanho } from '@/components/fazendas/MapaTelaCheia'

// 1 UA (Unidade Animal) = 450 kg de peso vivo — mesma convenção usada no
// Painel e no Relatório de Lotação
const KG_POR_UA = 450

export type CategoriaDistribuicao = {
  codigo: CodigoIconeCategoria
  nome: string
  quantidade: number
  pesoMedio: number | null
  // só presente quando a conta tem 2+ proprietários cadastrados — decomposição do lote por dono
  // (inclui "Sem proprietário" quando sobra quantidade não atribuída a nenhum deles)
  porProprietario?: ProprietarioQuantidade[]
}

export type PastoDistribuicao = {
  id: string
  nome: string
  fazendaId: string
  fazendaNome: string
  moduloNome: string
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

// selo = pino + foto da categoria numa bola branca + contagem no canto —
// mesmo desenho aprovado no mockup "Selos do Rebanho" (ver CLAUDE.md). Cada
// categoria (já deduplicada por ícone em montarDistribuicaoPorPasto) ganha
// seu próprio selo — vaca e bezerro/a aparecem em selos separados (decisão
// revista depois de usar o combo na prática: menos poluição visual do que
// parecia, e fica muito mais simples de casar com a decomposição por
// proprietário, que agora pode aparecer por categoria sem precisar somar
// mãe+cria primeiro).
const SELO_LARGURA = 56
const SELO_ALTURA = 70

function seloIcone(categoria: CategoriaDistribuicao) {
  const html = `
    <div style="position:relative;width:${SELO_LARGURA}px;height:${SELO_ALTURA}px;">
      <div style="position:absolute;top:0;left:0;width:${SELO_LARGURA}px;height:${SELO_LARGURA}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--color-brand-900);box-shadow:0 3px 8px rgba(0,0,0,.4);"></div>
      <div style="position:absolute;top:6px;left:6px;width:44px;height:44px;border-radius:50%;overflow:hidden;background:#fff;border:2px solid rgba(255,255,255,.9);">
        <img src="${ICONE_SRC[categoria.codigo]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;" />
      </div>
      <div style="position:absolute;top:-5px;right:-5px;min-width:23px;height:23px;padding:0 5px;border-radius:999px;background:var(--color-brand-500);color:#fff;font-weight:800;font-size:11.5px;line-height:1;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);">${categoria.quantidade}</div>
    </div>
  `
  return L.divIcon({
    html,
    className: '',
    iconSize: [SELO_LARGURA, SELO_ALTURA],
    iconAnchor: [SELO_LARGURA / 2, SELO_ALTURA],
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

const MapaDistribuicaoRebanho = forwardRef<
  HTMLDivElement,
  {
    fazendasGeometria: Geometry[]
    pastos: PastoDistribuicao[]
    pastoSelecionadoId?: string | null
    onSelecionarPasto?: (pastoId: string) => void
    // disparado só ao clicar no ÍCONE do animal (não no polígono do pasto) — abre o modal de
    // detalhe/ações rápidas, sem alterar o comportamento de clique já existente no polígono
    onAbrirDetalhe?: (pastoId: string) => void
    // habilita arrastar o selo de um pasto pra outro (gated por módulo "Mudança de Pasto" —
    // decisão do usuário, ver CLAUDE.md "Selos do Rebanho — Fase 3") — só pastos com contorno
    // entram (são os únicos que ganham marcador), e só dentro da mesma fazenda do selo arrastado
    permitirArrastar?: boolean
    onArrastarPasto?: (pastoOrigemId: string, pastoDestinoId: string) => void
    altura?: number
    // avisa a página quando o mapa entra/sai de tela cheia — os modais de detalhe/movimentação
    // vivem fora da árvore deste componente (na página), então sem isso eles ficam escondidos
    // atrás do elemento em tela cheia (a Fullscreen API só exibe acima dele o que é seu
    // descendente); a página usa isso + o `ref` (o próprio elemento em tela cheia) pra portar o
    // modal pra dentro dele enquanto durar a tela cheia — ver "Modais escondidos atrás do mapa
    // em tela cheia" no CLAUDE.md
    onTelaCheiaChange?: (ativo: boolean) => void
  }
>(function MapaDistribuicaoRebanho(
  {
    fazendasGeometria,
    pastos,
    pastoSelecionadoId,
    onSelecionarPasto,
    onAbrirDetalhe,
    permitirArrastar = false,
    onArrastarPasto,
    altura = 480,
    onTelaCheiaChange,
  },
  refExterno
) {
  const pastosComGeometria = useMemo(() => pastos.filter((p) => p.geometria), [pastos])
  const { wrapperRef, telaCheia, alternarTelaCheia } = useTelaCheia()

  useEffect(() => {
    onTelaCheiaChange?.(telaCheia)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telaCheia])
  // força um re-render depois de um drag (bem-sucedido ou não) — o marcador arrastado precisa
  // voltar pra posição calculada (centróide/anel do pasto de origem) assim que o usuário solta,
  // já que a posição real do rebanho não muda só por causa do arraste em si (só a confirmação no
  // modal de Movimentação de Lotes altera o pasto de fato)
  const [, forcarRender] = useReducer((n: number) => n + 1, 0)

  function tratarSoltarSelo(pastoOrigem: PastoDistribuicao, evento: LeafletEvent) {
    forcarRender()
    const marker = evento.target as L.Marker
    const { lat, lng } = marker.getLatLng()
    const destino = pastosComGeometria.find((p) => {
      if (p.id === pastoOrigem.id) return false
      if (p.fazendaId !== pastoOrigem.fazendaId) return false
      return booleanPointInPolygon([lng, lat], p.geometria as Polygon | MultiPolygon)
    })
    if (destino) onArrastarPasto?.(pastoOrigem.id, destino.id)
  }

  // "auto-pan": enquanto o selo é arrastado perto da borda do mapa, empurra a
  // tela na mesma direção — sem isso, chegar num pasto de destino fora da
  // área visível exigiria soltar o arraste, rolar/dar zoom manualmente e
  // arrastar de novo. `_map` não é API pública do Marker, mas é o único jeito
  // de achar o mapa a partir do evento de drag em si (mesmo espírito
  // pragmático já usado noutros pontos do arquivo, ex. EdicaoVerticesPasto).
  function tratarArrastando(evento: LeafletEvent) {
    const marker = evento.target as L.Marker
    const map = (marker as unknown as { _map?: L.Map })._map
    if (!map) return
    const BORDA_PX = 60
    const PASSO_PX = 18
    const ponto = map.latLngToContainerPoint(marker.getLatLng())
    const tamanho = map.getSize()
    let dx = 0
    let dy = 0
    if (ponto.x < BORDA_PX) dx = -PASSO_PX
    else if (ponto.x > tamanho.x - BORDA_PX) dx = PASSO_PX
    if (ponto.y < BORDA_PX) dy = -PASSO_PX
    else if (ponto.y > tamanho.y - BORDA_PX) dy = PASSO_PX
    if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: false })
  }

  const todasGeometrias = [
    ...fazendasGeometria,
    ...pastosComGeometria.map((p) => p.geometria as Geometry),
  ]
  const centroInicial: [number, number] = [-15.78, -47.93]

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el
        if (typeof refExterno === 'function') refExterno(el)
        else if (refExterno) refExterno.current = el
      }}
      // isolate: as camadas internas do Leaflet (marcadores, tooltips, controles) usam z-index
      // bem altos (até 1000, ver leaflet.css) que, sem isso, vazam pra fora do mapa e aparecem
      // por cima de qualquer modal com z-index mais baixo (ex.: MovimentacaoLotesModal/
      // DetalhePastoModal, ambos z-50) — isolate contém esse empilhamento inteiro dentro do
      // próprio mapa, sem precisar aumentar o z-index de cada modal que existir por cima dele
      className="isolate overflow-hidden rounded-control border border-border bg-surface"
      style={{ height: telaCheia ? '100vh' : altura }}
    >
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
              icon={seloIcone(c)}
              draggable={permitirArrastar}
              eventHandlers={{
                click: () => {
                  onSelecionarPasto?.(p.id)
                  onAbrirDetalhe?.(p.id)
                },
                drag: tratarArrastando,
                dragend: (e) => tratarSoltarSelo(p, e),
              }}
            >
              <Tooltip direction="top">
                <div>
                  <div className="font-semibold">{c.nome}</div>
                  <div>
                    {formatQuantidade(c.quantidade)} cab. · peso médio {formatPeso(c.pesoMedio)} kg
                  </div>
                  {/* nome do dono discreto, só quando a conta tem 2+ proprietários — ver
                      "Selos do Rebanho: nome do proprietário junto ao lote" no CLAUDE.md */}
                  {c.porProprietario && c.porProprietario.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-text-secondary">
                      {c.porProprietario.map((pp) => `${pp.nome} (${formatQuantidade(pp.quantidade)})`).join(' · ')}
                    </div>
                  )}
                </div>
              </Tooltip>
            </Marker>
          ))
        })}
        <AjustarZoom geometrias={todasGeometrias} />
        <ControleTelaCheia ativo={telaCheia} onToggle={alternarTelaCheia} />
        <InvalidarTamanho gatilho={telaCheia} />
      </MapContainer>
    </div>
  )
})

export default MapaDistribuicaoRebanho
