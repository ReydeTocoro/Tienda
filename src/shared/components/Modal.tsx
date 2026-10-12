import { useRef, type ReactNode } from 'react'
import { useFitHeight } from '../hooks/useFitHeight'
import { useShowDialog } from '../hooks/useShowDialog'
import { nudgeOnBackdropClick } from '../lib/backdropNudge'
import { enterSubmits } from '../lib/enterSubmits'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}

/** Centered dialog built on the native `<dialog>` element — gets backdrop, Escape-to-close,
 * focus trap, and top-layer stacking for free instead of hand-rolled fixed/z-index/click-outside
 * logic. Content stays conditionally rendered (`open && children`) so consumers that reset their
 * own local state via unmount (not a `useEffect`) keep working exactly as before; it mounts once the
 * dialog is showing, so a field's `autoFocus` takes the cursor (`useShowDialog`). Clicking the
 * backdrop does not dismiss it (`nudgeOnBackdropClick`): every consumer offers its own Cancelar/Cerrar.
 * Enter in a field presses the button marked `data-enter` (`enterSubmits`). A dialog taller than the
 * screen shrinks its content to fit (`useFitHeight`) instead of scrolling. */
export function Modal({ open, onClose, children, maxWidthClass = 'max-w-[380px]' }: ModalProps) {
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
      className={`m-auto w-full ${maxWidthClass} max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-[18px] border border-br bg-s1 p-[22px] text-txt shadow-lg backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-[sheetUp_0.2s_ease]`}
    >
      {showing && (
        <div ref={bodyRef} className="flow-root">
          {children}
        </div>
      )}
    </dialog>
  )
}
