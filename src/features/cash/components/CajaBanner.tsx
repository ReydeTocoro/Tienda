import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useCaja } from '../hooks/useCaja'
import { OpenCajaSheet } from './OpenCajaSheet'

/** Venta reminder: shown only while the Caja Menor is closed. Opening needs no PIN — it's just
 * counting the drawer — so a cashier can start the day on their own. Never blocks selling. */
export function CajaBanner() {
  const { ready, session, firstOpening } = useCaja()
  const [openSheet, setOpenSheet] = useState(false)
  if (!ready || session) return null
  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-orange/30 bg-orange/10 px-3 py-2 md:px-4">
        <span className="flex min-w-0 items-center gap-2 text-[12px] text-orange">
          <Lock size={14} className="flex-shrink-0" />
          <span className="truncate">{firstOpening ? 'Cajas sin iniciar — registra tu base inicial para empezar a llevar el control.' : 'Caja cerrada — cuenta el efectivo para abrir el día.'}</span>
        </span>
        <button onClick={() => setOpenSheet(true)} className="flex-shrink-0 rounded-lg bg-orange px-3 py-1 text-[12px] font-bold text-on-solid">
          {firstOpening ? 'Iniciar cajas' : 'Abrir caja'}
        </button>
      </div>
      <OpenCajaSheet open={openSheet} onClose={() => setOpenSheet(false)} />
    </>
  )
}
