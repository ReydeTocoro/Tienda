import { useEffect, useRef, type ReactNode } from 'react'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}

/** Bottom-anchored sliding sheet on mobile, centered dialog on desktop (`md:`) — built on the
 * native `<dialog>` element (see `Modal.tsx` for why: free backdrop/Escape/focus-trap/stacking).
 * Content stays conditionally rendered so consumers that reset local state via unmount keep
 * working unchanged. */
export function BottomSheet({ open, onClose, children, maxWidthClass = 'max-w-[520px]' }: BottomSheetProps) {
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
      className={`mx-auto mt-auto mb-0 w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto rounded-t-[22px] border border-br2 bg-s1 p-[18px] text-txt backdrop:bg-black/80 open:animate-[sheetUp_0.22s_ease] md:mb-auto md:rounded-[22px] md:p-6 md:open:animate-[dialogIn_0.18s_ease]`}
    >
      {open && (
        <>
          <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-br2 md:hidden" />
          {children}
        </>
      )}
    </dialog>
  )
}
