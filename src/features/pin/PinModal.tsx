import { useEffect, useRef, useState } from 'react'
import { useFitHeight } from '../../shared/hooks/useFitHeight'
import { usePinStore } from '../../store/usePinStore'
import { PinPad } from './PinPad'

/** The single PIN dialog for the whole app — legacy `#pin-modal` (index.html L7643-7689): someone
 * allowed authorizes one step on this session (see usePermission); this only collects the PIN. */
export function PinModal() {
  const request = usePinStore((s) => s.request)
  const settle = usePinStore((s) => s.settle)
  const [shake, setShake] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // This dialog can't scroll, so on a very short screen the pad is allowed to shrink further than a sheet.
  useFitHeight(dialogRef, cardRef, !!request, 0.5)

  // A native modal <dialog>, like every other overlay: it lands in the top layer *above* a sheet
  // that is already open (e.g. "Pagar todo" inside the fiado sheet asks for the PIN). A plain
  // z-indexed div ended up underneath that sheet, unreachable by touch.
  useEffect(() => {
    const el = dialogRef.current
    if (request && el && !el.open) {
      el.showModal()
      el.focus() // the dialog itself, not the first key of the pad
    }
  }, [request])

  if (!request) return null

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      onCancel={(e) => e.preventDefault()}
      className="m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center overflow-hidden border-0 bg-transparent p-5 text-txt outline-none backdrop:bg-black/60 backdrop:backdrop-blur-md"
    >
      <div ref={cardRef} className={`w-full max-w-[340px] rounded-[24px] border border-br bg-s1 px-[26px] pb-[26px] pt-[30px] text-center shadow-lg ${shake ? 'animate-[pinShake_0.45s_ease]' : ''}`}>
        <div className="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-lime">
          Autorización
        </div>
        <div className="mb-1 font-display text-[19px] font-bold leading-tight">{request.title}</div>
        <div className="mb-4.5 text-[11px] leading-relaxed text-muted">{request.subtitle}</div>

        <PinPad
          key={request.title + request.subtitle}
          onSubmit={request.verify}
          onSuccess={settle}
          onEscape={() => settle({ ok: false })}
          onWrong={() => {
            setShake(true)
            setTimeout(() => setShake(false), 450)
          }}
        />

        <button onClick={() => settle({ ok: false })} className="w-full py-1.5 text-[12px] text-muted">
          Cancelar
        </button>
      </div>
    </dialog>
  )
}
