export function ultimoDiaDoMes(anoMes: string) {
  const [ano, mes] = anoMes.split('-').map(Number)
  return new Date(ano, mes, 0).getDate()
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fimDoMesCorrente(hoje: Date) {
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth() + 1
  const ultimoDia = new Date(ano, mes, 0).getDate()
  return `${ano}-${pad(mes)}-${pad(ultimoDia)}`
}

// safra vai de julho a junho — entre janeiro e junho, a safra vigente
// começou em julho do ano anterior.
export function anoInicioSafraAtual() {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth() + 1
  return mes >= 7 ? ano : ano - 1
}

export function anoCalendarioAtual() {
  return new Date().getFullYear()
}

// período de uma safra (julho de anoInicio a junho de anoInicio+1). A
// safra atual vai até o fim do mês corrente (previsão, pra área e
// outros relatórios que valem como projeção se nada mais for lançado);
// uma safra já encerrada vai até 30/06 fixo, sem previsão nenhuma.
export function periodoSafra(anoInicio: number) {
  const dataFim = anoInicio === anoInicioSafraAtual() ? fimDoMesCorrente(new Date()) : `${anoInicio + 1}-06-30`
  return { dataInicio: `${anoInicio}-07-01`, dataFim }
}

// ano-calendário (janeiro a dezembro). Mesmo princípio de periodoSafra:
// ano atual vai até o fim do mês corrente, ano encerrado vai até 31/12 fixo.
export function periodoAno(ano: number) {
  const dataFim = ano === anoCalendarioAtual() ? fimDoMesCorrente(new Date()) : `${ano}-12-31`
  return { dataInicio: `${ano}-01-01`, dataFim }
}

// opções oferecidas no seletor de filtro — safra/ano atual + N anteriores
export function opcoesSafra(quantidadeAnteriores = 5) {
  const atual = anoInicioSafraAtual()
  return Array.from({ length: quantidadeAnteriores + 1 }, (_, i) => atual - i)
}

export function opcoesAno(quantidadeAnteriores = 5) {
  const atual = anoCalendarioAtual()
  return Array.from({ length: quantidadeAnteriores + 1 }, (_, i) => atual - i)
}

// mesma regra julho-junho de anoInicioSafraAtual, mas generalizada pra
// qualquer data (não só hoje) — usada pra sugerir a safra de nascimento
// a partir da data de um lançamento. Sempre editável: a parição real
// pode cair fora dessa janela calendário (ex.: bezerro da safra 26/27
// nascido no fim de junho de 2026, ainda dentro da janela da safra 25/26).
export function safraSugeridaParaData(dataIso: string) {
  const [ano, mes] = dataIso.split('-').map(Number)
  return mes >= 7 ? ano : ano - 1
}

// rótulo de exibição da safra (ex.: 2025 -> "2025/2026")
export function formatSafra(anoInicio: number) {
  return `${anoInicio}/${anoInicio + 1}`
}
