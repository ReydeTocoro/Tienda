import { useMemo } from 'react'
import { useSecureTable } from '../../db/secure'
import type { Product } from '../../types/product'
import type { Sale } from '../../types/sale'

/** Purchase prices and profits, from the tables the database only sends to a device where someone
 * allowed is working (src/db/secure.ts). Empty for everyone else — so a screen that shows them must
 * still check the permission (`can('costos.ver')`, `can('ganancias.ver')`) to tell "none" from
 * "not allowed". */

/** Purchase price of each product, by code. */
export function useCostMap(): Map<string, number> {
  const rows = useSecureTable('productCosts')
  return useMemo(() => new Map(rows.map((r) => [r.code, Number(r.cost) || 0])), [rows])
}

/** The products with their purchase price filled in (0 where there is none, or none may be seen). */
export function withCosts<P extends Product>(products: P[], costs: Map<string, number>): Array<P & { cost: number }> {
  return products.map((p) => ({ ...p, cost: costs.get(p.code) ?? 0 }))
}

/** Profit of each sale (by sale id) and of each cierre (by cierre id). */
export function useProfits(): { sales: Map<number, number>; cierres: Map<number, number> } {
  const rows = useSecureTable('profits')
  return useMemo(() => {
    const sales = new Map<number, number>()
    const cierres = new Map<number, number>()
    for (const r of rows) (r.kind === 'cierre' ? cierres : sales).set(Number(r.refId), Number(r.ganancia) || 0)
    return { sales, cierres }
  }, [rows])
}

/** The sales with their profit filled in (0 where none may be seen). */
export function withProfits(sales: Sale[], profits: Map<number, number>): Sale[] {
  return sales.map((s) => ({ ...s, ganancia: s.id !== undefined ? (profits.get(s.id) ?? 0) : 0 }))
}
