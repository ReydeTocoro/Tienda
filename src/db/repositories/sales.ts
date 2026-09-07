import { db } from '../index'
import type { Sale, PayMethod, FiadoPago } from '../../types/sale'
import type { CartItem } from '../../types/cartItem'
import { apiPost, apiPut } from '../../api/client'

export interface FinalizeSaleInput {
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  roundingAdjustment?: number
  amountReceived?: number
  changeGiven?: number
  payMethod: PayMethod
  customerId?: string | null
  customerName?: string | null
  fiadoName?: string | null
  notes?: string
}

/** Insert the sale AND decrement stock atomically — now a single better-sqlite3 transaction on
 * the server (server/routes/sales.ts). Free items never touch stock. */
export async function finalizeSale(input: FinalizeSaleInput): Promise<Sale> {
  return apiPost<Sale>('/api/sales/finalize', input)
}

export async function listSales(): Promise<Sale[]> {
  return db.sales.orderBy('id').reverse().toArray()
}

export async function getSale(id: number): Promise<Sale | undefined> {
  return db.sales.get(id)
}

export async function addFiadoPago(saleId: number, pago: FiadoPago): Promise<void> {
  await apiPost(`/api/sales/${saleId}/pagos`, pago)
}

export function getFiadoDebt(sale: Sale): number {
  const paid = (sale.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  return Math.max(0, sale.total - paid)
}

/** Mark the remainder of a fiado sale as paid in one shot — legacy `pagarFiado()`.
 * `condonarFiado` uses the same mechanic with a different note. */
export async function payFiadoInFull(saleId: number, note = 'Pago completo'): Promise<number> {
  const { debt } = await apiPost<{ debt: number }>(`/api/sales/${saleId}/pagar-completo`, { note })
  return debt
}

/** legacy `pagarTodosLosFiados()`/`condonarTodosLosFiados()`. */
export async function payAllFiados(saleIds: number[], note: string): Promise<number> {
  const { total } = await apiPost<{ total: number }>('/api/sales/pagar-todos', { saleIds, note })
  return total
}

/** Post-hoc edit of an already-finalized sale — restores the original items' stock, applies
 * the new items' stock, recalculates totals (discount is kept as-is) and logs a
 * `correccion_venta` audit entry. Legacy `confirmarCorreccion()`. */
export async function correctSale(saleId: number, newItems: CartItem[], reason: string): Promise<Sale> {
  return apiPut<Sale>(`/api/sales/${saleId}/correct`, { newItems, reason })
}
