import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}

/** Centered dialog built on the native `<dialog>` element — gets backdrop, Escape-to-close,
 * focus trap, and top-layer stacking for free instead of hand-rolled fixed/z-index/click-outside
 * logic. Content stays conditionally rendered (`open && children`) so consumers that reset their
 * own local state via unmount (not a `useEffect`) keep working exactly as before. */
export function Modal({ open, onClose, children, maxWidthClass = 'max-w-[380px]' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
      className={`m-auto w-full ${maxWidthClass} rounded-[18px] border border-br bg-s1 p-[22px] text-txt shadow-lg backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-[sheetUp_0.2s_ease]`}
    >
      {open && children}
    </dialog>
  )
}
