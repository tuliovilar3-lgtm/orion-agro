'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Required from '@/components/Required'
import { bloquearEnvioPorEnter } from '@/lib/form-utils'

type SistemaProdutivo = 'CRIA' | 'RECRIA' | 'RECRIA_ENGORDA' | 'CICLO_COMPLETO' | 'AGRICULTURA'

const SISTEMAS_PRODUTIVOS: { valor: SistemaProdutivo; rotulo: string }[] = [
  { valor: 'CRIA', rotulo: 'Cria' },
  { valor: 'RECRIA', rotulo: 'Recria' },
  { valor: 'RECRIA_ENGORDA', rotulo: 'Recria/Engorda' },
  { valor: 'CICLO_COMPLETO', rotulo: 'Ciclo Completo' },
  { valor: 'AGRICULTURA', rotulo: 'Agricultura' },
]

type Pessoa = { id: string; nome: string }

const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500'

// graus/minutos/segundos -> decimal (sinal do grau se aplica ao conjunto todo)
function gmsParaDecimal(graus: number, minutos: number, segundos: number) {
  const sinal = graus < 0 ? -1 : 1
  return sinal * (Math.abs(graus) + minutos / 60 + segundos / 3600)
}

function decimalParaGms(decimal: number): [number, number, number] {
  const sinal = decimal < 0 ? -1 : 1
  const abs = Math.abs(decimal)
  const graus = Math.floor(abs)
  const restoMinutos = (abs - graus) * 60
  const minutos = Math.floor(restoMinutos)
  const segundos = Math.round((restoMinutos - minutos) * 60 * 100) / 100
  return [sinal * graus, minutos, segundos]
}

