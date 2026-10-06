/** Rows of the tables that hold what not everyone may see (supabase/migrations/20261005000000_permisos_servidor.sql).
 * The database only serves them to a device where someone allowed is working, and the app keeps them
 * in memory only (src/db/secure.ts) — never on the device's disk. */

/** "productCosts": a product's purchase price (`costos.ver`). */
export interface ProductCost {
  code: string
  cost: number
}

/** "profits": a sale's or a cierre's profit (`ganancias.ver`). `key` = 'sale:<id>' | 'cierre:<id>'. */
export interface Profit {
  key: string
  kind: 'sale' | 'cierre'
  refId: number
  dayKey?: string
  ganancia: number
  /** Sales only: each item's purchase price when it was sold, in the order of the sale's items. */
  itemCosts?: Array<number | null>
}

/** "cajaState": whether the Caja Menor is open — everyone may see it; it holds no amounts. */
export interface CajaState {
  key: 'menor'
  /** A caja was ever opened (the first opening is the start of the books). */
  started: boolean
  open: boolean
  sessionId?: number
  dayKey?: string
  openedAt?: string
  openedBy?: string
}
