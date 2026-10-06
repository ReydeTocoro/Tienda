export interface CartItem {
  code: string
  name: string
  price: number
  /** Set by the server only, when it computes the sale's profit; the database moves it out of the
   * sale row (to "profits"), so a synced sale never carries it. */
  cost?: number
  qty: number
  brand: string
  unit: string
  /** "Producto libre" — free-form line item that never deducts stock. */
  isFree: boolean
}
