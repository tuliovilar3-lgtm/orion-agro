import type { KeyboardEvent } from 'react'

// Enter dentro de um <form> submete o formulário por padrão, mesmo sem
// clicar no botão — fácil de apertar sem querer ao preencher campos em
// sequência. Bloqueia isso, mas preserva Enter/Espaço quando o foco está
// no próprio botão (necessário para quem navega só por teclado) e
// preserva a quebra de linha normal dentro de textarea.
export function bloquearEnvioPorEnter(e: KeyboardEvent<HTMLFormElement>) {
  const target = e.target as HTMLElement
  if (e.key === 'Enter' && target.tagName !== 'TEXTAREA' && target.tagName !== 'BUTTON') {
    e.preventDefault()
  }
}
