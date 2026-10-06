import { useMemo, useState } from 'react'
import { useSecureTable } from '../../../db/secure'
import { addDaysToKey, daysBetween, formatDayKey, payableBalance, round2 } from '../../../shared/lib/cash'
import { formatMoney, todayKey } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import type { Payable } from '../../../types/purchaseOrder'
import { PayPayableSheet } from './PayPayableSheet'

function dueInfo(p: Payable, today: string): { label: string; cls: string } {
  if (payableBalance(p) <= 0) return { label: 'Pagada', cls: 'border-green/30 bg-green/10 text-green' }
  const d = daysBetween(today, p.dueDate)
  if (d < 0) return { label: `Vencida hace ${-d} día${d === -1 ? '' : 's'}`, cls: 'border-red/30 bg-red/10 text-red' }
  if (d === 0) return { label: 'Vence hoy', cls: 'border-orange/30 bg-orange/10 text-orange' }
  return { label: `Vence en ${d} día${d === 1 ? '' : 's'}`, cls: d <= 7 ? 'border-orange/30 bg-orange/10 text-orange' : 'border-br2 bg-s2 text-txt2' }
}

/** Cuentas por pagar: what is owed to suppliers, soonest due first. */
export function PayablesList() {
  const payables = useSecureTable('payables')
  const [showPaid, setShowPaid] = useState(false)
  const [paying, setPaying] = useState<number | null>(null)
  const today = todayKey()

  const { open, totals } = useMemo(() => {
    const pending = payables.filter((p) => payableBalance(p) > 0).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
    const soonKey = addDaysToKey(today, 7)
    return {
      open: pending,
      totals: {
        owed: round2(pending.reduce((t, p) => t + payableBalance(p), 0)),
        overdue: round2(pending.filter((p) => p.dueDate < today).reduce((t, p) => t + payableBalance(p), 0)),
        soon: round2(pending.filter((p) => p.dueDate >= today && p.dueDate <= soonKey).reduce((t, p) => t + payableBalance(p), 0)),
      },
    }
  }, [payables, today])
  const paid = useMemo(() => payables.filter((p) => payableBalance(p) <= 0).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)), [payables])
  const list = showPaid ? [...open, ...paid] : open
  // Looked up live so the sheet shows the updated balance after each payment.
  const payable = paying !== null ? payables.find((p) => p.id === paying) ?? null : null

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Stat label="Por pagar" value={formatMoney(totals.owed)} color="text-txt" />
        <Stat label="Vencido" value={formatMoney(totals.overdue)} color={totals.overdue > 0 ? 'text-red' : 'text-txt2'} />
        <Stat label="Vence en 7 días" value={formatMoney(totals.soon)} color={totals.soon > 0 ? 'text-orange' : 'text-txt2'} />
      </div>

      {!list.length ? (
        <div className="rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">No debes nada a proveedores.</div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const info = dueInfo(p, today)
            const balance = payableBalance(p)
            return (
              <div key={p.id} className="rounded-xl border border-br bg-s1 p-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold">{p.supplierName}</div>
                    <div className="font-mono text-[11px] text-muted">
                      {formatOrderId(p.orderId)} · vence {formatDayKey(p.dueDate)}
                    </div>
                  </div>
                  <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${info.cls}`}>{info.label}</span>
                </div>
                <div className="mt-2.5 flex items-end justify-between">
                  <div className="text-[11px] text-muted">
                    Total {formatMoney(p.amount)}
                    <br />
                    Pagado {formatMoney(p.paid)}
                  </div>
                  <div className="text-right">
                    {balance > 0 && <div className="field-label">Saldo</div>}
                    <div className={`font-mono text-[17px] font-bold ${balance > 0 ? 'text-red' : 'text-green'}`}>{balance > 0 ? formatMoney(balance) : formatMoney(p.amount)}</div>
                  </div>
                </div>
                {balance > 0 && (
                  <button onClick={() => setPaying(p.id ?? null)} className="mt-3 w-full rounded-[10px] bg-lime py-2 text-[13px] font-bold text-on-solid">
                    Pagar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {paid.length > 0 && (
        <button onClick={() => setShowPaid((s) => !s)} className="mt-4 text-[12px] font-semibold text-txt2 underline">
          {showPaid ? 'Ocultar pagadas' : `Ver pagadas (${paid.length})`}
        </button>
      )}

      <PayPayableSheet payable={payable} onClose={() => setPaying(null)} />
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-br bg-s1 px-3.5 py-3 text-center shadow-xs">
      <div className="field-label">{label}</div>
      <div className={`font-mono text-[17px] font-bold ${color}`}>{value}</div>
    </div>
  )
}
