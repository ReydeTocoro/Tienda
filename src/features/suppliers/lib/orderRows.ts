import type { OrderStatus, PurchaseOrder } from '../../../types/purchaseOrder'
import type { PaymentTerms } from '../../../types/supplier'
import { formatQty } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'
import { ORDER_STATUS } from './orderStatus'

/** One line of the Pedidos table: a purchase order with what the list shows already worked out. */
export interface OrderRow {
  order: PurchaseOrder
  id: number
  /** `#P0004`. */
  number: string
  supplier: string
  status: OrderStatus
  /** The date that matters for the order's status: when it was received, sent, cancelled or drafted. */
  date: string
  /** Which of those it is, to write under the date. */
  dateLabel: string
  /** Products in it — those that arrived, for a received order. */
  items: number
  /** Products as "name ×qty, …" — what arrived for a received order, what was asked for otherwise. */
  detail: string
  terms: PaymentTerms
  /** What a received order really cost; the ordered total until then. */
  total: number
  /** Only for a received order whose cost differs from what was ordered. */
  orderedTotal?: number
  /** Lower-cased text the search box matches against. */
  haystack: string
}

const DATE_LABEL: Record<OrderStatus, string> = { borrador: 'Creado', pedido: 'Enviado', recibido: 'Recibido', cancelado: 'Cancelado' }

function dateOf(o: PurchaseOrder): string {
  switch (o.status) {
    case 'recibido':
      return o.receivedAt ?? o.orderedAt ?? o.createdAt
    case 'pedido':
      return o.orderedAt ?? o.createdAt
    case 'cancelado':
      return o.cancelledAt ?? o.createdAt
    case 'borrador':
      return o.createdAt
  }
}

export function buildOrderRows(orders: PurchaseOrder[]): OrderRow[] {
  return orders.map((o) => {
    const received = o.status === 'recibido'
    const lines = received ? o.lines.filter((l) => (l.qtyReceived ?? 0) > 0) : o.lines
    const detail = lines.map((l) => `${l.name} ×${formatQty(received ? l.qtyReceived : l.qty)}`).join(', ')
    const total = received ? (o.receivedTotal ?? o.total) : o.total
    const number = formatOrderId(o.id)
    return {
      order: o,
      id: o.id ?? 0,
      number,
      supplier: o.supplierName,
      status: o.status,
      date: dateOf(o),
      dateLabel: DATE_LABEL[o.status],
      items: lines.length,
      detail,
      terms: o.paymentTerms,
      total,
      orderedTotal: received && Math.abs(total - o.total) >= 0.005 ? o.total : undefined,
      haystack: [number, o.supplierName, detail, o.lines.map((l) => l.code).join(' '), ORDER_STATUS[o.status].label, o.notes ?? ''].join(' ').toLowerCase(),
    }
  })
}

export type OrderSortKey = 'number' | 'date' | 'supplier' | 'items' | 'terms' | 'total' | 'status'

/** Newest first — the order the card list had. */
export const DEFAULT_ORDER_SORT: SortState<OrderSortKey> = { key: 'number', dir: 'desc' }

/** What needs attention first: sent orders waiting to arrive, then drafts, then the finished ones. */
const STATUS_RANK: Record<OrderStatus, number> = { pedido: 0, borrador: 1, recibido: 2, cancelado: 3 }

function sortValue(r: OrderRow, key: OrderSortKey): string | number {
  switch (key) {
    case 'number':
      return r.id
    case 'date':
      return r.date
    case 'supplier':
      return r.supplier
    case 'items':
      return r.items
    case 'terms':
      return r.terms.kind === 'contado' ? 0 : r.terms.days
    case 'total':
      return r.total
    case 'status':
      return STATUS_RANK[r.status]
  }
}

export function sortOrders(rows: OrderRow[], { key, dir }: SortState<OrderSortKey>): OrderRow[] {
  return sortRows(rows, (r) => sortValue(r, key), dir, (a, b) => b.id - a.id)
}

export type OrderStatusFilter = OrderStatus | 'todos'

export function filterOrders(rows: OrderRow[], search: string, status: OrderStatusFilter): OrderRow[] {
  // "#P0004", "P0004" and "0004" find the same order.
  const q = search.trim().toLowerCase().replace(/^#/, '')
  return rows.filter((r) => (status === 'todos' || r.status === status) && (!q || r.haystack.includes(q)))
}

/** How many orders each status filter holds, `todos` included. */
export function countByStatus(rows: OrderRow[]): Record<OrderStatusFilter, number> {
  const counts: Record<OrderStatusFilter, number> = { todos: rows.length, borrador: 0, pedido: 0, recibido: 0, cancelado: 0 }
  for (const r of rows) counts[r.status]++
  return counts
}
