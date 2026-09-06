import type { Sale } from '../../../types/sale'
import { getFiadoDebt } from '../../../db/repositories/sales'

export interface FiadoGroup {
  key: string
  name: string
  customerId: string | null
  sales: Sale[]
}

/** Group fiado sales by customer (or free-text name) — legacy `getFiadoSales()` +
 * grouping logic reused across `renderFiados()`/`openFiadoDetail()` (index.html L4754-4844). */
export function groupFiados(sales: Sale[]): FiadoGroup[] {
  const fiadoSales = sales.filter((s) => s.payMethod === 'fiado')
  const map = new Map<string, FiadoGroup>()
  for (const s of fiadoSales) {
    const key = s.customerId || '_' + (s.fiadoName || 'Desconocido').toLowerCase()
    if (!map.has(key)) {
      map.set(key, { key, name: s.fiadoName || s.customerName || 'Desconocido', customerId: s.customerId ?? null, sales: [] })
    }
    map.get(key)!.sales.push(s)
  }
  return [...map.values()]
}

export function groupTotals(group: FiadoGroup) {
  const totalOwed = group.sales.reduce((a, s) => a + s.total, 0)
  const totalDebt = group.sales.reduce((a, s) => a + getFiadoDebt(s), 0)
  const totalPaid = totalOwed - totalDebt
  return { totalOwed, totalDebt, totalPaid, isPaid: totalDebt <= 0 }
}
