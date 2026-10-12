import { useBusyStore } from '../store/useBusyStore'

/** A thin moving bar across the top while anything is being saved. It only appears once the save has
 * taken a moment (the delay is in the CSS, `.busy-bar`), so the fast ones don't flash it. */
export function BusyBar() {
  const busy = useBusyStore((s) => s.pending > 0)
  if (!busy) return null
  return <div role="progressbar" aria-label="Guardando" className="busy-bar fixed inset-x-0 top-0 z-[6000] h-[3px] overflow-hidden bg-lime/20" />
}
