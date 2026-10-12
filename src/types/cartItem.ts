export interface CartItem {
  code: string
  name: string
  price: number
  /** Set by the server only, when it computes the sale's profit; the database moves it out of the
   * sale row (to "profits"), so a synced sale never carries it. */
  cost?: number
  qty: number
  /** Money taken off this line by hand ("descuento en dinero"), for the whole line — never more than the line is worth.
   * Part of the sale's `discount`, which is where the totals come from; this says which product it went to. */
  discount?: number
  brand: string
  unit: string
  /** A free-form line that never touches stock and has no product behind it: the `CORR` line a sale
   * correction adds, and the "producto libre" lines of sales made before that option was removed
   * from Venta (a cart can no longer create them — the server only sells inventory products). */
  isFree: boolean
}
