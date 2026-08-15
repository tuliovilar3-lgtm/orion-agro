'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import CadastrarPessoaModal from '@/components/pessoas/CadastrarPessoaModal'
import ModuloGate from '@/components/ModuloGate'

type Papel = 'CLIENTE' | 'FORNECEDOR' | 'PROPRIETARIO' | 'FUNCIONARIO'

const PAPEIS: { valor: Papel; rotulo: string }[] = [
  { valor: 'CLIENTE', rotulo: 'Cliente' },
  { valor: 'FORNECEDOR', rotulo: 'Fornecedor' },
  { valor: 'PROPRIETARIO', rotulo: 'Proprietário' },
  { valor: 'FUNCIONARIO', rotulo: 'Funcionário' },
]

type Pessoa = {
  id: string
  nome: string
  documento: string | null
  nome_contato: string | null
  telefone: string | null
  celular: string | null
  ativo: boolean
  papeis: Papel[]
}

function IconEditar() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function IconToggle({ ativo }: { ativo: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      {ativo ? <path d="M8 12.5l2.5 2.5L16 9.5" /> : <path d="M9 9l6 6M15 9l-6 6" />}
    </svg>
  )
}

function IconExcluir() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  )
}

function RowSkeleton() {
  return (
    <tr className="animate-pulse border-b border-border">
      <td className="px-4 py-3"><div className="h-3 w-40 rounded bg-border" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-border" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-border" /></td>
      <td className="px-4 py-3" />
    </tr>
  )
}

