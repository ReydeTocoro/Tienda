import type { CartItem } from './cartItem'

/** The kinds of stock movement (`StockAuditEntry`); only these are deleted after `STOCK_AUDIT_DAYS`. */
export const STOCK_AUDIT_TYPES = ['importacion', 'ajuste', 'merma', 'entrada', 'paquete', 'nuevo', 'eliminado'] as const

/** Days of stock movements kept, today included (the store's days): older ones are deleted. Invoice corrections,
 * annulments and code changes are kept — Facturas' «Correcciones y anulaciones» lists all of them (Stock → Auditoría, only the days it shows). */
export const STOCK_AUDIT_DAYS = 3

interface AuditLogBase {
  id?: number
  date: string
}

/** A change of a product's stock outside a sale (sales are in Facturas): a manual adjustment up ("ajuste") or down
 * ("merma") — the quick buttons, the product form, the cyclic count —, goods that arrived ("entrada": stock-in, a
 * received purchase order), a package opened or sold from Stock ("paquete"), an import, a product created with stock
 * ("nuevo") or deleted with stock ("eliminado"). Always with who did it and why. */
export interface StockAuditEntry extends AuditLogBase {
  type: (typeof STOCK_AUDIT_TYPES)[number]
  code: string
  name: string
  before: number
  after: number
  diff: number
  reason: string
  user: string
}

export interface SaleSnapshot {
  items: CartItem[]
  subtotal: number
  total: number
  discount: number
}

/** Post-hoc edit of an already-finalized sale. */
export interface CorrectionAuditEntry extends AuditLogBase {
  type: 'correccion_venta'
  saleId: number
  reason: string
  before: SaleSnapshot
  after: SaleSnapshot
  totalDiff: number
  /** Who made the correction (absent on the ones from before it was recorded). */
  user?: string
}

/** An invoice was annulled as a whole: `before` is what it said, and all of it went back to the inventory. */
export interface VoidAuditEntry extends AuditLogBase {
  type: 'anulacion_venta'
  saleId: number
  reason: string
  before: SaleSnapshot
  user: string
}

/** A product's code was changed: its sales and the purchase orders still open moved to the new code. */
export interface CodeChangeAuditEntry extends AuditLogBase {
  type: 'cambio_codigo'
  oldCode: string
  /** The new code. */
  code: string
  name: string
  user: string
  /** How many sales and open orders were moved. */
  ventas: number
  pedidos: number
}

export type AuditLogEntry = StockAuditEntry | CorrectionAuditEntry | VoidAuditEntry | CodeChangeAuditEntry
