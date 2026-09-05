export interface CartItem {
  code: string
  name: string
  price: number
  cost: number
  qty: number
  brand: string
  unit: string
  /** "Producto libre" — free-form line item that never deducts stock. */
  isFree: boolean
}
