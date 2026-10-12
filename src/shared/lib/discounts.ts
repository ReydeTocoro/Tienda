import type { CartItem } from '../../types/cartItem'

/** Money taken off one line by hand: what was typed, never more than the line itself is worth. */
export function lineDiscount(i: Pick<CartItem, 'price' | 'qty' | 'discount'>): number {
  return Math.min(Math.max(i.discount ?? 0, 0), i.price * i.qty)
}

/** The sale's discount: all the money discounts typed on the lines of a cart. */
export function manualDiscountOf(items: Array<Pick<CartItem, 'price' | 'qty' | 'discount'>>): number {
  return items.reduce((a, i) => a + lineDiscount(i), 0)
}