export default function PessoasPage() {
  const supabase = createClient()

  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [filtroNome, setFiltroNome] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<Papel | ''>('')
  const [filtroDocumento, setFiltroDocumento] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [pessoaEditandoId, setPessoaEditandoId] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  async function carregarPessoas() {
    setLoading(true)
    const { data, error } = await supabase
      .from('pessoas')
      .select('id, nome, documento, nome_contato, telefone, celular, ativo, pessoa_papeis(papel)')
      .order('nome')
    if (error) {
      setErro(error.message)
    } else {
      setErro(null)
      setPessoas(
        (data || []).map((p: any) => ({
          id: p.id,
          nome: p.nome,
          documento: p.documento,
          nome_contato: p.nome_contato,
          telefone: p.telefone,
          celular: p.celular,
          ativo: p.ativo,
          papeis: (p.pessoa_papeis || []).map((pp: any) => pp.papel as Papel),
        }))
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    carregarPessoas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pessoasFiltradas = useMemo(() => {
    return pessoas.filter((p) => {
      if (filtroNome && !p.nome.toLowerCase().includes(filtroNome.toLowerCase())) return false
      if (filtroTipo && !p.papeis.includes(filtroTipo)) return false
      if (filtroDocumento && !(p.documento || '').toLowerCase().includes(filtroDocumento.toLowerCase())) return false
      return true
    })
  }, [pessoas, filtroNome, filtroTipo, filtroDocumento])

  function limparFiltros() {
    setFiltroNome('')
    setFiltroTipo('')
    setFiltroDocumento('')
  }

  function abrirNova() {
    setPessoaEditandoId(null)
    setModalAberto(true)
  }

  function abrirEdicao(id: string) {
    setPessoaEditandoId(id)
    setModalAberto(true)
  }

  async function handleSalva() {
    setModalAberto(false)
    await carregarPessoas()
  }

  async function handleAlternarAtivo(p: Pessoa) {
    const { error } = await supabase.from('pessoas').update({ ativo: !p.ativo }).eq('id', p.id)
    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setPessoas((prev) => prev.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)))
    }
  }

  async function handleExcluir(p: Pessoa) {
    setExcluindo(true)
    const { error } = await supabase.from('pessoas').delete().eq('id', p.id)
    setExcluindo(false)
    setConfirmandoExclusao(null)
    if (error) {
      alert(error.message)
      return
    }
    await carregarPessoas()
  }

  return (
    <ModuloGate modulo="pessoas">
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-text-primary">Pessoas e Empresas</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Cadastro único de proprietários, clientes, fornecedores e funcionários — uma mesma pessoa pode ter mais de um papel.
          </p>
        </div>
        <button
          type="button"
          onClick={abrirNova}
          className="shrink-0 rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover"
        >
          + Nova Pessoa/Empresa
        </button>
      </div>

      <div className="mt-6 rounded-card border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Nome</label>
            <input
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={filtroNome}
              onChange={(e) => setFiltroNome(e.target.value)}
              placeholder="Buscar por nome..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Tipo</label>
            <select
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as Papel | '')}
            >
              <option value="">Todos</option>
              {PAPEIS.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">CPF/CNPJ</label>
            <input
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500"
              value={filtroDocumento}
              onChange={(e) => setFiltroDocumento(e.target.value)}
              placeholder="Buscar por documento..."
            />
          </div>
        </div>
        {(filtroNome || filtroTipo || filtroDocumento) && (
          <button type="button" onClick={limparFiltros} className="mt-3 text-xs text-brand-500 underline">
            Limpar filtros
          </button>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-card border border-border bg-surface">
        {erro ? (
          <p className="p-5 text-sm text-error">Erro: {erro}</p>
        ) : !loading && pessoasFiltradas.length === 0 ? (
          <div className="border-dashed px-6 py-12 text-center">
            <p className="text-base font-semibold text-text-primary">
              {pessoas.length === 0 ? 'Nenhuma pessoa ou empresa cadastrada ainda' : 'Nenhum resultado para esse filtro'}
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
              {pessoas.length === 0
                ? 'Cadastre proprietários, clientes, fornecedores e funcionários aqui pra poder selecioná-los em fazendas e movimentações.'
                : 'Ajuste os filtros acima ou limpe-os pra ver todas as pessoas cadastradas.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-text-secondary">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : (
                pessoasFiltradas.map((p) => (
                  <tr key={p.id} className={`border-b border-border last:border-0 ${!p.ativo ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-primary">{p.nome}</div>
                      {p.documento && <div className="text-xs text-text-muted">{p.documento}</div>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {p.papeis.length > 0
                        ? p.papeis.map((papel) => PAPEIS.find((x) => x.valor === papel)?.rotulo).join(' · ')
                        : '—'}
                      {!p.ativo && ' · inativo'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{p.nome_contato || '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{p.telefone || p.celular || '—'}</td>
                    <td className="px-4 py-3">
                      {confirmandoExclusao === p.id ? (
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <span className="text-error">Excluir {p.nome}?</span>
                          <button
                            type="button"
                            disabled={excluindo}
                            onClick={() => handleExcluir(p)}
                            className="font-semibold text-error underline"
                          >
                            Sim
                          </button>
                          <button type="button" onClick={() => setConfirmandoExclusao(null)} className="text-text-secondary underline">
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3 text-text-secondary">
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => abrirEdicao(p.id)}
                            className="hover:text-brand-500"
                          >
                            <IconEditar />
                          </button>
                          <button
                            type="button"
                            title={p.ativo ? 'Inativar' : 'Ativar'}
                            onClick={() => handleAlternarAtivo(p)}
                            className={p.ativo ? 'hover:text-success' : 'text-text-muted hover:text-success'}
                          >
                            <IconToggle ativo={p.ativo} />
                          </button>
                          <button
                            type="button"
                            title="Excluir"
                            onClick={() => setConfirmandoExclusao(p.id)}
                            className="hover:text-error"
                          >
                            <IconExcluir />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalAberto && (
        <CadastrarPessoaModal
          pessoaId={pessoaEditandoId || undefined}
          onClose={() => setModalAberto(false)}
          onSaved={handleSalva}
        />
      )}
    </div>
    </ModuloGate>
  )
}
