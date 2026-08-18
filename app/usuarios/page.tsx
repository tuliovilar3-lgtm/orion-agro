'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MODULOS, MODULOS_CONSULTA, type ModuloId } from '@/lib/modulos'
import CadastrarUsuarioModal from '@/components/usuarios/CadastrarUsuarioModal'

type UsuarioLinha = {
  id: string
  nome: string
  email: string
  dono: boolean
  ativo: boolean
  modo: 'CAMPO' | 'GESTAO' | 'CONSULTA'
  modulos: ModuloId[]
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
  )
}

export default function UsuariosPage() {
  const { isDono, usuarioApp, emModoSuporte, dominiosDaConta, loading: loadingAuth } = useAuth()
  // dono da própria conta pode gerenciar os funcionários dela — exceto
  // se for suporte "em casa" (não entrou em nenhuma conta ainda): sem
  // essa checagem extra, ele gerenciaria os funcionários da própria
  // Conta Principal sem precisar ter "Entrado" nela, inconsistente com
  // a trava geral de suporte (ver AuthContext.podeAcessar)
  const podeGerenciar = isDono && !(usuarioApp?.suporte && !emModoSuporte)
  const [usuarios, setUsuarios] = useState<UsuarioLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modalAberto, setModalAberto] = useState(false)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [modulosExpandidos, setModulosExpandidos] = useState<Set<string>>(new Set())
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<string | null>(null)
  const [senhaResetadaId, setSenhaResetadaId] = useState<string | null>(null)

  function alternarExpandido(id: string) {
    setModulosExpandidos((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  async function carregar() {
    setLoading(true)
    setErro(null)
    const resp = await fetch('/api/usuarios')
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      setErro(data.error || 'Não foi possível carregar os usuários.')
      setLoading(false)
      return
    }
    const data = await resp.json()
    setUsuarios(data.usuarios || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!loadingAuth && podeGerenciar) carregar()
    else if (!loadingAuth) setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingAuth, podeGerenciar])

  async function handleToggleAtivo(u: UsuarioLinha) {
    setSalvandoId(u.id)
    await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !u.ativo }),
    })
    setSalvandoId(null)
    carregar()
  }

  async function handleAlterarModo(u: UsuarioLinha, modo: 'CAMPO' | 'GESTAO' | 'CONSULTA') {
    setSalvandoId(u.id)
    // Consulta só pode ter os módulos de relatório — poda qualquer
    // módulo de escrita que já estivesse liberado antes da troca, na
    // mesma chamada (senão o usuário ficaria com acesso de escrita
    // "esquecido" mesmo depois de virar Consulta)
    const body: { modo: string; modulos?: ModuloId[] } = { modo }
    if (modo === 'CONSULTA') {
      body.modulos = u.modulos.filter((m) => MODULOS_CONSULTA.includes(m))
    }
    await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSalvandoId(null)
    carregar()
  }

  async function handleToggleModulo(u: UsuarioLinha, modulo: ModuloId) {
    const novosModulos = u.modulos.includes(modulo)
      ? u.modulos.filter((m) => m !== modulo)
      : [...u.modulos, modulo]
    setSalvandoId(u.id)
    await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulos: novosModulos }),
    })
    setSalvandoId(null)
    carregar()
  }

  async function handleResetarSenha(u: UsuarioLinha) {
    setSalvandoId(u.id)
    await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetSenha: true }),
    })
    setSalvandoId(null)
    setSenhaResetadaId(u.id)
    setTimeout(() => setSenhaResetadaId((atual) => (atual === u.id ? null : atual)), 5000)
  }

  async function handleExcluir(u: UsuarioLinha) {
    setSalvandoId(u.id)
    await fetch(`/api/usuarios/${u.id}`, { method: 'DELETE' })
    setSalvandoId(null)
    setConfirmandoExclusaoId(null)
    carregar()
  }

  if (loadingAuth || (loading && podeGerenciar)) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (!podeGerenciar) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text-primary">Acesso restrito</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
            {usuarioApp?.suporte && !emModoSuporte
              ? 'Entre em uma conta pela tela de Suporte pra gerenciar os usuários dela.'
              : 'Só o administrador do sistema pode gerenciar usuários.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-text-primary">Usuários</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Crie contas pra sua equipe e escolha quais módulos cada pessoa pode acessar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover"
        >
          + Novo usuário
        </button>
      </div>

      {erro && <p className="mt-4 text-sm text-error">Erro: {erro}</p>}

      <div className="mt-6 space-y-3">
        {usuarios.map((u) => (
          <div key={u.id} className="rounded-card border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-text-primary">{u.nome}</span>
                {u.dono && (
                  <span className="ml-2 rounded-control bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    Administrador
                  </span>
                )}
                {!u.ativo && (
                  <span className="ml-2 rounded-control bg-error-bg px-2 py-0.5 text-xs font-semibold text-error">
                    Inativo
                  </span>
                )}
                <div className="text-sm text-text-secondary">{u.email}</div>
              </div>
              {!u.dono && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={salvandoId === u.id}
                    onClick={() => handleResetarSenha(u)}
                    className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg disabled:opacity-60"
                  >
                    Redefinir senha
                  </button>
                  <button
                    type="button"
                    disabled={salvandoId === u.id}
                    onClick={() => handleToggleAtivo(u)}
                    className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg disabled:opacity-60"
                  >
                    {u.ativo ? 'Inativar' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    disabled={salvandoId === u.id}
                    onClick={() => setConfirmandoExclusaoId(u.id)}
                    className="rounded-control border border-error px-3 py-1.5 text-xs font-medium text-error hover:bg-error-bg disabled:opacity-60"
                  >
                    Excluir
                  </button>
                </div>
              )}
            </div>

            {senhaResetadaId === u.id && (
              <div className="mt-3 rounded-control bg-success-bg px-3 py-2 text-xs text-success">
                Senha redefinida para <span className="font-semibold">123456</span> — avise a pessoa
                pra trocar depois de entrar.
              </div>
            )}

            {confirmandoExclusaoId === u.id && (
              <div className="mt-3 rounded-control bg-error-bg px-3 py-2.5 text-sm text-error">
                <p>
                  Excluir <span className="font-semibold">{u.nome}</span> permanentemente? A conta de
                  login e todos os módulos liberados serão apagados — essa ação não pode ser desfeita.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={salvandoId === u.id}
                    onClick={() => handleExcluir(u)}
                    className="rounded-control bg-error px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {salvandoId === u.id ? 'Excluindo...' : 'Sim, excluir'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmandoExclusaoId(null)}
                    className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {!u.dono && (
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm">
                <label className="font-medium text-text-secondary">Modo de acesso</label>
                <select
                  disabled={salvandoId === u.id}
                  value={u.modo}
                  onChange={(e) => handleAlterarModo(u, e.target.value as 'CAMPO' | 'GESTAO' | 'CONSULTA')}
                  className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-brand-500"
                >
                  <option value="GESTAO">Gestão (completo)</option>
                  <option value="CAMPO">Campo (simplificado)</option>
                  <option value="CONSULTA">Consulta (só relatórios)</option>
                </select>
              </div>
            )}

            {!u.dono && (
              <div className="mt-3 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => alternarExpandido(u.id)}
                  className="flex w-full items-center justify-between text-left text-sm font-medium text-text-secondary"
                >
                  <span>
                    Módulos <span className="text-text-muted">({u.modulos.length} selecionado{u.modulos.length !== 1 ? 's' : ''})</span>
                  </span>
                  <span className="text-brand-500">{modulosExpandidos.has(u.id) ? '−' : '+'}</span>
                </button>
                {modulosExpandidos.has(u.id) && (
                  <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {(u.modo === 'CONSULTA'
                      ? MODULOS.filter((m) => m.somenteLeitura && dominiosDaConta.has(m.dominio))
                      : MODULOS.filter((m) => dominiosDaConta.has(m.dominio))
                    ).map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm text-text-primary">
                        <input
                          type="checkbox"
                          disabled={salvandoId === u.id}
                          checked={u.modulos.includes(m.id)}
                          onChange={() => handleToggleModulo(u, m.id)}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {modalAberto && (
        <CadastrarUsuarioModal
          onClose={() => setModalAberto(false)}
          onSaved={() => {
            setModalAberto(false)
            carregar()
          }}
        />
      )}
    </div>
  )
}
