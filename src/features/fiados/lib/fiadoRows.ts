import type { Customer } from '../../../types/customer'
import { getFiadoDebt } from '../../../db/repositories/sales'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'
import { groupTotals, type FiadoGroup } from './fiadoGrouping'

/** One line of the Fiados table: everything a debtor owes, summed over their fiado sales. */
export interface FiadoRow {
  group: FiadoGroup
  customer: Customer | null
  name: string
  cedula: string
  phone: string
  /** Number of fiado sales. */
  count: number
  totalOwed: number
  totalPaid: number
  debt: number
  isPaid: boolean
  /** 'YYYY-MM-DD' of the oldest sale that still has a balance; absent once everything is paid. */
  sinceKey?: string
}

export function buildFiadoRows(groups: FiadoGroup[], customerById: Map<string, Customer>): FiadoRow[] {
  return groups.map((group) => {
    const customer = group.customerId ? (customerById.get(group.customerId) ?? null) : null
    const { totalOwed, totalDebt, totalPaid, isPaid } = groupTotals(group)
    const openDays = group.sales.filter((s) => getFiadoDebt(s) > 0).map((s) => s.dayKey)
    return {
      group,
      customer,
      name: group.name,
      cedula: customer?.cedula ?? '',
      phone: customer?.phone ?? '',
      count: group.sales.length,
      totalOwed,
      totalPaid,
      debt: totalDebt,
      isPaid,
      sinceKey: openDays.length ? openDays.reduce((a, b) => (b < a ? b : a)) : undefined,
    }
  })
}

export type FiadoSortKey = 'name' | 'cedula' | 'phone' | 'count' | 'since' | 'total' | 'paid' | 'debt' | 'status'

/** Who owes the most first — what the card list put at the top of the collection round. */
export const DEFAULT_FIADO_SORT: SortState<FiadoSortKey> = { key: 'debt', dir: 'desc' }

function sortValue(r: FiadoRow, key: FiadoSortKey): string | number {
  switch (key) {
    case 'name':
      return r.name
    case 'cedula':
      return r.cedula
    case 'phone':
      return r.phone
    case 'count':
      return r.count
    case 'since':
      return r.sinceKey ?? ''
    case 'total':
      return r.totalOwed
    case 'paid':
      return r.totalPaid
    case 'debt':
      return r.debt
    case 'status':
      return r.isPaid ? 1 : 0 // ascending puts the debts first
  }
}

export function sortFiados(rows: FiadoRow[], { key, dir }: SortState<FiadoSortKey>): FiadoRow[] {
  return sortRows(rows, (r) => sortValue(r, key), dir, (a, b) => b.debt - a.debt || a.name.localeCompare(b.name, 'es'))
}

export type FiadoStatusFilter = 'todos' | 'deuda' | 'pagado'

export function filterFiados(rows: FiadoRow[], search: string, status: FiadoStatusFilter): FiadoRow[] {
  const q = search.trim().toLowerCase()
  return rows.filter(
    (r) => (status === 'todos' || (status === 'deuda' ? !r.isPaid : r.isPaid)) && (!q || r.name.toLowerCase().includes(q) || r.cedula.includes(q) || r.phone.includes(q)),
  )
}
