import type { CartItem } from './cartItem'

/** `tomado` — taken at the business, nothing packed yet. `preparado` — picked/packed back at the
 * shop, ready to go out. `entregado` — delivered and charged (became the `sales` row `saleId`
 * points at). `cancelado` — the business backed out before delivery. */
export type RouteOrderStatus = 'tomado' | 'preparado' | 'entregado' | 'cancelado'

/** A "pedido" taken on a delivery round ("recorrido"): visit a business, write down what they
 * want, go back to the shop and pack it, then deliver and charge — replacing paper and pencil.
 * Stock is untouched until delivery, same as a draft `PurchaseOrder` doesn't touch it until
 * received: this is a notepad, not a reservation. Delivering reuses the exact same `sales`
 * finalize path as a normal checkout (full/partial/fiado payment, stock, cash ledger, fiado
 * tracking) — `saleId` is the only link between the two. */
export interface RouteOrder {
  id?: number
  customerId?: string
  /** The business/customer name — always set (free text when not a registered customer, same
   * pattern as Sale.fiadoName for a walk-in fiado customer). */
  customerName: string
  status: RouteOrderStatus
  items: CartItem[]
  /** Sum of items (price × qty) — kept alongside `items` so lists don't re-derive it every render. */
  total: number
  notes?: string
  createdAt: string
  preparedAt?: string
  deliveredAt?: string
  cancelledAt?: string
  /** Set once "Entregar y cobrar" finalizes the Sale this pedido became. */
  saleId?: number
}