export default function CadastrarFazendaModal({
  fazendaId,
  onClose,
  onSaved,
}: {
  fazendaId?: string
  onClose: () => void
  onSaved: (fazendaId: string) => void
}) {
  const supabase = createClient()
  const editando = !!fazendaId

  const [carregando, setCarregando] = useState(editando)
  const [salvando, setSalvando] = useState(false)

  const [nome, setNome] = useState('')
  const [proprietarioId, setProprietarioId] = useState('')
  const [areaTotalHa, setAreaTotalHa] = useState('')
  const [areaUtilHa, setAreaUtilHa] = useState('')
  const [ie, setIe] = useState('')
  const [incra, setIncra] = useState('')
  const [numeroItr, setNumeroItr] = useState('')
  const [caepf, setCaepf] = useState('')
  const [sistemaProdutivo, setSistemaProdutivo] = useState<SistemaProdutivo | ''>('')

  const [pais, setPais] = useState('Brasil')
  const [cep, setCep] = useState('')
  const [endereco, setEndereco] = useState('')
  const [numero, setNumero] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [telefone, setTelefone] = useState('')
  const [latGraus, setLatGraus] = useState('')
  const [latMinutos, setLatMinutos] = useState('')
  const [latSegundos, setLatSegundos] = useState('')
  const [longGraus, setLongGraus] = useState('')
  const [longMinutos, setLongMinutos] = useState('')
  const [longSegundos, setLongSegundos] = useState('')

  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [modalProprietarioAberto, setModalProprietarioAberto] = useState(false)
  const [novoProprietarioNome, setNovoProprietarioNome] = useState('')
  const [salvandoProprietario, setSalvandoProprietario] = useState(false)

  // proprietários do GADO nessa fazenda — diferente de proprietarioId
  // acima (dono da terra, cadastral, único). Algumas fazendas têm mais
  // de um dono de gado (parceria, arrendamento, sociedade entre
  // parentes) — essa lista alimenta o seletor de proprietário nos
  // lançamentos de movimentação. Vazio == nenhum foi explicitamente
  // marcado ainda; nesse caso, ao salvar, o dono da terra vira o único
  // proprietário de gado por padrão (fazenda com um dono só não exige
  // nenhum passo extra).
  const [proprietariosGadoIds, setProprietariosGadoIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase
      .from('pessoa_papeis')
      .select('pessoa:pessoas!pessoa_id(id, nome)')
      .eq('papel', 'PROPRIETARIO')
      .then(({ data }) => {
        const lista = ((data || []) as any[])
          .map((d) => d.pessoa)
          .filter(Boolean)
          .sort((a: Pessoa, b: Pessoa) => a.nome.localeCompare(b.nome))
        setPessoas(lista)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!fazendaId) return
    supabase
      .from('fazenda_proprietarios')
      .select('pessoa_id')
      .eq('fazenda_id', fazendaId)
      .then(({ data }) => {
        setProprietariosGadoIds(new Set((data || []).map((r) => r.pessoa_id)))
      })
  }, [fazendaId, supabase])

  useEffect(() => {
    if (!fazendaId) return
    setCarregando(true)
    supabase
      .from('fazendas')
      .select('*')
      .eq('id', fazendaId)
      .single()
      .then(({ data }) => {
        if (data) {
          setNome(data.nome)
          setProprietarioId(data.proprietario_id || '')
          setAreaTotalHa(data.area_ha != null ? String(data.area_ha) : '')
          setAreaUtilHa(data.area_util_ha != null ? String(data.area_util_ha) : '')
          setIe(data.ie || '')
          setIncra(data.incra || '')
          setNumeroItr(data.numero_itr || '')
          setCaepf(data.caepf || '')
          setSistemaProdutivo(data.sistema_produtivo || '')
          setPais(data.pais || 'Brasil')
          setCep(data.cep || '')
          setEndereco(data.endereco || '')
          setNumero(data.numero || '')
          setBairro(data.bairro || '')
          setCidade(data.cidade || '')
          setEstado(data.estado || '')
          setTelefone(data.telefone || '')
          if (data.latitude != null) {
            const [g, m, s] = decimalParaGms(data.latitude)
            setLatGraus(String(g))
            setLatMinutos(String(m))
            setLatSegundos(String(s))
          }
          if (data.longitude != null) {
            const [g, m, s] = decimalParaGms(data.longitude)
            setLongGraus(String(g))
            setLongMinutos(String(m))
            setLongSegundos(String(s))
          }
        }
        setCarregando(false)
      })
  }, [fazendaId, supabase])

  async function handleCriarProprietario(e: React.FormEvent) {
    e.preventDefault()
    if (!novoProprietarioNome.trim()) return
    setSalvandoProprietario(true)
    const { data: nova, error } = await supabase
      .from('pessoas')
      .insert({ nome: novoProprietarioNome.trim() })
      .select('id, nome')
      .single()
    if (error) {
      alert('Erro ao salvar: ' + error.message)
      setSalvandoProprietario(false)
      return
    }
    const { error: errorPapel } = await supabase.from('pessoa_papeis').insert({ pessoa_id: nova.id, papel: 'PROPRIETARIO' })
    if (errorPapel) {
      alert('Erro ao definir papel: ' + errorPapel.message)
      setSalvandoProprietario(false)
      return
    }
    setPessoas((prev) => [...prev, nova].sort((a, b) => a.nome.localeCompare(b.nome)))
    setProprietarioId(nova.id)
    setModalProprietarioAberto(false)
    setNovoProprietarioNome('')
    setSalvandoProprietario(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !proprietarioId || !areaTotalHa || !areaUtilHa) return

    setSalvando(true)
    const payload = {
      nome: nome.trim(),
      proprietario_id: proprietarioId,
      area_ha: parseFloat(areaTotalHa),
      area_util_ha: parseFloat(areaUtilHa),
      ie: ie.trim() || null,
      incra: incra.trim() || null,
      numero_itr: numeroItr.trim() || null,
      caepf: caepf.trim() || null,
      sistema_produtivo: sistemaProdutivo || null,
      pais: pais.trim() || null,
      cep: cep.trim() || null,
      endereco: endereco.trim() || null,
      numero: numero.trim() || null,
      bairro: bairro.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim() || null,
      telefone: telefone.trim() || null,
      latitude: latGraus ? gmsParaDecimal(parseFloat(latGraus), parseFloat(latMinutos || '0'), parseFloat(latSegundos || '0')) : null,
      longitude: longGraus
        ? gmsParaDecimal(parseFloat(longGraus), parseFloat(longMinutos || '0'), parseFloat(longSegundos || '0'))
        : null,
    }

    let idSalvo: string
    if (editando) {
      const { error } = await supabase.from('fazendas').update(payload).eq('id', fazendaId)
      if (error) {
        setSalvando(false)
        alert('Erro ao salvar: ' + error.message)
        return
      }
      idSalvo = fazendaId as string
    } else {
      const { data: nova, error } = await supabase.from('fazendas').insert(payload).select('id').single()
      if (error) {
        setSalvando(false)
        alert('Erro ao salvar: ' + error.message)
        return
      }
      idSalvo = nova.id
    }

    // proprietários do gado: se nenhum foi marcado explicitamente, o
    // dono da terra vira o único proprietário de gado por padrão — a
    // maioria das fazendas tem um dono só e não precisa de nenhum passo
    // extra pra o seletor de proprietário funcionar nos lançamentos
    const proprietariosFinal = proprietariosGadoIds.size > 0 ? [...proprietariosGadoIds] : [proprietarioId]
    await supabase.from('fazenda_proprietarios').delete().eq('fazenda_id', idSalvo)
    const { error: errorProprietarios } = await supabase
      .from('fazenda_proprietarios')
      .insert(proprietariosFinal.map((pessoaId) => ({ fazenda_id: idSalvo, pessoa_id: pessoaId })))
    setSalvando(false)
    if (errorProprietarios) {
      alert('Erro ao salvar proprietários do gado: ' + errorProprietarios.message)
      return
    }
    onSaved(idSalvo)
  }

  function alternarProprietarioGado(pessoaId: string) {
    setProprietariosGadoIds((prev) => {
      const novo = new Set(prev)
      if (novo.has(pessoaId)) novo.delete(pessoaId)
      else novo.add(pessoaId)
      return novo
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-extrabold text-text-primary">{editando ? 'Editar Fazenda' : 'Cadastrar Fazenda'}</h2>

        {carregando ? (
          <p className="mt-4 text-sm text-text-secondary">Carregando...</p>
        ) : (
          <form onSubmit={handleSubmit} onKeyDown={bloquearEnvioPorEnter} className="mt-4 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Dados da Propriedade</h3>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Nome da Propriedade
                    <Required />
                  </label>
                  <input className={`w-full ${inputClass}`} value={nome} onChange={(e) => setNome(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Proprietário
                    <Required />
                  </label>
                  <div className="flex gap-2">
                    <select
                      className={`w-full ${inputClass}`}
                      value={proprietarioId}
                      onChange={(e) => setProprietarioId(e.target.value)}
                    >
                      <option value="">Selecione...</option>
                      {pessoas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="shrink-0 whitespace-nowrap text-xs text-brand-500 underline"
                      onClick={() => setModalProprietarioAberto(true)}
                    >
                      + Novo
                    </button>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Proprietários do gado nesta fazenda</label>
                  <p className="mb-2 text-xs text-text-muted">
                    Por padrão só o proprietário da terra acima. Marque mais nomes se houver mais de um dono de gado
                    nesta fazenda (parceria, arrendamento) — isso libera um seletor de proprietário nos lançamentos.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {pessoas.map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-sm text-text-primary">
                        <input
                          type="checkbox"
                          checked={proprietariosGadoIds.has(p.id)}
                          onChange={() => alternarProprietarioGado(p.id)}
                        />
                        {p.nome}
                      </label>
                    ))}
                    {pessoas.length === 0 && <p className="text-sm text-text-muted">Nenhum proprietário cadastrado ainda.</p>}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Sistema Produtivo</label>
                  <select
                    className={`w-full ${inputClass}`}
                    value={sistemaProdutivo}
                    onChange={(e) => setSistemaProdutivo(e.target.value as SistemaProdutivo)}
                  >
                    <option value="">Selecione...</option>
                    {SISTEMAS_PRODUTIVOS.map((s) => (
                      <option key={s.valor} value={s.valor}>
                        {s.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Área Total (Ha)
                    <Required />
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className={`w-full ${inputClass}`}
                    value={areaTotalHa}
                    onChange={(e) => setAreaTotalHa(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Área Útil (Ha)
                    <Required />
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className={`w-full ${inputClass}`}
                    value={areaUtilHa}
                    onChange={(e) => setAreaUtilHa(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">IE</label>
                  <input className={`w-full ${inputClass}`} value={ie} onChange={(e) => setIe(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">INCRA</label>
                  <input className={`w-full ${inputClass}`} value={incra} onChange={(e) => setIncra(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">Nº ITR</label>
                  <input className={`w-full ${inputClass}`} value={numeroItr} onChange={(e) => setNumeroItr(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">CAEPF</label>
                  <input className={`w-full ${inputClass}`} value={caepf} onChange={(e) => setCaepf(e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-text-primary">Endereço</h3>
              <div className="mt-2 space-y-4">
                <div className="grid gap-4 sm:grid-cols-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-text-secondary">País</label>
                      <input className={`w-full ${inputClass}`} value={pais} onChange={(e) => setPais(e.target.value)} />
                    </div>
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
                      <label className="mb-1.5 block text-sm font-medium text-text-secondary">Telefone</label>
                      <input className={`w-full ${inputClass}`} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                    </div>
                  </div>

                  <div className="rounded-control bg-bg p-4">
                    <p className="mb-3 text-sm font-medium text-text-secondary">Latitude</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">Graus</label>
                        <input
                          type="number"
                          step="any"
                          className={`w-full ${inputClass}`}
                          value={latGraus}
                          onChange={(e) => setLatGraus(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">Minutos</label>
                        <input
                          type="number"
                          step="any"
                          className={`w-full ${inputClass}`}
                          value={latMinutos}
                          onChange={(e) => setLatMinutos(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">Segundos</label>
                        <input
                          type="number"
                          step="any"
                          className={`w-full ${inputClass}`}
                          value={latSegundos}
                          onChange={(e) => setLatSegundos(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="mb-3 mt-4 text-sm font-medium text-text-secondary">Longitude</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">Graus</label>
                        <input
                          type="number"
                          step="any"
                          className={`w-full ${inputClass}`}
                          value={longGraus}
                          onChange={(e) => setLongGraus(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">Minutos</label>
                        <input
                          type="number"
                          step="any"
                          className={`w-full ${inputClass}`}
                          value={longMinutos}
                          onChange={(e) => setLongMinutos(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">Segundos</label>
                        <input
                          type="number"
                          step="any"
                          className={`w-full ${inputClass}`}
                          value={longSegundos}
                          onChange={(e) => setLongSegundos(e.target.value)}
                        />
                      </div>
                    </div>
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

        {modalProprietarioAberto && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <form
              onSubmit={handleCriarProprietario}
              onKeyDown={bloquearEnvioPorEnter}
              className="w-full max-w-sm space-y-3 rounded-card border border-border bg-surface p-5"
            >
              <h3 className="text-sm font-semibold text-text-primary">Novo proprietário</h3>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Nome
                  <Required />
                </label>
                <input
                  className={`w-full ${inputClass}`}
                  value={novoProprietarioNome}
                  onChange={(e) => setNovoProprietarioNome(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-control border border-border px-3 py-1.5 text-sm text-text-primary"
                  onClick={() => setModalProprietarioAberto(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoProprietario}
                  className="rounded-control bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500-hover disabled:opacity-50"
                >
                  {salvandoProprietario ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
