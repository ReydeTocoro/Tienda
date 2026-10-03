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
  /** ISO date of the customer's latest sale; absent while they have none. */
  lastPurchase?: string
  tier: ReturnType<typeof tier>
}

/** One pass over all sales to compute lifetime spend/points per customer — replaces the
 * legacy `_spentCache` Map (index.html L1804, L2364-2369) since `useLiveQuery` already avoids
 * recomputing on every render. Sales are grouped by customer once, rather than re-filtering the
 * whole sales list for every customer. */
export function useCustomersWithSpent(): CustomerWithSpent[] {
  const customers = useLiveQuery(() => db.customers.toArray(), [], []) as Customer[]
  const sales = useLiveQuery(() => db.sales.toArray(), [], []) as Sale[]

  return useMemo(() => {
    const byCustomer = new Map<string, Sale[]>()
    for (const s of sales) {
      if (!s.customerId) continue
      const own = byCustomer.get(s.customerId)
      if (own) own.push(s)
      else byCustomer.set(s.customerId, [s])
    }
    return customers.map((customer) => {
      const own = byCustomer.get(customer.id) ?? []
      const spent = getSpent(own, customer.id)
      return {
        customer,
        spent,
        pts: getPts(own, customer.id),
        salesCount: own.length,
        lastPurchase: own.reduce<string | undefined>((last, s) => (!last || s.date > last ? s.date : last), undefined),
        tier: tier(spent),
      }
    })
  }, [customers, sales])
}
