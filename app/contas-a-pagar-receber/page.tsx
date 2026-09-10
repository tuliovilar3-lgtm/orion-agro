'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuloGate from '@/components/ModuloGate'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatMoeda } from '@/lib/format'
import Required from '@/components/Required'

type Aba = 'aberto' | 'contas'

type ContaBancaria = { id: string; nome: string; especie: boolean; sistema: boolean; ativo: boolean; ordem: number }

type Baixa = {
  id: string
  numero_parcela: number
  total_parcelas: number
  data_vencimento: string | null
  data_pagamento: string | null
  valor: number
  conta_bancaria_id: string | null
  conta_bancaria: { nome: string } | null
  lancamento: {
    id: string
    fazenda_id: string
    data: string
    descricao: string
    numero_documento: string | null
    tipo: 'CREDITO' | 'DEBITO'
    fazenda: { nome: string } | null
    pessoa: { nome: string } | null
    proprietario: { nome: string } | null
  } | null
}

const SELECT_CLASS =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'
const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-text-secondary'

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function statusBaixa(b: Baixa): 'ABERTO' | 'VENCIDO' | 'PAGO' {
  if (b.data_pagamento) return 'PAGO'
  return b.data_vencimento && b.data_vencimento < hojeISO() ? 'VENCIDO' : 'ABERTO'
}

function BadgeStatus({ status }: { status: 'ABERTO' | 'VENCIDO' | 'PAGO' }) {
  const estilos =
    status === 'PAGO' ? 'bg-success-bg text-success' : status === 'VENCIDO' ? 'bg-error-bg text-error' : 'bg-bg text-text-secondary'
  const texto = status === 'PAGO' ? 'Pago' : status === 'VENCIDO' ? 'Vencido' : 'Aberto'
  return <span className={`rounded-control px-2 py-0.5 text-xs font-semibold ${estilos}`}>{texto}</span>
}

function formatData(iso: string | null): string {
  return iso ? iso.split('-').reverse().join('/') : '—'
}

