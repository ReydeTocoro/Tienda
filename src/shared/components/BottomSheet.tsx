import { useRef, type ReactNode } from 'react'
import { useFitHeight } from '../hooks/useFitHeight'
import { useShowDialog } from '../hooks/useShowDialog'
import { nudgeOnBackdropClick } from '../lib/backdropNudge'
import { enterSubmits } from '../lib/enterSubmits'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}

/** Bottom-anchored sliding sheet on mobile, centered dialog on desktop (`md:`) — built on the
 * native `<dialog>` element (see `Modal.tsx` for why: free backdrop/Escape/focus-trap/stacking).
 * Content stays conditionally rendered so consumers that reset local state via unmount keep
 * working unchanged; it mounts once the sheet is showing, so a field's `autoFocus` takes the cursor
 * (`useShowDialog`). Clicking the backdrop does not dismiss it (`nudgeOnBackdropClick`): every
 * consumer offers its own Cancelar/Cerrar. Enter in a field presses the button marked `data-enter`
 * (`enterSubmits`). A sheet taller than the screen shrinks its content to fit (`useFitHeight`)
 * instead of scrolling. */
export function BottomSheet({ open, onClose, children, maxWidthClass = 'max-w-[520px]' }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const showing = useShowDialog(ref, open)
  useFitHeight(ref, bodyRef, showing)

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={nudgeOnBackdropClick}
      onKeyDown={enterSubmits}
      className={`mx-auto mt-auto mb-0 w-full ${maxWidthClass} max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-[22px] border border-br bg-s1 p-[18px] text-txt shadow-lg backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-[sheetUp_0.22s_ease] md:mb-auto md:rounded-[22px] md:p-6 md:open:animate-[dialogIn_0.18s_ease]`}
    >
      {showing && (
        <div ref={bodyRef} className="flow-root">
          <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-br2 md:hidden" />
          {children}
        </div>
      )}
    </dialog>
  )
}
