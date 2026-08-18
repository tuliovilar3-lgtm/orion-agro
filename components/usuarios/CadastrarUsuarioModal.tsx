'use client'

import { useState } from 'react'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { MODULOS, MODULOS_CONSULTA, type ModuloId } from '@/lib/modulos'
import { useAuth } from '@/contexts/AuthContext'

export default function CadastrarUsuarioModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [modo, setModo] = useState<'GESTAO' | 'CAMPO' | 'CONSULTA'>('GESTAO')
  const [modulosSelecionados, setModulosSelecionados] = useState<Set<ModuloId>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const { dominiosDaConta } = useAuth()

  // só oferece telas de domínio que a conta realmente contratou — sem
  // isso o dono marcaria uma tela que não faz nada em runtime (já
  // bloqueada por podeAcessar), só clareza de UI, não correção de bug
  const modulosDoDominio = MODULOS.filter((m) => dominiosDaConta.has(m.dominio))
  const modulosDisponiveis = modo === 'CONSULTA' ? modulosDoDominio.filter((m) => m.somenteLeitura) : modulosDoDominio

  function handleMudarModo(novoModo: 'GESTAO' | 'CAMPO' | 'CONSULTA') {
    setModo(novoModo)
    // Consulta só pode ter os módulos de relatório — poda qualquer
    // módulo de escrita que já estivesse marcado antes da troca
    if (novoModo === 'CONSULTA') {
      setModulosSelecionados((prev) => new Set([...prev].filter((id) => MODULOS_CONSULTA.includes(id))))
    }
  }

  function alternarModulo(id: ModuloId) {
    setModulosSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const resp = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha, modo, modulos: Array.from(modulosSelecionados) }),
    })
    setEnviando(false)
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      setErro(data.error || 'Não foi possível criar o usuário.')
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-bold text-text-primary">Novo usuário</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Marque os módulos que essa pessoa pode acessar. Sem nenhum módulo marcado, ela consegue
          entrar mas só vê o Painel.
        </p>

        <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Nome
              <Required />
            </label>
            <input
              required
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              E-mail
              <Required />
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Senha inicial
              <Required />
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Modo de acesso</label>
            <div className="flex flex-wrap gap-4 text-sm text-text-primary">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={modo === 'GESTAO'} onChange={() => handleMudarModo('GESTAO')} />
                Gestão (completo)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={modo === 'CAMPO'} onChange={() => handleMudarModo('CAMPO')} />
                Campo (simplificado)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={modo === 'CONSULTA'} onChange={() => handleMudarModo('CONSULTA')} />
                Consulta (só relatórios)
              </label>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {modo === 'CAMPO'
                ? 'Modo Campo troca a sidebar por uma barra de abas simplificada com Início + os módulos liberados abaixo — pensado pra uso no celular.'
                : modo === 'CONSULTA'
                  ? 'Modo Consulta só pode acessar os relatórios abaixo — nenhuma tela de lançamento ou cadastro.'
                  : 'Modo Gestão usa a sidebar completa de sempre.'}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Módulos liberados</label>
            <div className="grid grid-cols-1 gap-1.5 rounded-control border border-border p-3 sm:grid-cols-2">
              {modulosDisponiveis.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={modulosSelecionados.has(m.id)}
                    onChange={() => alternarModulo(m.id)}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          {erro && <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-control border border-border px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
            >
              {enviando ? 'Criando...' : 'Criar usuário'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
