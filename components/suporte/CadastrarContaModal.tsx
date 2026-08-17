'use client'

import { useState } from 'react'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { MODULOS, type ModuloId } from '@/lib/modulos'

// onboarding de conta de cliente nova (migração 049 + app/api/contas)
// — mesmo molde visual de components/usuarios/CadastrarUsuarioModal.tsx
// (campos, Required, bloquearEnvioPorEnter, erro inline), estendido com
// nome da conta e limites numéricos opcionais (Multifazendas/
// Multiproprietário). Só Suporte abre este modal (botão vive em
// SuporteHome.tsx, que só renderiza pra usuarios_app.suporte = true).
export default function CadastrarContaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [nomeConta, setNomeConta] = useState('')
  const [donoNome, setDonoNome] = useState('')
  const [donoEmail, setDonoEmail] = useState('')
  const [donoSenha, setDonoSenha] = useState('')
  const [modulosSelecionados, setModulosSelecionados] = useState<Set<ModuloId>>(new Set())
  const [limitesAbertos, setLimitesAbertos] = useState(false)
  const [limiteFazendas, setLimiteFazendas] = useState('')
  const [limiteProprietarios, setLimiteProprietarios] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

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
    const resp = await fetch('/api/contas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nomeConta,
        donoNome,
        donoEmail,
        donoSenha,
        modulos: Array.from(modulosSelecionados),
        limiteFazendas: limiteFazendas ? Number(limiteFazendas) : undefined,
        limiteProprietarios: limiteProprietarios ? Number(limiteProprietarios) : undefined,
      }),
    })
    setEnviando(false)
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      setErro(data.error || 'Não foi possível criar a conta.')
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-bold text-text-primary">Nova conta</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Cria a conta do cliente, o primeiro usuário (administrador dela) e os módulos contratados,
          tudo de uma vez.
        </p>

        <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Nome da conta
              <Required />
            </label>
            <input
              required
              autoFocus
              value={nomeConta}
              onChange={(e) => setNomeConta(e.target.value)}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm font-semibold text-text-primary">Administrador da conta</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Nome
                  <Required />
                </label>
                <input
                  required
                  value={donoNome}
                  onChange={(e) => setDonoNome(e.target.value)}
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
                  value={donoEmail}
                  onChange={(e) => setDonoEmail(e.target.value)}
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
                  value={donoSenha}
                  onChange={(e) => setDonoSenha(e.target.value)}
                  className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Módulos contratados</label>
            <div className="grid grid-cols-1 gap-1.5 rounded-control border border-border p-3 sm:grid-cols-2">
              {MODULOS.map((m) => (
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
            <p className="mt-1 text-xs text-text-muted">
              Sem nenhum módulo marcado, o administrador consegue entrar mas só vê o Painel.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setLimitesAbertos((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-medium text-text-secondary"
            >
              <span>Limites (opcional)</span>
              <span className="text-brand-500">{limitesAbertos ? '−' : '+'}</span>
            </button>
            {limitesAbertos && (
              <div className="mt-2.5 space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Limite de fazendas (Multifazendas)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={limiteFazendas}
                    onChange={(e) => setLimiteFazendas(e.target.value)}
                    placeholder="Em branco = sem limite"
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Limite de proprietários (Multiproprietário)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={limiteProprietarios}
                    onChange={(e) => setLimiteProprietarios(e.target.value)}
                    placeholder="Em branco = sem limite"
                    className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            )}
          </div>

          {erro && <div className="rounded-control bg-error-bg px-3 py-2 text-xs text-error">{erro}</div>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
            >
              {enviando ? 'Criando...' : 'Criar conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
