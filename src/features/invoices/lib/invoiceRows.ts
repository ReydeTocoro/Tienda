import type { PurchaseOrder } from '../../../types/purchaseOrder'
import type { PayMethod, Sale } from '../../../types/sale'
import { getFiadoDebt } from '../../../db/repositories/sales'
import { addDaysToKey, formatDayKey } from '../../../shared/lib/cash'
import { dayKeyOf, formatQty } from '../../../shared/lib/currency'
import { formatOrderId, formatSaleId, isPendingSaleId } from '../../../shared/lib/id'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'
import { ACCOUNT_LABEL, type TransferAccount } from '../../../shared/lib/transferAccounts'

export type InvoiceKind = 'venta' | 'compra'
/** How an invoice was paid: sales with the till's methods, supplier purchases in cash or on credit. */
export type InvoiceMethod = PayMethod | 'contado' | 'credito' | 'ninguno'
/** 'por enviar': a sale made without internet that the server doesn't have yet. 'anulada': annulled (history only). */
export type InvoiceStatus = 'pagada' | 'por cobrar' | 'recibida' | 'por enviar' | 'anulada'

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
  /** Who made the sale or received the order, when someone was signed in. */
  seller: string
  method: InvoiceMethod
  /** The account a transfer came into, when the sale says. */
  account?: TransferAccount
  total: number
  /** Fiado balance still owed (sales only). */
  debt: number
  corrected: boolean
  /** Annulled: it stays in the list but counts in no total. */
  voided: boolean
  /** A sale made without internet whose oddities (`reviewNotes`) nobody has marked as read yet. */
  toReview: boolean
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
  'por enviar': 'Por enviar',
  anulada: 'Anulada',
}

function finish(row: Omit<InvoiceRow, 'haystack'>): InvoiceRow {
  return { ...row, haystack: [row.number, row.party, row.detail, row.seller, METHOD_LABEL[row.method], row.account ? ACCOUNT_LABEL[row.account] : '', STATUS_LABEL[row.status], row.toReview ? 'por revisar' : ''].join(' ').toLowerCase() }
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
      seller: s.sellerName ?? '',
      method: s.payMethod,
      account: s.payMethod === 'transferencia' ? s.transferAccount : undefined,
      total: s.total,
      debt,
      corrected: !!s.corrected,
      voided: !!s.voided,
      toReview: !!s.reviewNotes?.length && !s.reviewedAt && !s.voided,
      status: s.voided ? 'anulada' : isPendingSaleId(s.id) ? 'por enviar' : debt > 0 ? 'por cobrar' : 'pagada',
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
      seller: o.receivedBy ?? '',
      method: o.payment?.mode ?? 'ninguno',
      total: o.receivedTotal ?? o.total,
      debt: 0,
      corrected: false,
      voided: false,
      toReview: false,
      status: 'recibida',
      order: o,
    })
  })
  return [...ventas, ...compras]
}

export type InvoiceSortKey = 'number' | 'date' | 'kind' | 'party' | 'seller' | 'method' | 'total' | 'status'

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
    case 'seller':
      return r.seller
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

/** Which days the list covers: today (where it opens), the last week or month, everything, one
 * chosen day (`dia`) or from one day to another (`rango`). */
export type InvoicePeriod = 'hoy' | 'semana' | 'mes' | 'todo' | 'dia' | 'rango'

/** `days` only matters for the presets that count back from today; `dia` and `rango` take their
 * days from the pickers (`InvoiceFilters.day` / `from` / `to`). */
export const INVOICE_PERIODS: Record<InvoicePeriod, { label: string; days: number | null }> = {
  hoy: { label: 'Hoy', days: 0 },
  semana: { label: 'Últimos 7 días', days: 7 },
  mes: { label: 'Últimos 30 días', days: 30 },
  todo: { label: 'Todo el tiempo', days: null },
  dia: { label: 'Elegir un día', days: null },
  rango: { label: 'Rango de fechas', days: null },
}

/** The day pickers' part of the filters: 'YYYY-MM-DD' keys, '' = not set. */
export interface InvoiceDays {
  period: InvoicePeriod
  /** The day, for `dia`. */
  day: string
  /** The two ends, for `rango`. */
  from: string
  to: string
}

export interface InvoiceFilters extends InvoiceDays {
  search: string
  kind: 'todas' | InvoiceKind
  method: 'todos' | PayMethod
}

/** First and last day an invoice may fall on ('YYYY-MM-DD', both included); null = no limit on that
 * side. A date left empty never limits, and the two ends of a range may come in either order. */
export function periodBounds(f: InvoiceDays, today: string): { since: string | null; until: string | null } {
  if (f.period === 'dia') return { since: f.day || null, until: f.day || null }
  if (f.period === 'rango') {
    const [since, until] = f.from && f.to && f.from > f.to ? [f.to, f.from] : [f.from, f.to]
    return { since: since || null, until: until || null }
  }
  const days = INVOICE_PERIODS[f.period].days
  return { since: days === null ? null : addDaysToKey(today, -days), until: null }
}

/** The period as the end of a sentence — "No hay facturas hoy" — or '' when it limits nothing. */
export function periodPhrase(f: InvoiceDays, today: string): string {
  const days = INVOICE_PERIODS[f.period].days
  if (days === 0) return 'hoy'
  if (days !== null) return `en los últimos ${days} días`
  const { since, until } = periodBounds(f, today)
  if (since && since === until) return `el ${formatDayKey(since)}`
  if (since && until) return `entre el ${formatDayKey(since)} y el ${formatDayKey(until)}`
  if (since) return `desde el ${formatDayKey(since)}`
  if (until) return `hasta el ${formatDayKey(until)}`
  return ''
}

export function filterInvoices(rows: InvoiceRow[], f: InvoiceFilters, today: string): InvoiceRow[] {
  // "#0012" and "0012" find the same invoice.
  const q = f.search.trim().toLowerCase().replace(/^#/, '')
  const { since, until } = periodBounds(f, today)
  return rows.filter(
    (r) =>
      (f.kind === 'todas' || r.kind === f.kind) &&
      (f.method === 'todos' || r.method === f.method) &&
      (since === null || r.dayKey >= since) &&
      (until === null || r.dayKey <= until) &&
      (!q || r.haystack.includes(q)),
  )
}
