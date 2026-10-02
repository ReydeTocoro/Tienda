import { useEffect } from 'react'
import { useToastStore, type ToastColor } from '../../store/useToastStore'

const COLOR_CLASSES: Record<ToastColor, string> = {
  default: 'border-br2 text-txt',
  lime: 'border-lime/40 text-lime',
  red: 'border-red/40 text-red',
  orange: 'border-orange/40 text-orange',
  blue: 'border-blue/40 text-blue',
  green: 'border-green/40 text-green',
  purple: 'border-purple/40 text-purple',
  muted: 'border-br2 text-muted',
}

export function ToastHost() {
  const { message, color, token, hide } = useToastStore()

  useEffect(() => {
    if (!message) return
    const t = setTimeout(hide, 2800)
    return () => clearTimeout(t)
  }, [token, message, hide])

  if (!message) return null

  // A manual popover goes in the browser's top layer, like the native <dialog>s: without it a
  // toast raised from inside a modal form (validation errors, "Producto guardado") would be
  // painted underneath that dialog's backdrop and never seen. `inset-auto` cancels the UA
  // popover default of `inset: 0` so the bottom-center positioning below still applies.
  return (
    <div
      popover="manual"
      ref={(el) => {
        if (el && !el.matches(':popover-open')) el.showPopover()
      }}
      className={`pointer-events-none fixed inset-auto bottom-[76px] left-1/2 max-w-[90vw] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-[30px] border bg-s2 px-5 py-2.5 text-[13px] font-semibold shadow-[var(--shadow-md)] md:bottom-6 ${COLOR_CLASSES[color]}`}
    >
      {message}
    </div>
  )
}
