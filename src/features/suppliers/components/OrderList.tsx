import { useMemo, useState } from 'react'
import { useSecureTable } from '../../../db/secure'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import type { OrderStatus, PurchaseOrder } from '../../../types/purchaseOrder'
import { ORDER_STATUS } from '../lib/orderStatus'
import { OrderDetailSheet } from './OrderDetailSheet'
import { ReceiveOrderSheet } from './ReceiveOrderSheet'

const FILTERS: Array<{ key: OrderStatus | 'todos'; label: string }> = [
  { key: 'pedido', label: 'Por recibir' },
  { key: 'borrador', label: 'Borradores' },
  { key: 'recibido', label: 'Recibidos' },
  { key: 'cancelado', label: 'Cancelados' },
  { key: 'todos', label: 'Todos' },
]

interface OrderListProps {
  onEditDraft: (o: PurchaseOrder) => void
}

export function OrderList({ onEditDraft }: OrderListProps) {
  const orders = useSecureTable('purchaseOrders')
  const [filter, setFilter] = useState<OrderStatus | 'todos'>('pedido')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: orders.length }
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [orders])
  const shown = useMemo(() => orders.filter((o) => filter === 'todos' || o.status === filter).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)), [orders, filter])
  // Looked up live so the sheet reflects changes (e.g. just received) instead of a stale copy.
  const detail = detailId !== null ? orders.find((o) => o.id === detailId) ?? null : null

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
                <div className="min-w-0">
                  <div className="font-mono text-[12px] text-lime">{formatOrderId(o.id)}</div>
                  <div className="truncate text-[14px] font-bold">{o.supplierName}</div>
                </div>
                <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span>
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-[11px] text-muted">
                  {o.lines.length} producto{o.lines.length !== 1 ? 's' : ''}
                  <br />
                  {formatDateTime(o.receivedAt ?? o.orderedAt ?? o.createdAt)}
                </div>
                <div className="font-mono text-[16px] font-bold">{formatMoney(o.status === 'recibido' ? (o.receivedTotal ?? o.total) : o.total)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <OrderDetailSheet
        order={detail}
        onClose={() => setDetailId(null)}
        onEditDraft={(o) => {
          setDetailId(null)
          onEditDraft(o)
        }}
        onReceive={(o) => {
          setDetailId(null)
          setReceiving(o)
        }}
      />
      <ReceiveOrderSheet order={receiving} onClose={() => setReceiving(null)} onReceived={() => setReceiving(null)} />
    </div>
  )
}
