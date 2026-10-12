import { useState } from 'react'
import { BottomSheet } from '../shared/components/BottomSheet'
import { formatDateTime, formatMoney } from '../shared/lib/currency'
import { payMethodLabel } from '../shared/lib/receipt'
import { probeNow } from '../offline/connection'
import { discardSale, retrySale, useOutbox } from '../offline/outbox'
import { processOutbox } from '../offline/outboxSync'
import { useConfirm } from '../store/useConfirmStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { toast } from '../store/useToastStore'

interface SyncSheetProps {
  open: boolean
  onClose: () => void
}

/** The sales made while the server could not be reached (src/offline): what is waiting to be sent, what the server
 * refused, and the way to send them now. */
export function SyncSheet({ open, onClose }: SyncSheetProps) {
  const reachable = useConnectionStore((s) => s.reachable)
  const outbox = useOutbox()
  const confirm = useConfirm()
  const [sending, setSending] = useState(false)
  const pending = outbox.filter((e) => e.status === 'pending').length

  async function sendNow() {
    setSending(true)
    try {
      if (!(await probeNow())) return toast('Todavía no hay conexión con el servidor', 'orange')
      const report = await processOutbox({ force: true, wait: true })
      if (report.stoppedBy === 'login') toast('Hay que volver a iniciar sesión para enviar las ventas guardadas', 'orange')
      else if (report.left && !report.sent) toast('El servidor no recibió las ventas todavía: se reintenta solo', 'orange')
    } finally {
      setSending(false)
    }
  }

  async function discard(clientId: string, ref: string) {
    const ok = await confirm({
      title: `Descartar la venta ${ref}`,
      message: 'La venta NO quedará registrada en el servidor y sus productos volverán al inventario de este equipo. Hazlo solo si esa venta no se hizo de verdad.',
      confirmLabel: 'Descartar',
      danger: true,
    })
    if (ok) await discardSale(clientId)
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <h2 className="font-display text-[18px] font-bold">Ventas hechas sin internet</h2>
      <p className="mt-1 text-[12px] leading-snug text-txt2">
        {reachable
          ? 'Hay conexión con el servidor: estas ventas se envían solas. Cuando lleguen, reciben su número definitivo.'
          : 'No hay conexión con el servidor. Puedes seguir vendiendo: cada venta se guarda en este equipo, descuenta el inventario y se envía sola cuando vuelva el internet.'}
      </p>

      {outbox.length === 0 ? (
        <p className="mt-4 rounded-lg bg-s2 px-3 py-3 text-center text-[13px] text-muted">No hay ventas esperando.</p>
      ) : (
        <ul className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto pr-0.5">
          {outbox.map((e) => {
            const rejected = e.status === 'rejected'
            const p = e.payload
            return (
              <li key={e.clientId} className={`rounded-lg border px-3 py-2 ${rejected ? 'border-red/40 bg-red/10' : 'border-br bg-s2'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-bold">{p.localRef}</span>
                  <span className="font-mono text-[13px] font-bold">{formatMoney(p.total)}</span>
                </div>
                <div className="text-[11px] text-txt2">
                  {formatDateTime(p.soldAt)} · {payMethodLabel(p.payMethod, p.transferAccount)}
                  {p.customerName || p.fiadoName ? ` · ${p.customerName || p.fiadoName}` : ''} · {p.items.length} {p.items.length === 1 ? 'producto' : 'productos'}
                </div>
                {rejected ? (
                  <>
                    <div className="mt-1 text-[11px] font-semibold text-red">El servidor no la aceptó: {e.lastError ?? 'sin detalle'}</div>
                    <div className="mt-1.5 flex gap-2">
                      <button onClick={() => void retrySale(e.clientId)} className="rounded-lg border border-br2 px-2.5 py-1 text-[12px] font-semibold">
                        Reintentar
                      </button>
                      <button onClick={() => void discard(e.clientId, p.localRef)} className="rounded-lg border border-red/40 px-2.5 py-1 text-[12px] font-semibold text-red">
                        Descartar
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-0.5 text-[11px] text-muted">
                    {e.attempts > 0 ? `En espera · ${e.attempts === 1 ? '1 intento' : `${e.attempts} intentos`} sin éxito` : 'En espera de enviarse'}
                    {e.attempts > 0 && e.lastError ? ` · ${e.lastError}` : ''}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cerrar
        </button>
        <button
          data-enter
          onClick={() => void sendNow()}
          disabled={sending || pending === 0}
          className="rounded-[10px] bg-lime py-2.5 text-[13px] font-semibold text-on-solid disabled:opacity-60"
        >
          {sending ? 'Enviando…' : 'Enviar ahora'}
        </button>
      </div>
    </BottomSheet>
  )
}
