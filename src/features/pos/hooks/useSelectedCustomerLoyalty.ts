import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import type { Sale } from '../../../types/sale'
import { useCartStore } from '../../../store/useCartStore'
import { getPts, getSpent, tier } from '../../../shared/lib/loyalty'

/** Live lifetime spend/points/tier for whichever customer is picked in the cart — the real
 * Fase 4 wiring of the loyalty discount that Fase 2 left stubbed at 0. */
export function useSelectedCustomerLoyalty() {
  const customerId = useCartStore((s) => s.customerId)
  const sales = useLiveQuery(() => (customerId ? db.sales.where('customerId').equals(customerId).toArray() : Promise.resolve([] as Sale[])), [customerId], [])
  const spent = customerId ? getSpent(sales, customerId) : 0
  const pts = customerId ? getPts(sales, customerId) : 0
  return { spent, pts, tier: tier(spent) }
}
