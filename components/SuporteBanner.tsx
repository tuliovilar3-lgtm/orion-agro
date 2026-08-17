'use client'

import { useAuth } from '@/contexts/AuthContext'

// indicador persistente enquanto um usuário de suporte está navegando
// numa conta de cliente (migração 048) — renderizado como a primeira
// coisa dentro de <main>, nos dois layouts (Sidebar e ModoCampoShell),
// pra nunca confundir com a própria sessão do usuário. `className` é
// quem decide o `sticky top-*` certo em cada shell (a barra superior de
// cada um tem uma altura/presença diferente — ver AppShell.tsx e
// ModoCampoShell.tsx), pra grudar sempre logo abaixo dela, nunca por
// cima, ao rolar a página.
export default function SuporteBanner({ className = '' }: { className?: string }) {
  const { emModoSuporte, contaSuporteAtiva, sairDoSuporte } = useAuth()

  if (!emModoSuporte || !contaSuporteAtiva) return null

  return (
    <div className={`z-20 flex flex-wrap items-center justify-between gap-2 bg-warning px-4 py-2 text-sm text-white ${className}`}>
      <span>
        Você está vendo <span className="font-semibold">{contaSuporteAtiva.nome}</span> como Suporte
      </span>
      <button type="button" onClick={sairDoSuporte} className="font-semibold underline underline-offset-2">
        Sair
      </button>
    </div>
  )
}
