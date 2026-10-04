import { db } from '../index'
import type { CartItem } from '../../types/cartItem'
import type { RouteOrder } from '../../types/routeOrder'
import { apiPost, apiPut } from '../../api/client'

export interface RouteOrderInput {
  customerId?: string | null
  customerName: string
  items: CartItem[]
  notes?: string
}

export async function listRouteOrders(): Promise<RouteOrder[]> {
  return db.routeOrders.orderBy('id').reverse().toArray()
}

export const createRouteOrder = (input: RouteOrderInput): Promise<RouteOrder> => apiPost<RouteOrder>('/api/routeOrders', input)
export const updateRouteOrder = (id: number, input: RouteOrderInput): Promise<RouteOrder> => apiPut<RouteOrder>(`/api/routeOrders/${id}`, input)
export const markRouteOrderPrepared = (id: number): Promise<RouteOrder> => apiPost<RouteOrder>(`/api/routeOrders/${id}/preparar`)
export const reopenRouteOrder = (id: number): Promise<RouteOrder> => apiPost<RouteOrder>(`/api/routeOrders/${id}/reabrir`)
export const cancelRouteOrder = (id: number): Promise<RouteOrder> => apiPost<RouteOrder>(`/api/routeOrders/${id}/cancelar`)
/** Called right after `finalizeSale()` (repositories/sales.ts) succeeds — see
 * server/domain/routeOrders.ts for why this is a separate step, not part of that transaction. */
export const deliverRouteOrder = (id: number, saleId: number): Promise<RouteOrder> => apiPost<RouteOrder>(`/api/routeOrders/${id}/entregar`, { saleId })
