import type { MouseEvent } from 'react'

/** A click on a dialog's backdrop must not dismiss it: that would throw away a half-filled form.
 * The user leaves through the dialog's own Cancelar/Cerrar (or Escape); here it only gives a small
 * nudge, so the click is seen to have been received and ignored. */
export function nudgeOnBackdropClick(e: MouseEvent<HTMLDialogElement>) {
  const el = e.currentTarget
  if (e.target !== el) return
  // The dialog's own padding also reports the dialog as the target: only clicks beyond its box count.
  const r = el.getBoundingClientRect()
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  if (inside || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 160 })
}
