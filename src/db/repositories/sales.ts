import { db } from '../index'
import type { Sale, PayMethod, FiadoPago } from '../../types/sale'
import type { CartItem } from '../../types/cartItem'
import type { CorrectionAuditEntry, SaleSnapshot } from '../../types/auditLog'

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

/** Mark the remainder of a fiado sale as paid in one shot — legacy `pagarFiado()`
 * (index.html L4972-4983). `condonarFiado` uses the same mechanic with a different note
 * (index.html L4985-4996) — the legacy app has no separate "condoned" flag either. */
export async function payFiadoInFull(saleId: number, note = 'Pago completo'): Promise<number> {
  return db.transaction('rw', db.sales, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new Error('Venta no encontrada')
    const debt = getFiadoDebt(sale)
    if (debt <= 0) return 0
    const pagos = [...(sale.fiadoPagos || []), { amount: debt, date: new Date().toISOString(), note }]
    await db.sales.update(saleId, { fiadoPagos: pagos })
    return debt
  })
}

/** legacy `pagarTodosLosFiados()`/`condonarTodosLosFiados()` (index.html L4998-5044). */
export async function payAllFiados(saleIds: number[], note: string): Promise<number> {
  return db.transaction('rw', db.sales, async () => {
    let total = 0
    for (const id of saleIds) {
      const sale = await db.sales.get(id)
      if (!sale) continue
      const debt = getFiadoDebt(sale)
      if (debt <= 0) continue
      total += debt
      const pagos = [...(sale.fiadoPagos || []), { amount: debt, date: new Date().toISOString(), note }]
      await db.sales.update(id, { fiadoPagos: pagos })
    }
    return total
  })
}

/** Post-hoc edit of an already-finalized sale — restores the original items' stock, applies
 * the new items' stock, recalculates totals (discount is kept as-is) and logs a
 * `correccion_venta` audit entry. Legacy `confirmarCorreccion()` (index.html L6994-6073). */
export async function correctSale(saleId: number, newItems: CartItem[], reason: string): Promise<Sale> {
  return db.transaction('rw', db.sales, db.products, db.auditLog, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new Error('Venta no encontrada')

    const before: SaleSnapshot = {
      items: sale.items,
      subtotal: sale.subtotal,
      total: sale.total,
      discount: sale.discount || 0,
    }

    const isTracked = (ci: CartItem) => !ci.isFree && ci.code !== 'CORR' && !ci.code.startsWith('FREE_')

    for (const ci of sale.items) {
      if (!isTracked(ci)) continue
      const p = await db.products.get(ci.code)
      if (p) await db.products.update(ci.code, { stock: p.stock + ci.qty })
    }
    for (const ci of newItems) {
      if (!isTracked(ci)) continue
      const p = await db.products.get(ci.code)
      if (p) await db.products.update(ci.code, { stock: Math.max(0, p.stock - ci.qty) })
    }

    const newSub = newItems.reduce((s, i) => s + i.price * i.qty, 0)
    const newDisc = sale.discount || 0
    const newTotal = Math.max(0, newSub - newDisc)
    let newGanancia = 0
    for (const ci of newItems) {
      if (ci.isFree || !isTracked(ci)) {
        newGanancia += ci.price * ci.qty
        continue
      }
      const p = await db.products.get(ci.code)
      const cost = p?.cost ?? 0
      newGanancia += (ci.price - cost) * ci.qty
    }

    const after: SaleSnapshot = { items: newItems, subtotal: newSub, total: newTotal, discount: newDisc }
    const auditEntry: Omit<CorrectionAuditEntry, 'id'> = {
      type: 'correccion_venta',
      date: new Date().toISOString(),
      saleId,
      reason,
      before,
      after,
      totalDiff: newTotal - before.total,
    }
    await db.auditLog.add(auditEntry)

    const patch = {
      items: newItems,
      subtotal: newSub,
      total: newTotal,
      ganancia: newGanancia,
      corrected: true,
      correctedAt: new Date().toISOString(),
      correctionReason: reason,
    }
    await db.sales.update(saleId, patch)
    return { ...sale, ...patch }
  })
}
