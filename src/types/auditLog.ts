import type { CartItem } from './cartItem'

interface AuditLogBase {
  id?: number
  date: string
}

/** Stock-quantity changes: bulk import dedup, cyclic count adjustment, or shrinkage ("merma"). */
export interface StockAuditEntry extends AuditLogBase {
  type: 'importacion' | 'ajuste' | 'merma'
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

export type AuditLogEntry = StockAuditEntry | CorrectionAuditEntry | CodeChangeAuditEntry
