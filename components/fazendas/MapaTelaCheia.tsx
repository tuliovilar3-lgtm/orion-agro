'use client'

import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

// botão de tela cheia + invalidação de tamanho, compartilhados por todo
// mapa Leaflet do app (MapaPastos e MapaDistribuicaoRebanho) — extraído
// daqui pra não duplicar a mesma lógica duas vezes

const ICONE_EXPANDIR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
const ICONE_RECOLHER =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'

// gerencia o wrapper (elemento que entra em tela cheia de verdade),
// o estado e o toggle — usado no componente que renderiza o <div> em
// volta do <MapContainer> (fora da árvore do react-leaflet)
export function useTelaCheia() {
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

  return { wrapperRef, telaCheia, alternarTelaCheia }
}

// botão nativo do Leaflet — empilha junto com outros controles no canto
// superior direito, sem precisar de posicionamento absoluto manual
export function ControleTelaCheia({ ativo, onToggle }: { ativo: boolean; onToggle: () => void }) {
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
export function InvalidarTamanho({ gatilho }: { gatilho: boolean }) {
  const map = useMap()
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 60)
    return () => clearTimeout(id)
  }, [map, gatilho])
  return null
}
