import { db } from '../index'
import type { Sale, PayMethod, FiadoPago } from '../../types/sale'
import type { CartItem } from '../../types/cartItem'

export interface FinalizeSaleInput {
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  payMethod: PayMethod
  customerId?: string | null
  customerName?: string | null
  fiadoName?: string | null
  notes?: string
}

/** Insert the sale AND decrement stock atomically — a single Dexie transaction, replacing the
 * two unguarded steps in the legacy app (index.html L3396-3403). Free items never touch stock. */
export async function finalizeSale(input: FinalizeSaleInput): Promise<Sale> {
  const date = new Date().toISOString()
  const dayKey = date.slice(0, 10)

  return db.transaction('rw', db.sales, db.products, async () => {
    let ganancia = 0
    for (const item of input.items) {
      if (item.isFree) {
        ganancia += item.price * item.qty
        continue
      }
      const p = await db.products.get(item.code)
      const cost = p?.cost ?? item.cost ?? 0
      ganancia += (item.price - cost) * item.qty
    }

    const sale: Sale = {
      items: input.items,
      subtotal: input.subtotal,
      discount: input.discount,
      total: input.total,
      ganancia,
      payMethod: input.payMethod,
      customerId: input.customerId ?? undefined,
      customerName: input.customerName ?? undefined,
      fiadoName: input.fiadoName ?? undefined,
      date,
      dayKey,
      notes: input.notes,
    }
    const id = await db.sales.add(sale)

    for (const item of input.items) {
      if (item.isFree) continue
      const p = await db.products.get(item.code)
      if (p) await db.products.update(item.code, { stock: Math.max(0, (p.stock || 0) - item.qty) })
    }

    return { ...sale, id }
  })
}

export async function listSales(): Promise<Sale[]> {
  return db.sales.orderBy('id').reverse().toArray()
}

export async function getSale(id: number): Promise<Sale | undefined> {
  return db.sales.get(id)
}

export async function addFiadoPago(saleId: number, pago: FiadoPago): Promise<void> {
  await db.transaction('rw', db.sales, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new Error('Venta no encontrada')
    const pagos = [...(sale.fiadoPagos || []), pago]
    await db.sales.update(saleId, { fiadoPagos: pagos })
  })
}

export function getFiadoDebt(sale: Sale): number {
  const paid = (sale.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  return Math.max(0, sale.total - paid)
}
