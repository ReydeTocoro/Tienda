import type { CartItem } from '../../types/cartItem'

/** Same rounding as every stock write (`roundQty` in server/routes/generic.ts): kg and weighed sales drift otherwise. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000

/** A line with an inventory product behind it. The `CORR` line of old corrections and a "producto sin registrar"
 * (`FREE_…`) have none, so they never touch the shelf. Decided from the code too — `isFree` alone is what the
 * browser says. */
export const isTracked = (i: Pick<CartItem, 'code' | 'isFree'>): boolean => !i.isFree && i.code !== 'CORR' && !i.code.startsWith('FREE_')

export interface StockEffect {
  code: string
  name: string
  /** Units that go back on the shelf (+) or come off it (−) when `before` becomes `after`. */
  delta: number
}

/** What changing the lines of a sale does to the inventory: the old lines give their units back, the new ones
 * take theirs, summed per product (the same product on two lines, or moved from one line to another, nets out).
 * Only products that really change are listed. Voiding a sale is `after = []`. One rule for the screen that
 * shows the effect and for the server that applies it. */
export function stockEffect(before: CartItem[], after: CartItem[]): StockEffect[] {
  const net = new Map<string, StockEffect>()
  const add = (items: CartItem[], sign: 1 | -1) => {
    for (const i of items) {
      if (!isTracked(i)) continue
      const e = net.get(i.code) ?? { code: i.code, name: i.name, delta: 0 }
      e.delta = round4(e.delta + sign * i.qty)
      net.set(i.code, e)
    }
  }
  add(before, 1)
  add(after, -1)
  return [...net.values()].filter((e) => e.delta !== 0)
}
