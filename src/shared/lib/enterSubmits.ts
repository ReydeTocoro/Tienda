import type { KeyboardEvent } from 'react'

/** The field types where Enter means "I'm done typing" (a checkbox or a button keeps its own Enter). */
const TEXT_LIKE = new Set(['text', 'number', 'search', 'tel', 'email', 'password', 'url', ''])

/** Enter inside a field of a dialog presses the dialog's main button — the one marked `data-enter` —
 * so a form can be filled and sent from the keyboard alone. A disabled main button does nothing
 * (the amount is still short, the form is still saving), and so does a held-down key. Dialogs
 * without a `data-enter` button keep the browser's behavior. */
export function enterSubmits(e: KeyboardEvent<HTMLDialogElement>): void {
  if (e.key !== 'Enter' || e.repeat || e.defaultPrevented || e.nativeEvent.isComposing) return
  const field = e.target as HTMLElement
  if (field.tagName !== 'INPUT' || !TEXT_LIKE.has((field as HTMLInputElement).type)) return
  const main = e.currentTarget.querySelector<HTMLButtonElement>('button[data-enter]')
  if (!main) return
  e.preventDefault()
  if (!main.disabled) main.click()
}
