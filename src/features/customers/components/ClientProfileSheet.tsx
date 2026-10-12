import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import type { Customer } from '../../../types/customer'
import type { Sale } from '../../../types/sale'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { ReceiptSheet } from '../../../shared/components/ReceiptSheet'
import { CustomerAvatar } from './CustomerAvatar'
import { getSpent } from '../../../shared/lib/customerSpend'
import { formatDate, formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatSaleId } from '../../../shared/lib/id'

interface ClientProfileSheetProps {
  customer: Customer | null
  onClose: () => void
  onEdit: () => void
  onSell: () => void
}

/** Customer profile — legacy `openProfile()` (index.html L4472-4530). */
export function ClientProfileSheet({ customer, onClose, onEdit, onSell }: ClientProfileSheetProps) {
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const sales = useLiveQuery(
    () => (customer ? db.sales.where('customerId').equals(customer.id).filter((s) => !s.voided).toArray() : Promise.resolve([] as Sale[])),
    [customer?.id],
    [],
  )

  const stats = useMemo(() => {
    if (!customer) return null
    const spent = getSpent(sales, customer.id)
    const sorted = [...sales].sort((a, b) => (a.date < b.date ? 1 : -1))
    const count = sorted.length
    const avg = count ? spent / count : 0
    const productCounts = new Map<string, number>()
    sorted.forEach((s) => s.items.forEach((i) => productCounts.set(i.name, (productCounts.get(i.name) || 0) + i.qty)))
    const fav = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    return { spent, count, avg, fav, recent: sorted.slice(0, 5) }
  }, [customer, sales])

  if (!customer || !stats) return null

  return (
    <>
      <BottomSheet open={!!customer} onClose={onClose}>
        <div className="mb-4 flex items-center gap-3.5 border-b border-br pb-3.5">
          <CustomerAvatar name={customer.name} size={62} />
          <div>
            <div className="font-display text-[19px] font-bold">{customer.name}</div>
            <div className="mt-0.5 text-[11px] text-muted">Cliente desde {formatDate(customer.createdAt)}</div>
            {customer.cedula && <div className="mt-0.5 text-[12px] text-txt2">{customer.cedula}</div>}
          </div>
        </div>

        <div className="mb-3.5 grid grid-cols-3 gap-2">
          <ProfileStat label="Total" value={formatMoney(stats.spent)} color="text-lime" />
          <ProfileStat label="Compras" value={String(stats.count)} color="text-blue" />
          <ProfileStat label="Promedio" value={formatMoney(stats.avg)} color="text-green" />
        </div>

        {stats.fav && (
          <div className="mb-2 text-[13px] text-txt2">
            Favorito: <b>{stats.fav[0]}</b> ({stats.fav[1]} uds)
          </div>
        )}
        {customer.phone && <div className="mb-1.5 text-[13px] text-txt2">{customer.phone}</div>}
        {customer.email && <div className="mb-1.5 text-[13px] text-txt2">{customer.email}</div>}
        {customer.notes && <div className="mb-2.5 text-[13px] text-txt2">{customer.notes}</div>}

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
            Editar
          </button>
          <button onClick={onSell} className="flex-1 rounded-[10px] bg-lime py-2.5 text-[13px] font-bold text-on-solid">
            Vender
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