export default function ContasPagarReceberPage() {
  const supabase = createClient()

  const [carregandoRecurso, setCarregandoRecurso] = useState(true)
  const [recursoContratado, setRecursoContratado] = useState(false)
  const [aba, setAba] = useState<Aba>('aberto')

  const [baixas, setBaixas] = useState<Baixa[]>([])
  const [loadingBaixas, setLoadingBaixas] = useState(true)
  const [fazendas, setFazendas] = useState<{ id: string; nome: string }[]>([])
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([])

  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'DEBITO' | 'CREDITO'>('TODOS')
  const [incluirPagas, setIncluirPagas] = useState(false)
  const [filtroFazendaId, setFiltroFazendaId] = useState('')

  const [darBaixaId, setDarBaixaId] = useState<string | null>(null)
  const [darBaixaData, setDarBaixaData] = useState(hojeISO())
  const [darBaixaContaId, setDarBaixaContaId] = useState('')

  const [novaContaNome, setNovaContaNome] = useState('')
  const [salvandoConta, setSalvandoConta] = useState(false)

  useEffect(() => {
    async function carregarRecurso() {
      const { data } = await supabase.from('configuracoes').select('controla_contas_pagar_receber').single()
      setRecursoContratado(data?.controla_contas_pagar_receber ?? false)
      setCarregandoRecurso(false)
    }
    carregarRecurso()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function carregarBaixas() {
    setLoadingBaixas(true)
    const { data, error } = await supabase
      .from('lancamento_baixas')
      .select(
        '*, conta_bancaria:contas_bancarias(nome), lancamento:lancamentos_financeiros(id, fazenda_id, data, descricao, numero_documento, tipo, fazenda:fazendas(nome), pessoa:pessoas!pessoa_id(nome), proprietario:pessoas!proprietario_id(nome))'
      )
      .order('data_vencimento', { ascending: true })
      .limit(200)
    if (!error) setBaixas((data || []) as unknown as Baixa[])
    setLoadingBaixas(false)
  }

  async function carregarContasBancarias() {
    const { data } = await supabase.from('contas_bancarias').select('id, nome, especie, sistema, ativo, ordem').order('ordem')
    setContasBancarias((data || []) as ContaBancaria[])
  }

  async function carregarFazendas() {
    const { data } = await supabase.from('fazendas').select('id, nome').eq('ativo', true).order('nome')
    setFazendas(data || [])
  }

  useEffect(() => {
    if (!recursoContratado) return
    carregarBaixas()
    carregarContasBancarias()
    carregarFazendas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recursoContratado])

  function abrirDarBaixa(b: Baixa) {
    setDarBaixaId(b.id)
    setDarBaixaData(hojeISO())
    setDarBaixaContaId('')
  }

  async function handleDarBaixa(id: string) {
    if (!darBaixaContaId) {
      alert('Escolha a conta bancária (ou Dinheiro em espécie).')
      return
    }
    const { error } = await supabase
      .from('lancamento_baixas')
      .update({ data_pagamento: darBaixaData, conta_bancaria_id: darBaixaContaId })
      .eq('id', id)
    setDarBaixaId(null)
    if (error) alert('Erro ao dar baixa: ' + error.message)
    else await carregarBaixas()
  }

  async function handleDesfazerBaixa(id: string) {
    const { error } = await supabase.from('lancamento_baixas').update({ data_pagamento: null, conta_bancaria_id: null }).eq('id', id)
    if (error) alert('Erro ao desfazer baixa: ' + error.message)
    else await carregarBaixas()
  }

  async function handleCriarContaBancaria(e: React.FormEvent) {
    e.preventDefault()
    const nome = novaContaNome.trim()
    if (!nome) return
    setSalvandoConta(true)
    const { error } = await supabase.from('contas_bancarias').insert({ nome })
    setSalvandoConta(false)
    if (error) {
      alert('Erro ao criar: ' + error.message)
      return
    }
    setNovaContaNome('')
    await carregarContasBancarias()
  }

  async function handleAlternarAtivoConta(c: ContaBancaria) {
    const { error } = await supabase.from('contas_bancarias').update({ ativo: !c.ativo }).eq('id', c.id)
    if (error) alert('Erro: ' + error.message)
    else await carregarContasBancarias()
  }

  const baixasFiltradas = baixas.filter((b) => {
    if (!b.lancamento) return false
    if (filtroTipo !== 'TODOS' && b.lancamento.tipo !== filtroTipo) return false
    if (filtroFazendaId && b.lancamento.fazenda_id !== filtroFazendaId) return false
    if (!incluirPagas && statusBaixa(b) === 'PAGO') return false
    return true
  })

  if (carregandoRecurso) {
    return (
      <ModuloGate modulo="contas_pagar_receber">
        <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
          <div className="h-40 animate-pulse rounded-card bg-border" />
        </div>
      </ModuloGate>
    )
  }

  if (!recursoContratado) {
    return (
      <ModuloGate modulo="contas_pagar_receber">
        <div className="mx-auto max-w-2xl px-6 py-12">
          <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
            <p className="text-base font-semibold text-text-primary">Recurso não contratado</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              Fale com o Suporte pra contratar o recurso "Contas a Pagar/Receber".
            </p>
          </div>
        </div>
      </ModuloGate>
    )
  }

  return (
    <ModuloGate modulo="contas_pagar_receber">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <h1 className="text-2xl font-extrabold text-text-primary">Contas a Pagar/Receber</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Acompanhamento dos lançamentos com vencimento/pagamento — o cadastro continua em Lançamentos Financeiros.
        </p>

        <div className="mt-6 flex gap-1 border-b border-border">
          <button
            type="button"
            onClick={() => setAba('aberto')}
            className={`px-4 py-2 text-sm font-semibold ${aba === 'aberto' ? 'border-b-2 border-brand-500 text-brand-700' : 'text-text-secondary'}`}
          >
            Em aberto
          </button>
          <button
            type="button"
            onClick={() => setAba('contas')}
            className={`px-4 py-2 text-sm font-semibold ${aba === 'contas' ? 'border-b-2 border-brand-500 text-brand-700' : 'text-text-secondary'}`}
          >
            Contas Bancárias
          </button>
        </div>

        {aba === 'aberto' ? (
          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)} className="rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary">
                <option value="TODOS">Débitos e Créditos</option>
                <option value="DEBITO">Só Débitos</option>
                <option value="CREDITO">Só Créditos</option>
              </select>
              <select value={filtroFazendaId} onChange={(e) => setFiltroFazendaId(e.target.value)} className="rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary">
                <option value="">Todas as fazendas</option>
                {fazendas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
              <label className="ml-auto flex items-center gap-2 text-sm text-text-primary">
                <input type="checkbox" className="accent-brand-500" checked={incluirPagas} onChange={(e) => setIncluirPagas(e.target.checked)} />
                Incluir pagas
              </label>
            </div>

            {loadingBaixas ? (
              <div className="space-y-2">
                <div className="h-12 animate-pulse rounded-card bg-border" />
                <div className="h-12 animate-pulse rounded-card bg-border" />
              </div>
            ) : baixasFiltradas.length === 0 ? (
              <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center">
                <p className="text-sm font-semibold text-text-primary">Nada em aberto por aqui</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Lançamentos com vencimento aparecem aqui — cadastre-os em{' '}
                  <a href="/financeiro" className="font-medium text-brand-500 hover:underline">
                    Lançamentos Financeiros
                  </a>
                  .
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-card border border-border bg-surface">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2">Pagamento</th>
                      <th className="px-3 py-2">Parcela</th>
                      <th className="px-3 py-2">Fazenda</th>
                      <th className="px-3 py-2">Fornecedor/Cliente</th>
                      <th className="px-3 py-2">Proprietário</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Emissão</th>
                      <th className="px-3 py-2">Nº doc.</th>
                      <th className="px-3 py-2">Observação</th>
                      <th className="px-3 py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baixasFiltradas.map((b) => {
                      const st = statusBaixa(b)
                      const emAberto = darBaixaId === b.id
                      return (
                        <tr key={b.id} className="border-b border-border last:border-0 align-top">
                          <td className="px-3 py-2 tabular-nums">{formatData(b.data_vencimento)}</td>
                          <td className="px-3 py-2 tabular-nums">{formatData(b.data_pagamento)}</td>
                          <td className="px-3 py-2 tabular-nums">{b.total_parcelas > 1 ? `${b.numero_parcela}/${b.total_parcelas}` : '—'}</td>
                          <td className="px-3 py-2">{b.lancamento?.fazenda?.nome ?? '—'}</td>
                          <td className="px-3 py-2">{b.lancamento?.pessoa?.nome ?? '—'}</td>
                          <td className="px-3 py-2">{b.lancamento?.proprietario?.nome ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatMoeda(b.valor)}</td>
                          <td className="px-3 py-2">
                            <BadgeStatus status={st} />
                          </td>
                          <td className="px-3 py-2 tabular-nums">{formatData(b.lancamento?.data ?? null)}</td>
                          <td className="px-3 py-2">{b.lancamento?.numero_documento ?? '—'}</td>
                          <td className="px-3 py-2 text-text-secondary">{b.lancamento?.descricao ?? '—'}</td>
                          <td className="px-3 py-2">
                            {emAberto ? (
                              <div className="flex flex-col gap-1.5">
                                <input
                                  type="date"
                                  value={darBaixaData}
                                  onChange={(e) => setDarBaixaData(e.target.value)}
                                  className="rounded-control border border-border bg-surface px-2 py-1 text-xs"
                                />
                                <select
                                  value={darBaixaContaId}
                                  onChange={(e) => setDarBaixaContaId(e.target.value)}
                                  className="rounded-control border border-border bg-surface px-2 py-1 text-xs"
                                >
                                  <option value="">Conta...</option>
                                  {contasBancarias
                                    .filter((c) => c.ativo)
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.nome}
                                      </option>
                                    ))}
                                </select>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => handleDarBaixa(b.id)} className="text-xs font-medium text-brand-500 hover:underline">
                                    Salvar
                                  </button>
                                  <button type="button" onClick={() => setDarBaixaId(null)} className="text-xs font-medium text-text-secondary hover:underline">
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : st === 'PAGO' ? (
                              <button type="button" onClick={() => handleDesfazerBaixa(b.id)} className="text-xs font-medium text-text-secondary hover:text-warning hover:underline">
                                Desfazer baixa
                              </button>
                            ) : (
                              <button type="button" onClick={() => abrirDarBaixa(b)} className="text-xs font-medium text-brand-500 hover:underline">
                                Dar baixa
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 max-w-lg">
            <form onSubmit={handleCriarContaBancaria} onKeyDown={bloquearEnvioPorEnter} className="mb-4 flex items-end gap-2">
              <div className="flex-1">
                <label className={LABEL_CLASS}>
                  Nova conta<Required />
                </label>
                <input required value={novaContaNome} onChange={(e) => setNovaContaNome(e.target.value)} className={SELECT_CLASS} />
              </div>
              <button
                type="submit"
                disabled={salvandoConta}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-60"
              >
                {salvandoConta ? 'Salvando...' : 'Adicionar'}
              </button>
            </form>

            <div className="space-y-2">
              {contasBancarias.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-card border border-border bg-surface p-3">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{c.nome}</p>
                    {c.especie && <p className="text-xs text-text-muted">Dinheiro em espécie</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-control px-2 py-0.5 text-xs font-semibold ${c.ativo ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}>
                      {c.ativo ? 'Ativa' : 'Inativa'}
                    </span>
                    <button type="button" onClick={() => handleAlternarAtivoConta(c)} className="text-xs font-medium text-brand-500 hover:underline">
                      {c.ativo ? 'Inativar' : 'Ativar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModuloGate>
  )
}
