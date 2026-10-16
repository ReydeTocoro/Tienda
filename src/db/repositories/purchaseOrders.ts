import type { CajaId } from '../../types/cash'
import type { Payable, PurchaseOrder } from '../../types/purchaseOrder'
import { apiPost, apiPut } from '../../api/client'

export interface OrderInput {
  supplierId: string
  /** `salePrice`: the selling price to set when it arrives (only when it changes the product's). */
  lines: Array<{ code: string; qty: number; unitCost: number; salePrice?: number }>
  notes?: string
  /** true = save already sent to the supplier; false = keep as a draft. */
  send?: boolean
}

export interface ReceiveInput {
  /** `salePrice`: the selling price from now on (null = keep the product's). */
  lines?: Array<{ code: string; qtyReceived: number; unitCost: number; salePrice?: number | null }>
  payment: { mode: 'contado'; caja: CajaId } | { mode: 'credito' }
  /** 'YYYY-MM-DD' the supplier invoiced it (the credit days count from it) and, on credit, the day it is due. */
  invoiceDate?: string
  dueDate?: string
  by?: string
}

export const createOrder = (input: OrderInput): Promise<PurchaseOrder> => apiPost<PurchaseOrder>('/api/purchaseOrders', input)
export const updateOrder = (id: number, input: OrderInput): Promise<PurchaseOrder> => apiPut<PurchaseOrder>(`/api/purchaseOrders/${id}`, input)
export const sendOrder = (id: number): Promise<PurchaseOrder> => apiPost<PurchaseOrder>(`/api/purchaseOrders/${id}/send`)
export const cancelOrder = (id: number): Promise<PurchaseOrder> => apiPost<PurchaseOrder>(`/api/purchaseOrders/${id}/cancel`)
export const receiveOrder = (id: number, input: ReceiveInput): Promise<PurchaseOrder> => apiPost<PurchaseOrder>(`/api/purchaseOrders/${id}/receive`, input)

export const payPayable = (id: number, input: { amount: number; caja: CajaId; by?: string }): Promise<Payable> =>
  apiPost<Payable>(`/api/payables/${id}/pay`, input)
