import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import type { RouteOrder, RouteOrderStatus } from '../../../types/routeOrder'
import type { Sale } from '../../../types/sale'
import { ROUTE_ORDER_STATUS } from '../lib/routeOrderStatus'
import { draftTotal } from '../lib/routeOrderDraft'
import { RouteOrderDetailSheet } from './RouteOrderDetailSheet'
import { DeliverSheet } from './DeliverSheet'

const FILTERS: Array<{ key: RouteOrderStatus | 'todos'; label: string }> = [
  { key: 'tomado', label: 'Tomados' },
  { key: 'preparado', label: 'Preparados' },
  { key: 'entregado', label: 'Entregados' },
  { key: 'cancelado', label: 'Cancelados' },
  { key: 'todos', label: 'Todos' },
]

interface RouteOrderListProps {
  onEditDraft: (o: RouteOrder) => void
  /** A pedido already delivered, in another session — looked up from `order.saleId`. */
  onViewReceipt: (saleId: number) => void
  /** A pedido just delivered right here — the Sale is already in hand, no lookup needed. */
  onDelivered: (sale: Sale) => void
}

export function RouteOrderList({ onEditDraft, onViewReceipt, onDelivered }: RouteOrderListProps) {
  const orders = useLiveQuery(() => db.routeOrders.toArray(), [], [] as RouteOrder[])
  const [filter, setFilter] = useState<RouteOrderStatus | 'todos'>('tomado')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [delivering, setDelivering] = useState<RouteOrder | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: orders.length }
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [orders])
  const shown = useMemo(() => orders.filter((o) => filter === 'todos' || o.status === filter).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)), [orders, filter])
  // Looked up live so the sheet reflects changes (e.g. just marked preparado) instead of a stale copy.
  const detail = detailId !== null ? (orders.find((o) => o.id === detailId) ?? null) : null

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${filter === f.key ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s2'}`}
          >
            {f.label} ({counts[f.key] ?? 0})
          </button>
        ))}
      </div>

      {!shown.length ? (
        <div className="rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">No hay pedidos en esta vista.</div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((o) => (
            <button key={o.id} onClick={() => setDetailId(o.id ?? null)} className="rounded-xl border border-br bg-s1 p-3.5 text-left shadow-xs transition-colors hover:border-br2 hover:bg-s2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate text-[14px] font-bold">{o.customerName}</div>
                <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ROUTE_ORDER_STATUS[o.status].cls}`}>{ROUTE_ORDER_STATUS[o.status].label}</span>
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-[11px] text-muted">
                  {o.items.length} producto{o.items.length !== 1 ? 's' : ''}
                  <br />
                  {formatDateTime(o.deliveredAt ?? o.preparedAt ?? o.createdAt)}
                </div>
                <div className="font-mono text-[16px] font-bold">{formatMoney(draftTotal(o.items))}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <RouteOrderDetailSheet
        order={detail}
        onClose={() => setDetailId(null)}
        onEdit={(o) => {
          setDetailId(null)
          onEditDraft(o)
        }}
        onDeliver={(o) => {
          setDetailId(null)
          setDelivering(o)
        }}
        onViewReceipt={(saleId) => {
          setDetailId(null)
          onViewReceipt(saleId)
        }}
      />
      <DeliverSheet
        order={delivering}
        onClose={() => setDelivering(null)}
        onDelivered={(sale) => {
          setDelivering(null)
          onDelivered(sale)
        }}
      />
    </div>
  )
}
