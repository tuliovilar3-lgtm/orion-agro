'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { excedeuLimiteConta } from '@/lib/conta-limites'

type TipoPessoa = 'FISICA' | 'JURIDICA'
type Papel = 'CLIENTE' | 'FORNECEDOR' | 'PROPRIETARIO' | 'FUNCIONARIO'

const PAPEIS: { valor: Papel; rotulo: string }[] = [
  { valor: 'CLIENTE', rotulo: 'Cliente' },
  { valor: 'FORNECEDOR', rotulo: 'Fornecedor' },
  { valor: 'PROPRIETARIO', rotulo: 'Proprietário' },
  { valor: 'FUNCIONARIO', rotulo: 'Funcionário' },
]

const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'

export default function CadastrarPessoaModal({
  pessoaId,
  onClose,
  onSaved,
}: {
  pessoaId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const editando = !!pessoaId

  const [carregando, setCarregando] = useState(editando)
  const [salvando, setSalvando] = useState(false)

  const [tipoPessoa, setTipoPessoa] = useState<TipoPessoa>('FISICA')
  const [papeis, setPapeis] = useState<Papel[]>([])
  // papéis como estavam ao abrir o modal — usado só pra saber se
  // PROPRIETARIO está sendo adicionado agora (checa limite) ou já
  // existia antes (edição, não precisa checar de novo)
  const [papeisOriginais, setPapeisOriginais] = useState<Papel[]>([])
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [rg, setRg] = useState('')
  const [inscricaoEstadual, setInscricaoEstadual] = useState('')
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('')
  const [nomeContato, setNomeContato] = useState('')
  const [nacionalidade, setNacionalidade] = useState('Brasil')

  const [cep, setCep] = useState('')
  const [endereco, setEndereco] = useState('')
  const [numero, setNumero] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [pais, setPais] = useState('Brasil')

  const [telefone, setTelefone] = useState('')
  const [celular, setCelular] = useState('')
  const [email, setEmail] = useState('')
  const [observacoes, setObservacoes] = useState('')

  useEffect(() => {
    if (!pessoaId) return
    setCarregando(true)
    Promise.all([
      supabase.from('pessoas').select('*').eq('id', pessoaId).single(),
      supabase.from('pessoa_papeis').select('papel').eq('pessoa_id', pessoaId),
    ]).then(([{ data }, { data: papeisData }]) => {
      if (data) {
        setTipoPessoa(data.tipo_pessoa || 'FISICA')
        setNome(data.nome)
        setDocumento(data.documento || '')
        setRg(data.rg || '')
        setInscricaoEstadual(data.inscricao_estadual || '')
        setInscricaoMunicipal(data.inscricao_municipal || '')
        setNomeContato(data.nome_contato || '')
        setNacionalidade(data.nacionalidade || 'Brasil')
        setCep(data.cep || '')
        setEndereco(data.endereco || '')
        setNumero(data.numero || '')
        setBairro(data.bairro || '')
        setCidade(data.cidade || '')
        setEstado(data.estado || '')
        setPais(data.pais || 'Brasil')
        setTelefone(data.telefone || '')
        setCelular(data.celular || '')
        setEmail(data.email || '')
        setObservacoes(data.observacoes || '')
      }
      const papeisCarregados = ((papeisData || []) as any[]).map((p) => p.papel as Papel)
      setPapeis(papeisCarregados)
      setPapeisOriginais(papeisCarregados)
      setCarregando(false)
    })
  }, [pessoaId, supabase])

  function alternarPapel(papel: Papel) {
    setPapeis((prev) => (prev.includes(papel) ? prev.filter((p) => p !== papel) : [...prev, papel]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return

    // só checa o limite quando PROPRIETARIO está sendo adicionado agora
    // — editar uma pessoa que já tinha esse papel não deve ser bloqueado
    // de novo pelo mesmo limite
    if (papeis.includes('PROPRIETARIO') && !papeisOriginais.includes('PROPRIETARIO')) {
      const { count } = await supabase
        .from('pessoa_papeis')
        .select('id', { count: 'exact', head: true })
        .eq('papel', 'PROPRIETARIO')
      if (await excedeuLimiteConta(supabase, 'proprietarios', count || 0)) {
        alert('Sua conta atingiu o limite de proprietários do plano contratado — contrate o módulo Multiproprietário pra adicionar mais.')
        return
      }
    }

    setSalvando(true)
    const payload = {
      tipo_pessoa: tipoPessoa,
      nome: nome.trim(),
      documento: documento.trim() || null,
      rg: rg.trim() || null,
      inscricao_estadual: inscricaoEstadual.trim() || null,
      inscricao_municipal: inscricaoMunicipal.trim() || null,
      nome_contato: nomeContato.trim() || null,
      nacionalidade: nacionalidade.trim() || null,
      cep: cep.trim() || null,
      endereco: endereco.trim() || null,
      numero: numero.trim() || null,
      bairro: bairro.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim() || null,
      pais: pais.trim() || null,
      telefone: telefone.trim() || null,
      celular: celular.trim() || null,
      email: email.trim() || null,
      observacoes: observacoes.trim() || null,
    }

    let id = pessoaId
    if (editando) {
      const { error } = await supabase.from('pessoas').update(payload).eq('id', pessoaId)
      if (error) {
        alert('Erro ao salvar: ' + error.message)
        setSalvando(false)
        return
      }
    } else {
      const { data: nova, error } = await supabase.from('pessoas').insert(payload).select('id').single()
      if (error) {
        alert('Erro ao salvar: ' + error.message)
        setSalvando(false)
        return
      }
      id = nova.id
    }

    // sincroniza papéis: apaga e reinsere, mesmo padrão já usado em
    // outros pontos do sistema (ex.: descontos/acréscimos de movimentação)
    await supabase.from('pessoa_papeis').delete().eq('pessoa_id', id)
    if (papeis.length > 0) {
      const { error: errorPapeis } = await supabase
        .from('pessoa_papeis')
        .insert(papeis.map((papel) => ({ pessoa_id: id, papel })))
      if (errorPapeis) {
        alert('Erro ao salvar papéis: ' + errorPapeis.message)
        setSalvando(false)
        return
      }
    }

    setSalvando(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-extrabold text-text-primary">{editando ? 'Editar Pessoa/Empresa' : 'Nova Pessoa/Empresa'}</h2>

        {carregando ? (
          <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
        ) : (
          <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Dados Básicos</h3>
              <div className="mt-2 flex flex-wrap items-center gap-6">
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm text-text-primary">
                    <input
                      type="radio"
                      className="accent-brand-500"
                      checked={tipoPessoa === 'FISICA'}
                      onChange={() => setTipoPessoa('FISICA')}
                    />
                    Física
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-text-primary">
                    <input
                      type="radio"
                      className="accent-brand-500"
                      checked={tipoPessoa === 'JURIDICA'}
                      onChange={() => setTipoPessoa('JURIDICA')}
                    />
                    Jurídica
                  </label>
                </div>
                <div className="flex flex-wrap gap-4">
                  {PAPEIS.map((p) => (
                    <label key={p.valor} className="flex items-center gap-1.5 text-sm text-text-primary">
                      <input
                        type="checkbox"
                        className="accent-brand-500"
                        checked={papeis.includes(p.valor)}
                        onChange={() => alternarPapel(p.valor)}
                      />
                      {p.rotulo}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Nome
                    <Required />
                  </label>
                  <input className={`w-full ${inputClass}`} value={nome} onChange={(e) => setNome(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    {tipoPessoa === 'FISICA' ? 'CPF' : 'CNPJ'}
                  </label>
                  <input className={`w-full ${inputClass}`} value={documento} onChange={(e) => setDocumento(e.target.value)} />
                </div>
                {tipoPessoa === 'FISICA' ? (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">RG</label>
                    <input className={`w-full ${inputClass}`} value={rg} onChange={(e) => setRg(e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-text-secondary">Insc. Estadual</label>
                      <input
                        className={`w-full ${inputClass}`}
                        value={inscricaoEstadual}
                        onChange={(e) => setInscricaoEstadual(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-text-secondary">Insc. Municipal</label>
                      <input
                        className={`w-full ${inputClass}`}
                        value={inscricaoMunicipal}
                        onChange={(e) => setInscricaoMunicipal(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Nome do Contato</label>
                  <input className={`w-full ${inputClass}`} value={nomeContato} onChange={(e) => setNomeContato(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Nacionalidade</label>
                  <input className={`w-full ${inputClass}`} value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-text-primary">Endereço</h3>
              <div className="mt-2 grid gap-4 sm:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">CEP</label>
                  <input className={`w-full ${inputClass}`} value={cep} onChange={(e) => setCep(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Endereço</label>
                  <input className={`w-full ${inputClass}`} value={endereco} onChange={(e) => setEndereco(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Número</label>
                  <input className={`w-full ${inputClass}`} value={numero} onChange={(e) => setNumero(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Bairro</label>
                  <input className={`w-full ${inputClass}`} value={bairro} onChange={(e) => setBairro(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Cidade</label>
                  <input className={`w-full ${inputClass}`} value={cidade} onChange={(e) => setCidade(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Estado</label>
                  <input className={`w-full ${inputClass}`} value={estado} onChange={(e) => setEstado(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">País</label>
                  <input className={`w-full ${inputClass}`} value={pais} onChange={(e) => setPais(e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-text-primary">Contato</h3>
              <div className="mt-2 grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Telefone</label>
                  <input className={`w-full ${inputClass}`} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Celular</label>
                  <input className={`w-full ${inputClass}`} value={celular} onChange={(e) => setCelular(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">E-mail</label>
                  <input type="email" className={`w-full ${inputClass}`} value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Observações</label>
                  <textarea
                    className={`w-full ${inputClass}`}
                    rows={2}
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={onClose} className="rounded-control border border-border px-4 py-2 text-sm text-text-primary">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="rounded-control bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500-hover disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
