import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
  zIndexClass?: string
}

/** Centered dialog — replaces the legacy centered `position:fixed` modals (producto libre,
 * abono, calculadora, etc). */
export function Modal({ open, onClose, children, maxWidthClass = 'max-w-[380px]', zIndexClass = 'z-[1000]' }: ModalProps) {
  if (!open) return null
  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/80 p-5`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`w-full ${maxWidthClass} rounded-[18px] border border-br2 bg-s1 p-[22px] animate-[sheetUp_0.2s_ease]`}>
        {children}
      </div>
    </div>
  )
}
