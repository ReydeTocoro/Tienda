import type { CajaId } from './cash'
import type { PaymentTerms } from './supplier'

export type OrderStatus = 'borrador' | 'pedido' | 'recibido' | 'cancelado'

export interface OrderLine {
  code: string
  name: string
  qty: number
  unitCost: number
  /** Filled in when the order is received; may differ from `qty`. */
  qtyReceived?: number
}

export type OrderPayment = { mode: 'contado'; caja: CajaId; movementId: number } | { mode: 'credito'; payableId: number } | { mode: 'ninguno' }

export interface PurchaseOrder {
  id?: number
  supplierId: string
  /** Name at the time of the order, so lists and history survive a rename. */
  supplierName: string
  status: OrderStatus
  lines: OrderLine[]
  /** Ordered total (qty × unitCost). */
  total: number
  /** Copy of the supplier's terms when the order was created: later edits to the supplier don't change it. */
  paymentTerms: PaymentTerms
  notes?: string
  createdAt: string
  orderedAt?: string
  receivedAt?: string
  cancelledAt?: string
  /** What was actually received × the final cost — what gets paid or owed. */
  receivedTotal?: number
  receivedBy?: string
  payment?: OrderPayment
}

export interface PayablePayment {
  date: string
  amount: number
  caja: CajaId
  movementId: number
  by?: string
}

/** "Cuenta por pagar": what the shop owes a supplier for goods received on credit. */
export interface Payable {
  id?: number
  supplierId: string
  supplierName: string
  orderId: number
  amount: number
  paid: number
  issuedAt: string
  /** 'YYYY-MM-DD' — receipt day + the supplier's credit days. */
  dueDate: string
  payments: PayablePayment[]
}
