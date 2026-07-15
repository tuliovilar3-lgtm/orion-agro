'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ERAS, Era, FAIXA_ETARIA_GRUPO, GRUPO_FAIXA_ETARIA_POR_ERA, PAPEIS_BEZERRO_MAMANDO } from '@/lib/faixa-etaria'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'
import { formatPeso } from '@/lib/format'

type Sexo = 'MACHO' | 'FEMEA'

type GrupoCategoriaPapel = { id: string; nome: string; sexo: Sexo | null }

type CategoriaAnimal = {
  id: string
  nome: string
  sexo: Sexo
  era: Era | null
  peso_referencia_kg: number | null
  ativa: boolean
  sistema: boolean
  grupo: { nome: string } | null
  grupo_categoria_papel: { nome: string } | null
}

export default function CategoriasPage() {
  const [papeis, setPapeis] = useState<GrupoCategoriaPapel[]>([])
  const [categorias, setCategorias] = useState<CategoriaAnimal[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [nome, setNome] = useState('')
  const [papelId, setPapelId] = useState('')
  const [sexoLivre, setSexoLivre] = useState<Sexo | ''>('')
  const [era, setEra] = useState<Era | ''>('')
  const [pesoReferenciaKg, setPesoReferenciaKg] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<string | null>(null)
  const [processandoId, setProcessandoId] = useState<string | null>(null)

  const supabase = createClient()

  const papelSelecionado = papeis.find((p) => p.id === papelId)
  const sexoEhLivre = !!papelSelecionado && papelSelecionado.sexo === null
  const isBezerroPapel = !!papelSelecionado && PAPEIS_BEZERRO_MAMANDO.includes(papelSelecionado.nome)
  const eraEfetiva: Era | '' = isBezerroPapel ? '00-08' : era

  async function carregarPapeis() {
    const { data } = await supabase.from('grupos_categoria_papel').select('id, nome, sexo').order('ordem')
    setPapeis(data || [])
  }

  async function carregarCategorias() {
    setLoading(true)
    const { data, error } = await supabase
      .from('categorias_animal')
      .select(
        'id, nome, sexo, era, peso_referencia_kg, ativa, sistema, grupo:grupos_categoria(nome), grupo_categoria_papel:grupos_categoria_papel(nome)'
      )
      .order('ordem_ciclo')
      .order('nome')

    if (error) {
      setErro(error.message)
    } else {
      setCategorias((data as unknown as CategoriaAnimal[]) || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    carregarPapeis()
    carregarCategorias()
  }, [])

  useEffect(() => {
    setSexoLivre('')
    setEra('')
  }, [papelId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !papelId) return
    if (sexoEhLivre && !sexoLivre) return
    if (!isBezerroPapel && !era) return

    setSalvando(true)
    const { error } = await supabase.from('categorias_animal').insert({
      nome: nome.trim(),
      grupo_categoria_papel_id: papelId,
      sexo: sexoEhLivre ? sexoLivre : null,
      era: eraEfetiva,
      peso_referencia_kg: pesoReferenciaKg ? parseFloat(pesoReferenciaKg) : null,
    })

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setNome('')
      setPapelId('')
      setSexoLivre('')
      setEra('')
      setPesoReferenciaKg('')
      await carregarCategorias()
    }
    setSalvando(false)
  }

  async function handleAlternarAtiva(c: CategoriaAnimal) {
    setProcessandoId(c.id)
    const { error } = await supabase.from('categorias_animal').update({ ativa: !c.ativa }).eq('id', c.id)
    if (error) {
      alert('Erro ao atualizar: ' + error.message)
    } else {
      await carregarCategorias()
    }
    setProcessandoId(null)
  }

  async function handleExcluir(id: string) {
    setProcessandoId(id)
    const { error } = await supabase.from('categorias_animal').delete().eq('id', id)
    if (error) {
      alert('Erro ao excluir: ' + error.message)
    } else {
      await carregarCategorias()
    }
    setConfirmandoExclusaoId(null)
    setProcessandoId(null)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Categorias de animal</h1>

      <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mb-8 space-y-3 border p-4 rounded">
        <h2 className="font-semibold">Nova categoria</h2>
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
          <label className="block text-sm mb-1">
            Grupo Categoria
            <Required />
          </label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={papelId}
            onChange={(e) => setPapelId(e.target.value)}
            required
          >
            <option value="">Selecione...</option>
            {papeis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.sexo ? ` (${p.sexo === 'MACHO' ? 'Macho' : 'Fêmea'})` : ' (sexo livre)'}
              </option>
            ))}
          </select>
        </div>

        {sexoEhLivre && (
          <div>
            <label className="block text-sm mb-1">
              Sexo
              <Required />
            </label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={sexoLivre}
              onChange={(e) => setSexoLivre(e.target.value as Sexo)}
              required
            >
              <option value="">Selecione...</option>
              <option value="MACHO">Macho</option>
              <option value="FEMEA">Fêmea</option>
            </select>
          </div>
        )}

        {papelId && (
          <div>
            <label className="block text-sm mb-1">
              Era
              {!isBezerroPapel && <Required />}
            </label>
            {isBezerroPapel ? (
              <p className="text-sm text-gray-600 border rounded px-3 py-2 bg-gray-50">
                00-08 (fixo para Bezerros/Bezerras Mamando)
              </p>
            ) : (
              <select
                className="border rounded px-3 py-2 w-full"
                value={era}
                onChange={(e) => setEra(e.target.value as Era)}
                required
              >
                <option value="">Selecione...</option>
                {ERAS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            )}
            {eraEfetiva && (
              <p className="text-xs text-gray-500 mt-1">
                Grupo Faixa Etária: {GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]}
                {FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]
                  ? ` (${FAIXA_ETARIA_GRUPO[GRUPO_FAIXA_ETARIA_POR_ERA[eraEfetiva]]})`
                  : ''}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm mb-1">Peso de referência (kg)</label>
          <input
            type="number"
            step="0.01"
            className="border rounded px-3 py-2 w-full"
            value={pesoReferenciaKg}
            onChange={(e) => setPesoReferenciaKg(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={salvando}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar categoria'}
        </button>
      </form>

      <h2 className="font-semibold mb-3">Categorias cadastradas</h2>
      {loading ? (
        <p>Carregando...</p>
      ) : erro ? (
        <p className="text-red-600">Erro: {erro}</p>
      ) : categorias.length === 0 ? (
        <p>Nenhuma categoria cadastrada ainda.</p>
      ) : (
        <ul className="space-y-2">
          {categorias.map((c) => (
            <li key={c.id} className={`border p-3 rounded ${!c.ativa ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <strong>{c.nome}</strong> — {c.grupo_categoria_papel?.nome ?? '—'} · {c.sexo} · {c.era ?? '—'} ·{' '}
                  {c.grupo?.nome ?? '—'}
                  {c.peso_referencia_kg ? ` · ${formatPeso(c.peso_referencia_kg)} kg ref.` : ''}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {c.sistema ? 'Categoria do sistema' : 'Categoria criada pelo usuário'}
                    {!c.ativa ? ' · inativa' : ''}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={processandoId === c.id}
                    className="text-xs text-blue-600 underline disabled:opacity-50"
                    onClick={() => handleAlternarAtiva(c)}
                  >
                    {c.ativa ? 'Inativar' : 'Ativar'}
                  </button>
                  {!c.sistema && (
                    <button
                      type="button"
                      className="text-xs text-red-600 underline"
                      onClick={() => setConfirmandoExclusaoId(c.id)}
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </div>

              {confirmandoExclusaoId === c.id && (
                <div className="mt-2 border border-red-400 bg-red-50 rounded p-2 text-sm">
                  <p className="text-red-800 mb-2">
                    Excluir "{c.nome}"? Só é possível se ela não tiver nenhuma movimentação lançada.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-3 py-1 rounded border text-xs"
                      onClick={() => setConfirmandoExclusaoId(null)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={processandoId === c.id}
                      className="bg-red-600 text-white px-3 py-1 rounded text-xs disabled:opacity-50"
                      onClick={() => handleExcluir(c.id)}
                    >
                      {processandoId === c.id ? 'Excluindo...' : 'Sim, excluir'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
