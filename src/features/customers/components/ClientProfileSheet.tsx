import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import type { Customer } from '../../../types/customer'
import type { Sale } from '../../../types/sale'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { ReceiptSheet } from '../../../shared/components/ReceiptSheet'
import { CustomerAvatar } from './CustomerAvatar'
import { getSpent, getPts, tier } from '../../../shared/lib/loyalty'
import { formatDate, formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatSaleId } from '../../../shared/lib/id'

interface ClientProfileSheetProps {
  customer: Customer | null
  onClose: () => void
  onEdit: () => void
  onSell: () => void
}

const NEXT_TIER: Array<{ threshold: number; label: string }> = [
  { threshold: 200, label: '🥉 Bronce' },
  { threshold: 1000, label: '🥈 Plata' },
  { threshold: 5000, label: '🥇 Oro' },
]

/** Customer profile — legacy `openProfile()` (index.html L4472-4530). */
export function ClientProfileSheet({ customer, onClose, onEdit, onSell }: ClientProfileSheetProps) {
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const sales = useLiveQuery(
    () => (customer ? db.sales.where('customerId').equals(customer.id).toArray() : Promise.resolve([] as Sale[])),
    [customer?.id],
    [],
  )

  const stats = useMemo(() => {
    if (!customer) return null
    const spent = getSpent(sales, customer.id)
    const pts = getPts(sales, customer.id)
    const t = tier(spent)
    const sorted = [...sales].sort((a, b) => (a.date < b.date ? 1 : -1))
    const count = sorted.length
    const avg = count ? spent / count : 0
    const productCounts = new Map<string, number>()
    sorted.forEach((s) => s.items.forEach((i) => productCounts.set(i.name, (productCounts.get(i.name) || 0) + i.qty)))
    const fav = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    const next = NEXT_TIER.find((n) => spent < n.threshold)
    const barPct = next ? Math.min(100, (spent / next.threshold) * 100) : 100
    return { spent, pts, tier: t, count, avg, fav, next, barPct, recent: sorted.slice(0, 5) }
  }, [customer, sales])

  if (!customer || !stats) return null

  return (
    <>
      <BottomSheet open={!!customer} onClose={onClose}>
        <div className="mb-4 flex items-center gap-3.5 border-b border-br pb-3.5">
          <CustomerAvatar name={customer.name} spent={stats.spent} size={62} />
          <div>
            <div className="font-display text-[19px] font-bold">{customer.name}</div>
            <div className="mt-0.5 text-[11px] text-muted">Cliente desde {formatDate(customer.createdAt)}</div>
            {customer.cedula && <div className="mt-0.5 text-[12px] text-txt2">🪪 {customer.cedula}</div>}
            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stats.tier.badgeClass}`}>{stats.tier.label}</span>
          </div>
        </div>

        <div className="mb-3.5 grid grid-cols-3 gap-2">
          <ProfileStat label="Total" value={formatMoney(stats.spent)} color="text-lime" />
          <ProfileStat label="Compras" value={String(stats.count)} color="text-blue" />
          <ProfileStat label="Promedio" value={formatMoney(stats.avg)} color="text-green" />
        </div>

        <div className="mb-3.5">
          <div className="mb-1.5 flex justify-between text-[11px] text-muted">
            <span>⭐ {stats.pts} puntos</span>
            <span>{stats.next ? `Próx: ${stats.next.label} (−${formatMoney(stats.next.threshold - stats.spent)})` : '¡Nivel máximo! 🏆'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-s3">
            <div className="h-full rounded-full bg-gradient-to-r from-lime to-orange" style={{ width: `${stats.barPct}%` }} />
          </div>
          <div className={`mt-1.5 text-[12px] ${stats.pts >= 50 ? 'text-purple' : 'text-muted'}`}>
            {stats.pts >= 50 ? '🎁 Tiene descuento disponible al cobrar' : `Faltan ${50 - stats.pts} pts para obtener descuento`}
          </div>
        </div>

        {stats.fav && (
          <div className="mb-2 text-[13px] text-txt2">
            ❤️ Favorito: <b>{stats.fav[0]}</b> ({stats.fav[1]} uds)
          </div>
        )}
        {customer.phone && <div className="mb-1.5 text-[13px] text-txt2">📱 {customer.phone}</div>}
        {customer.email && <div className="mb-1.5 text-[13px] text-txt2">✉️ {customer.email}</div>}
        {customer.notes && <div className="mb-2.5 text-[13px] text-txt2">📝 {customer.notes}</div>}

        {stats.recent.length > 0 && (
          <>
            <div className="mb-1.5 mt-1 field-label">Últimas compras</div>
            {stats.recent.map((s) => (
              <button
                key={s.id}
                onClick={() => setReceiptSale(s)}
                className="mb-1.5 flex w-full items-center justify-between rounded-[10px] bg-s2 px-3 py-2.5 text-left"
              >
                <div>
                  <div className="text-[11px] text-muted">
                    {formatDateTime(s.date)} · {s.payMethod} · {formatSaleId(s.id)}
                  </div>
                  <div className="mt-0.5 max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-txt2">
                    {s.items.map((i) => i.name).join(', ')}
                  </div>
                </div>
                <div className="flex-shrink-0 font-mono text-[14px] text-lime">{formatMoney(s.total)}</div>
              </button>
            ))}
          </>
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
            Cerrar
          </button>
          <button onClick={onEdit} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
            ✏ Editar
          </button>
          <button onClick={onSell} className="flex-1 rounded-[10px] bg-lime py-2.5 text-[13px] font-bold text-black">
            🛒 Vender
          </button>
        </div>
      </BottomSheet>
      <ReceiptSheet sale={receiptSale} onClose={() => setReceiptSale(null)} />
    </>
  )
}

function ProfileStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-[10px] bg-s2 p-2.5 text-center">
      <div className={`font-mono text-[15px] font-bold ${color}`}>{value}</div>
      <div className="mt-0.5 field-label">{label}</div>
    </div>
  )
}
