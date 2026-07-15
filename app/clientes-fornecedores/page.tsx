'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'

type TipoClienteFornecedor = 'CLIENTE' | 'FORNECEDOR' | 'AMBOS'

type ClienteFornecedor = {
  id: string
  nome: string
  tipo: TipoClienteFornecedor
  documento: string | null
  ativo: boolean
}

export default function ClientesFornecedoresPage() {
  const [clientes, setClientes] = useState<ClienteFornecedor[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoClienteFornecedor>('AMBOS')
  const [documento, setDocumento] = useState('')
  const [salvando, setSalvando] = useState(false)

  const supabase = createClient()

  async function carregarClientes() {
    setLoading(true)
    const { data, error } = await supabase.from('clientes_fornecedores').select('*').order('nome')
    if (error) {
      setErro(error.message)
    } else {
      setClientes(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    carregarClientes()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return

    setSalvando(true)
    const { error } = await supabase.from('clientes_fornecedores').insert({
      nome: nome.trim(),
      tipo,
      documento: documento.trim() || null,
    })

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setNome('')
      setTipo('AMBOS')
      setDocumento('')
      await carregarClientes()
    }
    setSalvando(false)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Clientes / Fornecedores</h1>

      <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mb-8 space-y-3 border p-4 rounded">
        <h2 className="font-semibold">Novo cliente/fornecedor</h2>
        <div>
          <label className="block text-sm mb-1">
            Nome
            <Required />
          </label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Tipo</label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoClienteFornecedor)}
          >
            <option value="CLIENTE">Cliente</option>
            <option value="FORNECEDOR">Fornecedor</option>
            <option value="AMBOS">Ambos</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Documento (CPF/CNPJ)</label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={salvando}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar cliente/fornecedor'}
        </button>
      </form>

      <h2 className="font-semibold mb-3">Cadastrados</h2>
      {loading ? (
        <p>Carregando...</p>
      ) : erro ? (
        <p className="text-red-600">Erro: {erro}</p>
      ) : clientes.length === 0 ? (
        <p>Nenhum cliente/fornecedor cadastrado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {clientes.map((c) => (
            <li key={c.id} className="border p-3 rounded">
              <strong>{c.nome}</strong> — {c.tipo}
              {c.documento ? ` · ${c.documento}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
