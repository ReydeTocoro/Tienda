import type { CajaId } from '../../types/cash'
import type { Payable, PurchaseOrder } from '../../types/purchaseOrder'
import { apiPost, apiPut } from '../../api/client'

export interface OrderInput {
  supplierId: string
  lines: Array<{ code: string; qty: number; unitCost: number }>
  notes?: string
  /** true = save already sent to the supplier; false = keep as a draft. */
  send?: boolean
}

export interface ReceiveInput {
  lines?: Array<{ code: string; qtyReceived: number; unitCost: number }>
  payment: { mode: 'contado'; caja: CajaId } | { mode: 'credito' }
  by?: string
}

export const createOrder = (input: OrderInput): Promise<PurchaseOrder> => apiPost<PurchaseOrder>('/api/purchaseOrders', input)
export const updateOrder = (id: number, input: OrderInput): Promise<PurchaseOrder> => apiPut<PurchaseOrder>(`/api/purchaseOrders/${id}`, input)
export const sendOrder = (id: number): Promise<PurchaseOrder> => apiPost<PurchaseOrder>(`/api/purchaseOrders/${id}/send`)
export const cancelOrder = (id: number): Promise<PurchaseOrder> => apiPost<PurchaseOrder>(`/api/purchaseOrders/${id}/cancel`)
export const receiveOrder = (id: number, input: ReceiveInput): Promise<PurchaseOrder> => apiPost<PurchaseOrder>(`/api/purchaseOrders/${id}/receive`, input)

export const payPayable = (id: number, input: { amount: number; caja: CajaId; by?: string }): Promise<Payable> =>
  apiPost<Payable>(`/api/payables/${id}/pay`, input)
