import type { PurchaseOrder } from '../../../types/purchaseOrder'
import type { PayMethod, Sale } from '../../../types/sale'
import { getFiadoDebt } from '../../../db/repositories/sales'
import { addDaysToKey } from '../../../shared/lib/cash'
import { dayKeyOf, formatQty } from '../../../shared/lib/currency'
import { formatOrderId, formatSaleId } from '../../../shared/lib/id'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'

export type InvoiceKind = 'venta' | 'compra'
/** How an invoice was paid: sales with the till's methods, supplier purchases in cash or on credit. */
export type InvoiceMethod = PayMethod | 'contado' | 'credito' | 'ninguno'
export type InvoiceStatus = 'pagada' | 'por cobrar' | 'recibida'

/** One line of the Facturas table: a sale or a received supplier order, normalized to the same
 * columns so they can be filtered, sorted and totalled together. */
export interface InvoiceRow {
  key: string
  kind: InvoiceKind
  /** Display number: `#0012` for a sale, `#P0004` for a purchase. */
  number: string
  date: string
  /** 'YYYY-MM-DD' in the store's timezone. */
  dayKey: string
  /** Customer, fiado name or supplier — see `partyKind` for which. */
  party: string
  partyKind: 'cliente' | 'fiado' | 'publico' | 'proveedor'
  /** Items as "name ×qty, …". */
  detail: string
  method: InvoiceMethod
  total: number
  /** Fiado balance still owed (sales only). */
  debt: number
  corrected: boolean
  status: InvoiceStatus
  /** Lower-cased text the search box matches against. */
  haystack: string
  sale?: Sale
  order?: PurchaseOrder
}

export const METHOD_LABEL: Record<InvoiceMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  fiado: 'Fiado',
  contado: 'Contado',
  credito: 'Crédito',
  ninguno: '—',
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pagada: 'Pagada',
  'por cobrar': 'Por cobrar',
  recibida: 'Recibida',
}

function finish(row: Omit<InvoiceRow, 'haystack'>): InvoiceRow {
  return { ...row, haystack: [row.number, row.party, row.detail, METHOD_LABEL[row.method], STATUS_LABEL[row.status]].join(' ').toLowerCase() }
}

export function buildInvoiceRows(sales: Sale[], orders: PurchaseOrder[]): InvoiceRow[] {
  const ventas = sales.map((s) => {
    const debt = s.payMethod === 'fiado' ? getFiadoDebt(s) : 0
    return finish({
      key: 'v' + s.id,
      kind: 'venta',
      number: formatSaleId(s.id),
      date: s.date,
      dayKey: s.dayKey,
      party: s.customerName || s.fiadoName || 'Público general',
      partyKind: s.customerName ? 'cliente' : s.fiadoName ? 'fiado' : 'publico',
      detail: s.items.map((i) => `${i.name} ×${formatQty(i.qty)}`).join(', '),
      method: s.payMethod,
      total: s.total,
      debt,
      corrected: !!s.corrected,
      status: debt > 0 ? 'por cobrar' : 'pagada',
      sale: s,
    })
  })
  const compras = orders.map((o) => {
    const date = o.receivedAt ?? o.createdAt
    return finish({
      key: 'p' + o.id,
      kind: 'compra',
      number: formatOrderId(o.id),
      date,
      dayKey: dayKeyOf(date),
      party: o.supplierName,
      partyKind: 'proveedor',
      detail: o.lines
        .filter((l) => (l.qtyReceived ?? 0) > 0)
        .map((l) => `${l.name} ×${formatQty(l.qtyReceived)}`)
        .join(', '),
      method: o.payment?.mode ?? 'ninguno',
      total: o.receivedTotal ?? o.total,
      debt: 0,
      corrected: false,
      status: 'recibida',
      order: o,
    })
  })
  return [...ventas, ...compras]
}

export type InvoiceSortKey = 'number' | 'date' | 'kind' | 'party' | 'method' | 'total' | 'status'

/** Newest first — the order the old history list had. */
export const DEFAULT_INVOICE_SORT: SortState<InvoiceSortKey> = { key: 'date', dir: 'desc' }

function sortValue(r: InvoiceRow, key: InvoiceSortKey): string | number {
  switch (key) {
    case 'number':
      return r.number
    case 'date':
      return r.date
    case 'kind':
      return r.kind
    case 'party':
      return r.party
    case 'method':
      return METHOD_LABEL[r.method]
    case 'total':
      return r.total
    case 'status':
      return STATUS_LABEL[r.status]
  }
}

export function sortInvoices(rows: InvoiceRow[], { key, dir }: SortState<InvoiceSortKey>): InvoiceRow[] {
  return sortRows(rows, (r) => sortValue(r, key), dir, (a, b) => (a.date < b.date ? 1 : -1))
}

export type InvoicePeriod = 'todo' | 'hoy' | 'semana' | 'mes'

export const INVOICE_PERIODS: Record<InvoicePeriod, { label: string; days: number | null }> = {
  todo: { label: 'Todo el tiempo', days: null },
  hoy: { label: 'Hoy', days: 0 },
  semana: { label: 'Últimos 7 días', days: 7 },
  mes: { label: 'Últimos 30 días', days: 30 },
}

export interface InvoiceFilters {
  search: string
  kind: 'todas' | InvoiceKind
  method: 'todos' | PayMethod
  period: InvoicePeriod
}

export function filterInvoices(rows: InvoiceRow[], f: InvoiceFilters, today: string): InvoiceRow[] {
  // "#0012" and "0012" find the same invoice.
  const q = f.search.trim().toLowerCase().replace(/^#/, '')
  const days = INVOICE_PERIODS[f.period].days
  const since = days === null ? null : addDaysToKey(today, -days)
  return rows.filter(
    (r) => (f.kind === 'todas' || r.kind === f.kind) && (f.method === 'todos' || r.method === f.method) && (since === null || r.dayKey >= since) && (!q || r.haystack.includes(q)),
  )
}
