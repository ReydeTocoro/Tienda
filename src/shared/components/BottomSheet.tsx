import { useEffect, useRef, type ReactNode } from 'react'
import { useFitHeight } from '../hooks/useFitHeight'
import { nudgeOnBackdropClick } from '../lib/backdropNudge'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}

/** Bottom-anchored sliding sheet on mobile, centered dialog on desktop (`md:`) — built on the
 * native `<dialog>` element (see `Modal.tsx` for why: free backdrop/Escape/focus-trap/stacking).
 * Content stays conditionally rendered so consumers that reset local state via unmount keep
 * working unchanged. Clicking the backdrop does not dismiss it (`nudgeOnBackdropClick`): every
 * consumer offers its own Cancelar/Cerrar. A sheet taller than the screen shrinks its content to fit
 * (`useFitHeight`) instead of scrolling. */
export function BottomSheet({ open, onClose, children, maxWidthClass = 'max-w-[520px]' }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  useFitHeight(ref, bodyRef, open)

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
      onClick={nudgeOnBackdropClick}
      className={`mx-auto mt-auto mb-0 w-full ${maxWidthClass} max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-[22px] border border-br bg-s1 p-[18px] text-txt shadow-lg backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-[sheetUp_0.22s_ease] md:mb-auto md:rounded-[22px] md:p-6 md:open:animate-[dialogIn_0.18s_ease]`}
    >
      {open && (
        <div ref={bodyRef} className="flow-root">
          <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-br2 md:hidden" />
          {children}
        </div>
      )}
    </dialog>
  )
}
