import type { Payable } from '../../../types/purchaseOrder'
import { daysBetween, payableBalance, round2 } from '../../../shared/lib/cash'
import { dayKeyOf } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'

/** Where an account payable stands against its due date. */
export type PayableStatus = 'vencida' | 'hoy' | 'proxima' | 'vigente' | 'pagada'

/** A payable counts as "coming up" when it falls due within this many days (today included). */
export const DUE_SOON_DAYS = 7

/** One line of the Por pagar table: what is owed to a supplier for one received order. */
export interface PayableRow {
  payable: Payable
  id: number
  supplier: string
  /** `#P0004` — the order it comes from. */
  orderNumber: string
  /** 'YYYY-MM-DD' of the day the goods were received on credit. */
  issuedKey: string
  /** 'YYYY-MM-DD'. */
  dueKey: string
  /** Days from today to the due date: negative once it is overdue. */
  daysLeft: number
  amount: number
  paid: number
  balance: number
  status: PayableStatus
  /** Lower-cased text the search box matches against. */
  haystack: string
}

export function buildPayableRows(payables: Payable[], today: string): PayableRow[] {
  return payables.map((p) => {
    const balance = payableBalance(p)
    const daysLeft = daysBetween(today, p.dueDate)
    const status: PayableStatus = balance <= 0 ? 'pagada' : daysLeft < 0 ? 'vencida' : daysLeft === 0 ? 'hoy' : daysLeft <= DUE_SOON_DAYS ? 'proxima' : 'vigente'
    const orderNumber = formatOrderId(p.orderId)
    return {
      payable: p,
      id: p.id ?? 0,
      supplier: p.supplierName,
      orderNumber,
      issuedKey: dayKeyOf(p.issuedAt),
      dueKey: p.dueDate,
      daysLeft,
      amount: p.amount,
      paid: p.paid,
      balance,
      status,
      haystack: [p.supplierName, orderNumber].join(' ').toLowerCase(),
    }
  })
}

export interface PayableSummary {
  /** Accounts that still have a balance. */
  open: number
  owed: number
  /** Owed on accounts past their due date. */
  overdue: number
  /** Owed on accounts due within `DUE_SOON_DAYS`, today included. */
  soon: number
}

export function summarizePayables(rows: PayableRow[]): PayableSummary {
  let open = 0
  let owed = 0
  let overdue = 0
  let soon = 0
  for (const r of rows) {
    if (r.status === 'pagada') continue
    open++
    owed += r.balance
    if (r.status === 'vencida') overdue += r.balance
    else if (r.status === 'hoy' || r.status === 'proxima') soon += r.balance
  }
  return { open, owed: round2(owed), overdue: round2(overdue), soon: round2(soon) }
}

export type PayableSortKey = 'supplier' | 'order' | 'issued' | 'due' | 'amount' | 'paid' | 'balance' | 'status'

/** The most urgent first: overdue (the oldest first), due today, coming up, later, and the paid ones last. */
export const DEFAULT_PAYABLE_SORT: SortState<PayableSortKey> = { key: 'status', dir: 'asc' }

const STATUS_RANK: Record<PayableStatus, number> = { vencida: 0, hoy: 1, proxima: 2, vigente: 3, pagada: 4 }

function sortValue(r: PayableRow, key: PayableSortKey): string | number {
  switch (key) {
    case 'supplier':
      return r.supplier
    case 'order':
      return r.payable.orderId
    case 'issued':
      return r.issuedKey
    case 'due':
      return r.dueKey
    case 'amount':
      return r.amount
    case 'paid':
      return r.paid
    case 'balance':
      return r.balance
    case 'status':
      return STATUS_RANK[r.status]
  }
}

export function sortPayables(rows: PayableRow[], { key, dir }: SortState<PayableSortKey>): PayableRow[] {
  return sortRows(rows, (r) => sortValue(r, key), dir, (a, b) => {
    // Among the paid, the latest first; among the rest, the one that falls due first.
    if (a.status === 'pagada' && b.status === 'pagada') return b.id - a.id
    return a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : a.id - b.id
  })
}

export type PayableFilter = 'pendientes' | 'vencidas' | 'semana' | 'pagadas' | 'todas'

const MATCHES: Record<PayableFilter, (r: PayableRow) => boolean> = {
  pendientes: (r) => r.status !== 'pagada',
  vencidas: (r) => r.status === 'vencida',
  semana: (r) => r.status === 'hoy' || r.status === 'proxima',
  pagadas: (r) => r.status === 'pagada',
  todas: () => true,
}

export function filterPayables(rows: PayableRow[], search: string, filter: PayableFilter): PayableRow[] {
  // "#P0004", "P0004" and "0004" find the same order.
  const q = search.trim().toLowerCase().replace(/^#/, '')
  return rows.filter((r) => MATCHES[filter](r) && (!q || r.haystack.includes(q)))
}

/** How many accounts each filter holds. */
export function countPayables(rows: PayableRow[]): Record<PayableFilter, number> {
  const counts: Record<PayableFilter, number> = { pendientes: 0, vencidas: 0, semana: 0, pagadas: 0, todas: rows.length }
  for (const r of rows) for (const f of ['pendientes', 'vencidas', 'semana', 'pagadas'] as const) if (MATCHES[f](r)) counts[f]++
  return counts
}
