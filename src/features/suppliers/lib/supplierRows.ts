import type { Payable, PurchaseOrder } from '../../../types/purchaseOrder'
import type { PaymentTerms, Supplier } from '../../../types/supplier'
import { payableBalance, round2 } from '../../../shared/lib/cash'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'

/** One line of the Proveedores table: the supplier plus what is still open with them. */
export interface SupplierRow {
  supplier: Supplier
  id: string
  name: string
  nit: string
  contact: string
  phone: string
  email: string
  terms: PaymentTerms
  active: boolean
  /** What the shop still owes them (the open balance of their accounts payable). */
  owed: number
  /** Orders sent to them that haven't arrived yet. */
  toReceive: number
  /** Lower-cased text the search box matches against. */
  haystack: string
}

export function buildSupplierRows(suppliers: Supplier[], payables: Payable[], orders: PurchaseOrder[]): SupplierRow[] {
  const owed = new Map<string, number>()
  for (const p of payables) {
    const balance = payableBalance(p)
    if (balance > 0) owed.set(p.supplierId, (owed.get(p.supplierId) ?? 0) + balance)
  }
  const toReceive = new Map<string, number>()
  for (const o of orders) if (o.status === 'pedido') toReceive.set(o.supplierId, (toReceive.get(o.supplierId) ?? 0) + 1)

  return suppliers.map((s) => ({
    supplier: s,
    id: s.id,
    name: s.name,
    nit: s.nit ?? '',
    contact: s.contact ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    terms: s.paymentTerms,
    active: s.active,
    owed: round2(owed.get(s.id) ?? 0),
    toReceive: toReceive.get(s.id) ?? 0,
    haystack: [s.name, s.nit, s.contact, s.phone, s.email].filter(Boolean).join(' ').toLowerCase(),
  }))
}

export type SupplierSortKey = 'name' | 'contact' | 'phone' | 'terms' | 'owed' | 'toReceive' | 'status'

export const DEFAULT_SUPPLIER_SORT: SortState<SupplierSortKey> = { key: 'name', dir: 'asc' }

function sortValue(r: SupplierRow, key: SupplierSortKey): string | number {
  switch (key) {
    case 'name':
      return r.name
    case 'contact':
      return r.contact
    case 'phone':
      return r.phone
    case 'terms':
      return r.terms.kind === 'contado' ? 0 : r.terms.days
    case 'owed':
      return r.owed
    case 'toReceive':
      return r.toReceive
    case 'status':
      return r.active ? 0 : 1 // ascending puts the active ones first
  }
}

export function sortSuppliers(rows: SupplierRow[], { key, dir }: SortState<SupplierSortKey>): SupplierRow[] {
  return sortRows(rows, (r) => sortValue(r, key), dir, (a, b) => a.name.localeCompare(b.name, 'es'))
}

export type SupplierFilter = 'todos' | 'activos' | 'inactivos' | 'deuda'

const MATCHES: Record<SupplierFilter, (r: SupplierRow) => boolean> = {
  todos: () => true,
  activos: (r) => r.active,
  inactivos: (r) => !r.active,
  deuda: (r) => r.owed > 0,
}

export function filterSuppliers(rows: SupplierRow[], search: string, filter: SupplierFilter): SupplierRow[] {
  const q = search.trim().toLowerCase()
  return rows.filter((r) => MATCHES[filter](r) && (!q || r.haystack.includes(q)))
}

/** How many suppliers each filter holds. */
export function countSuppliers(rows: SupplierRow[]): Record<SupplierFilter, number> {
  const counts: Record<SupplierFilter, number> = { todos: rows.length, activos: 0, inactivos: 0, deuda: 0 }
  for (const r of rows) for (const f of ['activos', 'inactivos', 'deuda'] as const) if (MATCHES[f](r)) counts[f]++
  return counts
}
