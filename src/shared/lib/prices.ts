import type { Product } from '../../types/product'

/** A product can be sold at up to three prices. "Precio 1" is its `price` — what every screen uses
 * until the cashier picks another — and "Precio 2" / "Precio 3" are optional extras (`price2`,
 * `price3`: wholesale, regular customers…). Shared by the screens and the server, which charges a
 * sale line only at one of these. */
type Priced = Pick<Product, 'price' | 'price2' | 'price3'>

export interface PriceOption {
  /** 1, 2 or 3. */
  slot: number
  label: string
  price: number
}

/** Prices are compared to the cent: the browser's sums carry float noise. */
export const samePrice = (a: number, b: number): boolean => Math.abs(a - b) < 0.005

/** The prices a product is sold at, in order. Precio 1 is always there (even at 0, as ever); Precio 2
 * and 3 only when they were set. */
export function priceOptions(p: Priced): PriceOption[] {
  const out: PriceOption[] = [{ slot: 1, label: 'Precio 1', price: p.price || 0 }]
  if (p.price2 && p.price2 > 0) out.push({ slot: 2, label: 'Precio 2', price: p.price2 })
  if (p.price3 && p.price3 > 0) out.push({ slot: 3, label: 'Precio 3', price: p.price3 })
  return out
}

/** The amounts a sale line of this product may be charged at. */
export const sellingPrices = (p: Priced): number[] => priceOptions(p).map((o) => o.price)
