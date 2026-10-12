import { useState } from 'react'
import { CloudUpload, TriangleAlert, WifiOff } from 'lucide-react'
import { useOutboxCounts } from '../offline/outbox'
import { useConnectionStore } from '../store/useConnectionStore'
import { SyncSheet } from './SyncSheet'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The corner indicator of the nav bar for the days the internet fails: nothing while all is well; "Sin conexión"
 * when the server can't be reached (the till keeps selling — see src/offline), the sales waiting to be sent, or
 * a sale the server refused. Pressing it opens the list (`SyncSheet`). */
export function ConnectionPill() {
  const reachable = useConnectionStore((s) => s.reachable)
  const { pending, rejected } = useOutboxCounts()
  const [open, setOpen] = useState(false)

  let tone = ''
  let label = ''
  let Icon = WifiOff
  if (rejected > 0) {
    tone = 'bg-red text-on-solid'
    label = plural(rejected, 'rechazada', 'rechazadas')
    Icon = TriangleAlert
  } else if (!reachable) {
    tone = 'bg-orange text-on-solid'
    label = pending > 0 ? `Sin conexión · ${pending}` : 'Sin conexión'
  } else if (pending > 0) {
    tone = 'bg-nav-hover text-nav-fg'
    label = `Enviando ${pending}…`
    Icon = CloudUpload
  }

  return (
    <>
      {label && (
        <button
          onClick={() => setOpen(true)}
          title={reachable ? 'Ventas hechas sin internet' : 'Sin conexión: puedes seguir vendiendo, las ventas se guardan en este equipo'}
          aria-label={label}
          className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold focus-visible:outline-yellow ${tone}`}
        >
          <Icon size={13} />
          <span className="hidden sm:inline">{label}</span>
          {/* On a phone the words don't fit: the count of waiting sales stays. */}
          {pending > 0 && <span className="sm:hidden">{pending}</span>}
        </button>
      )}
      <SyncSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
