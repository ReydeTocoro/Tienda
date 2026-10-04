import type { CartItem } from '../../src/types/cartItem'
import type { RouteOrder, RouteOrderStatus } from '../../src/types/routeOrder'
import { round2 } from '../../src/shared/lib/cash'
import type { Sql } from '../db'
import { getRow, insertAutoRow, putRow, roundQty } from '../routes/generic'

/** Rutas: pedidos taken at each business on a delivery round, prepared back at the shop, then
 * delivered and charged. Unlike every other domain module here, this one touches NO money and NO
 * stock — it is a notepad (same contract as a draft `PurchaseOrder`, which also doesn't touch
 * stock until received). Delivering a pedido is a client-side two-step, not one transaction:
 * `POST /api/sales/finalize` (unchanged, the proven money-critical path: stock check, cash
 * ledger, fiado tracking) runs first, and only on its success does `deliverRouteOrder` below link
 * the resulting `saleId` — so a failure here can never lose or duplicate a sale, at worst a
 * delivered pedido needs a manual nudge back to the right status. */

const TABLE = 'routeOrders'

export interface RouteOrderInput {
  customerId?: string
  customerName: string
  items: CartItem[]
  notes?: string
}

function buildItems(items: unknown): CartItem[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Agrega al menos un producto al pedido')
  return items.map((raw) => {
    const i = raw as Partial<CartItem>
    const qty = roundQty(Number(i.qty))
    const price = round2(Number(i.price))
    const name = typeof i.name === 'string' ? i.name : ''
    if (!(qty > 0)) throw new Error(`Indica la cantidad de "${name}"`)
    if (!Number.isFinite(price) || price < 0) throw new Error(`El precio de "${name}" no es válido`)
    return {
      code: String(i.code ?? ''),
      name,
      price,
      cost: Number(i.cost) || 0,
      qty,
      brand: typeof i.brand === 'string' ? i.brand : '',
      unit: typeof i.unit === 'string' && i.unit ? i.unit : 'unidad',
      isFree: !!i.isFree,
    }
  })
}

const orderTotal = (items: CartItem[]) => round2(items.reduce((t, i) => t + i.qty * i.price, 0))

async function getOrder(sql: Sql, id: number): Promise<RouteOrder & { id: number }> {
  const o = await getRow<RouteOrder & { id: number }>(sql, TABLE, 'id', id)
  if (!o) throw new Error('Pedido no encontrado')
  return o
}

async function saveOrder(sql: Sql, o: RouteOrder & { id: number }): Promise<RouteOrder> {
  await putRow(sql, TABLE, 'id', o.id, o)
  return o
}

/** Still editable once taken ('tomado') or packed ('preparado') — only 'entregado'/'cancelado' lock it. */
function assertEditable(o: RouteOrder): void {
  if (o.status !== 'tomado' && o.status !== 'preparado') {
    throw new Error(o.status === 'entregado' ? 'Este pedido ya fue entregado' : 'Este pedido está cancelado')
  }
}

export async function createRouteOrder(sql: Sql, input: RouteOrderInput): Promise<RouteOrder> {
  const customerName = (input.customerName || '').trim()
  if (!customerName) throw new Error('Escribe el nombre del negocio o cliente')
  const items = buildItems(input.items)
  const base: Omit<RouteOrder, 'id'> = {
    customerId: input.customerId || undefined,
    customerName,
    status: 'tomado',
    items,
    total: orderTotal(items),
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
  return insertAutoRow(sql, TABLE, base)
}

export async function updateRouteOrder(sql: Sql, id: number, input: RouteOrderInput): Promise<RouteOrder> {
  const o = await getOrder(sql, id)
  assertEditable(o)
  const customerName = (input.customerName || '').trim()
  if (!customerName) throw new Error('Escribe el nombre del negocio o cliente')
  const items = buildItems(input.items)
  return saveOrder(sql, { ...o, customerId: input.customerId || undefined, customerName, items, total: orderTotal(items), notes: input.notes?.trim() || undefined })
}

/** 'tomado' ⇄ 'preparado' — a plain checklist flag, not a stock operation. */
export async function setRouteOrderStatus(sql: Sql, id: number, status: Extract<RouteOrderStatus, 'tomado' | 'preparado'>): Promise<RouteOrder> {
  const o = await getOrder(sql, id)
  assertEditable(o)
  return saveOrder(sql, { ...o, status, preparedAt: status === 'preparado' ? new Date().toISOString() : undefined })
}

export async function cancelRouteOrder(sql: Sql, id: number): Promise<RouteOrder> {
  const o = await getOrder(sql, id)
  if (o.status === 'entregado') throw new Error('Un pedido ya entregado no se puede cancelar')
  if (o.status === 'cancelado') throw new Error('El pedido ya está cancelado')
  return saveOrder(sql, { ...o, status: 'cancelado', cancelledAt: new Date().toISOString() })
}

/** Links this pedido to the Sale it became — called right after `/api/sales/finalize` succeeds
 * client-side (see the module doc comment for why this isn't one transaction with the sale). */
export async function deliverRouteOrder(sql: Sql, id: number, saleId: number): Promise<RouteOrder> {
  const o = await getOrder(sql, id)
  if (o.status === 'entregado') throw new Error('Este pedido ya fue entregado')
  if (o.status === 'cancelado') throw new Error('Este pedido está cancelado')
  if (!Number.isFinite(saleId) || saleId <= 0) throw new Error('saleId inválido')
  return saveOrder(sql, { ...o, status: 'entregado', deliveredAt: new Date().toISOString(), saleId })
}
