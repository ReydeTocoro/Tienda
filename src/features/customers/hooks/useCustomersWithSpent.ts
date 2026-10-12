import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { getSpent } from '../../../shared/lib/customerSpend'
import type { Customer } from '../../../types/customer'
import type { Sale } from '../../../types/sale'

export interface CustomerWithSpent {
  customer: Customer
  spent: number
  salesCount: number
  /** ISO date of the customer's latest sale; absent while they have none. */
  lastPurchase?: string
}

/** One pass over all sales to compute lifetime spend/points per customer — replaces the
 * legacy `_spentCache` Map (index.html L1804, L2364-2369) since `useLiveQuery` already avoids
 * recomputing on every render. Sales are grouped by customer once, rather than re-filtering the
 * whole sales list for every customer. */
export function useCustomersWithSpent(): CustomerWithSpent[] {
  const customers = useLiveQuery(() => db.customers.toArray(), [], []) as Customer[]
  // Only the sales that have a customer (the index leaves out the rest): a counter sale has nothing to add here.
  const sales = useLiveQuery(() => db.sales.where('customerId').above('').toArray(), [], []) as Sale[]

  return useMemo(() => {
    const byCustomer = new Map<string, Sale[]>()
    for (const s of sales) {
      if (!s.customerId || s.voided) continue
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
        salesCount: own.length,
        lastPurchase: own.reduce<string | undefined>((last, s) => (!last || s.date > last ? s.date : last), undefined),
      }
    })
  }, [customers, sales])
}
