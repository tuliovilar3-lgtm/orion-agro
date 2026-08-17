'use client'

import { useAuth } from '@/contexts/AuthContext'

// indicador persistente enquanto um usuário de suporte está navegando
// numa conta de cliente (migração 048) — renderizado como a primeira
// coisa dentro de <main>, nos dois layouts (Sidebar e ModoCampoShell),
// pra nunca confundir com a própria sessão do usuário
export default function SuporteBanner() {
  const { emModoSuporte, contaSuporteAtiva, sairDoSuporte } = useAuth()

  if (!emModoSuporte || !contaSuporteAtiva) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-warning px-4 py-2 text-sm text-white">
      <span>
        Você está vendo <span className="font-semibold">{contaSuporteAtiva.nome}</span> como Suporte
      </span>
      <button type="button" onClick={sairDoSuporte} className="font-semibold underline underline-offset-2">
        Sair
      </button>
    </div>
  )
}
