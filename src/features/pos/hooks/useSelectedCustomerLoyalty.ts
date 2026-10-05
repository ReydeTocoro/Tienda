import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import type { Sale } from '../../../types/sale'
import { useActiveCart } from '../../../store/useCartStore'
import { getPts, getSpent, tier } from '../../../shared/lib/loyalty'

/** Live lifetime spend/points/tier for whichever customer is picked in the active cart — the real
 * Fase 4 wiring of the loyalty discount that Fase 2 left stubbed at 0. */
export function useSelectedCustomerLoyalty() {
  const customerId = useActiveCart((c) => c.customerId)
  const sales = useLiveQuery(() => (customerId ? db.sales.where('customerId').equals(customerId).toArray() : Promise.resolve([] as Sale[])), [customerId], [])
  const spent = customerId ? getSpent(sales, customerId) : 0
  const pts = customerId ? getPts(sales, customerId) : 0
  return { spent, pts, tier: tier(spent) }
}
