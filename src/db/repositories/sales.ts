import type { Sale, PayMethod, FiadoPago } from '../../types/sale'
import type { CartItem } from '../../types/cartItem'
import type { TransferAccount } from '../../shared/lib/transferAccounts'
import { apiPost, apiPut, type RequestOptions } from '../../api/client'

/** How a fiado payment is collected: cash goes to the Caja Menor, a bank transfer to the Caja Mayor. */
export type CollectMethod = 'efectivo' | 'transferencia'

export interface FinalizeSaleInput {
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  roundingAdjustment?: number
  amountReceived?: number
  changeGiven?: number
  payMethod: PayMethod
  /** For a transfer: the account it came into. */
  transferAccount?: TransferAccount | null
  customerId?: string | null
  customerName?: string | null
  fiadoName?: string | null
  notes?: string
  /** The code this sale got when it was charged (a UUID): sending it again can never save it twice. */
  clientId?: string
}

/** Insert the sale AND decrement stock atomically, in one transaction on the server
 * (server/domain/sales.ts), which re-prices the lines from the inventory, checks the permissions a
 * discount, a changed total or a fiado need, and signs the sale with whoever is signed in on this
 * device. */
export async function finalizeSale(input: FinalizeSaleInput, opts?: RequestOptions): Promise<Sale> {
  return apiPost<Sale>('/api/sales/finalize', input, opts)
}

/** The owner has read what did not add up in a sale made without internet (its `reviewNotes`). */
export async function markSaleReviewed(saleId: number): Promise<Sale> {
  return apiPost<Sale>(`/api/sales/${saleId}/review`)
}

export async function addFiadoPago(saleId: number, pago: FiadoPago): Promise<void> {
  await apiPost(`/api/sales/${saleId}/pagos`, pago)
}

export function getFiadoDebt(sale: Sale): number {
  if (sale.voided) return 0
  const paid = (sale.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  return Math.max(0, sale.total - paid)
}

/** Mark the remainder of a fiado sale as paid in one shot — legacy `pagarFiado()`.
 * `condonarFiado` uses the same mechanic with `condone = true`: the debt is closed but no money
 * enters any caja (a real payment does, in the caja matching `method`). */
export async function payFiadoInFull(saleId: number, note = 'Pago completo', condone = false, method: CollectMethod = 'efectivo', account?: TransferAccount): Promise<number> {
  const { debt } = await apiPost<{ debt: number }>(`/api/sales/${saleId}/pagar-completo`, { note, condone, method, account })
  return debt
}

/** legacy `pagarTodosLosFiados()`/`condonarTodosLosFiados()`. */
export async function payAllFiados(saleIds: number[], note: string, condone = false, method: CollectMethod = 'efectivo', account?: TransferAccount): Promise<number> {
  const { total } = await apiPost<{ total: number }>('/api/sales/pagar-todos', { saleIds, note, condone, method, account })
  return total
}

/** Post-hoc edit of an already-finalized sale — restores the original items' stock, applies
 * the new items' stock, recalculates totals (discount is kept as-is) and logs a
 * `correccion_venta` audit entry. Legacy `confirmarCorreccion()`. */
export async function correctSale(saleId: number, newItems: CartItem[], reason: string): Promise<Sale> {
  return apiPut<Sale>(`/api/sales/${saleId}/correct`, { newItems, reason })
}

/** Annuls a whole invoice: its products go back to the inventory and its money back out of the caja (server/domain/sales.ts).
 * The invoice stays in Facturas, marked as annulled. */
export async function voidSale(saleId: number, reason: string): Promise<Sale> {
  return apiPost<Sale>(`/api/sales/${saleId}/void`, { reason })
}
