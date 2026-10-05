import type { CartItem } from '../../../types/cartItem'
import { isMeasuredUnit } from '../../../shared/lib/units'

/** "Ítems" in a cart. A weighed/measured line is one item, however many kg or metres it holds
 * ("16.5 ítems" read like a bug). */
export function countItems(items: CartItem[]): number {
  return items.reduce((a, i) => a + (isMeasuredUnit(i.unit) ? 1 : i.qty), 0)
}
