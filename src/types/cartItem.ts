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
  /** A free-form line that never touches stock and has no product behind it: a "producto sin registrar"
   * typed at the till (code `FREE_…`, name and price as typed; needs `ventas.productoLibre`) and the `CORR`
   * line of old sale corrections. The server decides it from the code, never from this flag. */
  isFree: boolean
}
