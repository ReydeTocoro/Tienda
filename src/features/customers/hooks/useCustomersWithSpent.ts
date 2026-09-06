import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { getSpent, getPts, tier } from '../../../shared/lib/loyalty'
import type { Customer } from '../../../types/customer'
import type { Sale } from '../../../types/sale'

export interface CustomerWithSpent {
  customer: Customer
  spent: number
  pts: number
  salesCount: number
  tier: ReturnType<typeof tier>
}

/** One pass over all sales to compute lifetime spend/points per customer — replaces the
 * legacy `_spentCache` Map (index.html L1804, L2364-2369) since `useLiveQuery` already avoids
 * recomputing on every render. */
export function useCustomersWithSpent(): CustomerWithSpent[] {
  const customers = useLiveQuery(() => db.customers.toArray(), [], []) as Customer[]
  const sales = useLiveQuery(() => db.sales.toArray(), [], []) as Sale[]

  return useMemo(
    () =>
      customers.map((customer) => {
        const spent = getSpent(sales, customer.id)
        return {
          customer,
          spent,
          pts: getPts(sales, customer.id),
          salesCount: sales.filter((s) => s.customerId === customer.id).length,
          tier: tier(spent),
        }
      }),
    [customers, sales],
  )
}
