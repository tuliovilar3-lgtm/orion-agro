'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { DOMINIOS, type DominioId } from '@/lib/modulos'
import { RECURSOS, type RecursoId } from '@/lib/conta-recursos'
import type { TipoLimiteConta } from '@/lib/conta-limites'
import { formatQuantidade } from '@/lib/format'

type ContaRecurso = { dominio: DominioId; recurso: RecursoId; ativo: boolean }
type ContaLimite = { tipo_limite: TipoLimiteConta; valor: number }

const CARDS_LIMITE: { tipo: TipoLimiteConta; label: string; unidade: string }[] = [
  { tipo: 'fazendas', label: 'Multifazendas', unidade: 'fazendas cadastradas' },
  { tipo: 'proprietarios', label: 'Multiproprietário', unidade: 'proprietários cadastrados' },
]

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-5">
      <div className="h-4 w-40 rounded bg-border" />
      <div className="mt-3 h-3 w-56 rounded bg-border" />
    </div>
  )
}

function Badge({ ativo }: { ativo: boolean }) {
  return ativo ? (
    <span className="rounded-control bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">Contratado</span>
  ) : (
    <span className="rounded-control bg-bg px-2 py-0.5 text-xs font-semibold text-text-muted">Não contratado</span>
  )
}

export default function ModulosPage() {
  const { isDono, usuarioApp, emModoSuporte, dominiosDaConta, loading: loadingAuth } = useAuth()
  // mesma trava já usada em /usuarios: dono da própria conta, exceto se
  // for suporte "em casa" (não entrou em nenhuma conta ainda)
  const podeGerenciar = isDono && !(usuarioApp?.suporte && !emModoSuporte)

  const [loading, setLoading] = useState(true)
  const [contaRecursos, setContaRecursos] = useState<ContaRecurso[]>([])
  const [contaLimites, setContaLimites] = useState<ContaLimite[]>([])
  const [contagemFazendas, setContagemFazendas] = useState(0)
  const [contagemProprietarios, setContagemProprietarios] = useState(0)

  const [configuracaoId, setConfiguracaoId] = useState<string | null>(null)
  const [controlaSubtipoArea, setControlaSubtipoArea] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (loadingAuth || !podeGerenciar) {
      if (!loadingAuth) setLoading(false)
      return
    }
    setLoading(true)
    Promise.all([
      supabase.from('conta_recursos').select('dominio, recurso, ativo'),
      supabase.from('conta_limites').select('tipo_limite, valor'),
      supabase.from('fazendas').select('id', { count: 'exact', head: true }),
      supabase.from('pessoa_papeis').select('pessoa_id', { count: 'exact', head: true }).eq('papel', 'PROPRIETARIO'),
      supabase.from('configuracoes').select('id, controla_subtipo_area').single(),
    ]).then(([recursos, limites, fazendas, proprietarios, config]) => {
      setContaRecursos((recursos.data as ContaRecurso[]) || [])
      setContaLimites((limites.data as ContaLimite[]) || [])
      setContagemFazendas(fazendas.count ?? 0)
      setContagemProprietarios(proprietarios.count ?? 0)
      if (config.data) {
        setConfiguracaoId(config.data.id)
        setControlaSubtipoArea(config.data.controla_subtipo_area)
      }
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingAuth, podeGerenciar])

  async function handleToggleControlaSubtipoArea() {
    if (!configuracaoId) return
    const novoValor = !controlaSubtipoArea
    setControlaSubtipoArea(novoValor)
    const { error } = await supabase
      .from('configuracoes')
      .update({ controla_subtipo_area: novoValor })
      .eq('id', configuracaoId)
    if (error) {
      alert('Erro ao atualizar: ' + error.message)
      setControlaSubtipoArea(!novoValor)
    }
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
              ? 'Entre em uma conta pela tela de Suporte pra ver os módulos dela.'
              : 'Só o administrador do sistema pode ver os módulos contratados.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Módulos e Recursos</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Veja o que sua conta tem contratado hoje e o que ainda está disponível pra contratar.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-text-secondary">Domínios</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DOMINIOS.map((d) => {
          const ativo = dominiosDaConta.has(d.id)
          const recursosDoDominio = RECURSOS.filter((r) => r.dominio === d.id)
          return (
            <div
              key={d.id}
              className={`rounded-card border p-5 ${
                ativo ? 'border-border bg-surface' : 'border-dashed border-border bg-surface opacity-60'
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                {d.label}
                <Badge ativo={ativo} />
              </p>
              {ativo ? (
                recursosDoDominio.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    {recursosDoDominio.map((r) => {
                      const recursoAtivo =
                        contaRecursos.find((cr) => cr.dominio === r.dominio && cr.recurso === r.id)?.ativo === true
                      return (
                        <p key={r.id} className="flex items-center gap-2 text-sm text-text-secondary">
                          {r.label}
                          <Badge ativo={recursoAtivo} />
                        </p>
                      )
                    })}
                  </div>
                )
              ) : (
                <p className="mt-1.5 text-sm text-text-secondary">Fale com o Suporte pra contratar esse módulo.</p>
              )}
            </div>
          )
        })}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-text-secondary">Limites de uso</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS_LIMITE.map((c) => {
          const limite = contaLimites.find((l) => l.tipo_limite === c.tipo)?.valor ?? null
          const contagem = c.tipo === 'fazendas' ? contagemFazendas : contagemProprietarios
          const pct = limite ? Math.min(999, (contagem / limite) * 100) : 0
          const cor = pct >= 100 ? 'error' : pct >= 80 ? 'warning' : 'success'
          return (
            <div key={c.tipo} className="rounded-card border border-border bg-surface p-5">
              <p className="text-sm font-semibold text-text-primary">{c.label}</p>
              {limite === null ? (
                <p className="mt-1.5 text-sm text-text-secondary">
                  {formatQuantidade(contagem)} {c.unidade} · sem limite
                </p>
              ) : (
                <div className="mt-2.5 flex items-center gap-2.5">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg">
                    <div
                      className={`h-full rounded-full transition-all ${
                        cor === 'error' ? 'bg-error' : cor === 'warning' ? 'bg-warning' : 'bg-success'
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span
                    className={`shrink-0 text-sm font-bold ${
                      cor === 'error' ? 'text-error' : cor === 'warning' ? 'text-warning' : 'text-text-secondary'
                    }`}
                  >
                    {formatQuantidade(contagem)} de {formatQuantidade(limite)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Configurações adicionais
      </h2>
      <div className="mt-3 rounded-card border border-border bg-surface p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <input
            type="checkbox"
            className="accent-brand-500"
            checked={controlaSubtipoArea}
            disabled={!configuracaoId}
            onChange={handleToggleControlaSubtipoArea}
          />
          Controle de subtipo de uso de área
        </label>
        <p className="mt-1 text-sm text-text-secondary">
          Habilita detalhar Pecuária e Agricultura por subtipo (ex.: Corte/Leite, Soja/Milho) em Gestão de Áreas.
        </p>
      </div>
    </div>
  )
}
