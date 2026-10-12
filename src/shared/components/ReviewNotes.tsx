import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { markSaleReviewed } from '../../db/repositories/sales'
import { toast } from '../../store/useToastStore'
import type { Sale } from '../../types/sale'
import { formatDateTime } from '../lib/currency'

/** What did not add up when the server received a sale made without internet (stock that wasn't there, a price
 * that changed meanwhile, a discount nobody could authorize…), for whoever may correct invoices to read and mark
 * as reviewed. The sale itself stands either way — the goods already left. The server decides who may mark it
 * (`facturas.corregir`; without it, it asks for a supervisor's PIN like any other step). */
export function ReviewNotes({ sale }: { sale: Sale }) {
  const [updated, setUpdated] = useState<Sale | null>(null)
  const [busy, setBusy] = useState(false)
  const current = updated ?? sale
  if (!current.reviewNotes?.length || current.id === undefined || current.id < 0) return null
  const reviewed = !!current.reviewedAt
  const saleId = current.id

  async function mark() {
    setBusy(true)
    try {
      setUpdated(await markSaleReviewed(saleId))
      toast('Venta marcada como revisada', 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'orange')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`mt-2 rounded-md border px-2 py-1.5 font-sans text-[11px] leading-snug ${reviewed ? 'border-br2 bg-s2 text-txt2' : 'border-orange/30 bg-orange/10 text-orange'}`}
    >
      <div className="mb-0.5 flex items-center gap-1 font-semibold">
        <AlertTriangle size={12} />
        {reviewed ? 'Observaciones de esta venta (ya revisadas)' : 'Venta hecha sin internet: hay que revisarla'}
      </div>
      <ul className="list-disc pl-4">
        {current.reviewNotes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      {reviewed ? (
        <div className="mt-1 text-muted">
          Revisada el {formatDateTime(current.reviewedAt)}
          {current.reviewedBy ? ` por ${current.reviewedBy}` : ''}
        </div>
      ) : (
        <button
          onClick={() => void mark()}
          disabled={busy}
          className="mt-1.5 rounded-lg border border-orange/40 px-2.5 py-1 font-semibold disabled:opacity-60"
        >
          {busy ? 'Guardando…' : 'Marcar como revisada'}
        </button>
      )}
    </div>
  )
}
