import { sortRows, type SortState } from '../../../shared/lib/sortRows'
import type { CustomerWithSpent } from '../hooks/useCustomersWithSpent'

export type CustomerSortKey = 'name' | 'cedula' | 'phone' | 'count' | 'spent' | 'pts' | 'tier' | 'last'

/** Biggest spenders first — what the list showed before it became a sortable table. */
export const DEFAULT_CUSTOMER_SORT: SortState<CustomerSortKey> = { key: 'spent', dir: 'desc' }

function sortValue(r: CustomerWithSpent, key: CustomerSortKey): string | number {
  switch (key) {
    case 'name':
      return r.customer.name
    case 'cedula':
      return r.customer.cedula ?? ''
    case 'phone':
      return r.customer.phone ?? ''
    case 'count':
      return r.salesCount
    case 'spent':
    case 'tier': // the tier is a band of lifetime spend, so it orders like spend does
      return r.spent
    case 'pts':
      return r.pts
    case 'last':
      return r.lastPurchase ?? ''
  }
}

export function sortCustomers(rows: CustomerWithSpent[], { key, dir }: SortState<CustomerSortKey>): CustomerWithSpent[] {
  return sortRows(rows, (r) => sortValue(r, key), dir, (a, b) => a.customer.name.localeCompare(b.customer.name, 'es'))
}
