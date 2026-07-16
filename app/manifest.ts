import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ORION Agro',
    short_name: 'ORION Agro',
    description: 'Gestão pecuária multi-fazenda',
    start_url: '/',
    display: 'standalone',
    background_color: '#F6F8F7',
    theme_color: '#0E2A2E',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
