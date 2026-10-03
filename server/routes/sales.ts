import { Router } from 'express'
import type { Sale, PayMethod, FiadoPago } from '../../src/types/sale'
import type { CartItem } from '../../src/types/cartItem'
import type { Product } from '../../src/types/product'
import type { CorrectionAuditEntry, SaleSnapshot } from '../../src/types/auditLog'
import type { Db } from '../db'
import { getRow, putRow, insertAutoRow, roundQty } from './generic'
import { handle } from './http'
import { recordFiadoCollection, recordSaleCorrection, recordSaleReceipt, type CollectMethod } from '../domain/cash'
import { dayKeyOf } from '../../src/shared/lib/currency'

const TABLE = 'sales'

interface FinalizeSaleInput {
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

function fiadoDebt(sale: Sale): number {
  const paid = (sale.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  return Math.max(0, sale.total - paid)
}

export function salesRouter(db: Db) {
  const router = Router()

  /** Insert the sale AND decrement stock atomically. Free items never touch stock. Legacy
   * finalizeSale() (repositories/sales.ts L23-66). */
  router.post(
    '/finalize',
    handle(async (req) => {
      const input = req.body as FinalizeSaleInput
      return db.tx(async (q) => {
        // Checked here (not just client-side) because this is the one place two devices selling
        // the same product at once can't race each other: db.tx serializes writes, so no other
        // sale can slip in between this check and the stock writes below.
        for (const item of input.items) {
          if (item.isFree) continue
          const p = await getRow<Product>(q, 'products', 'code', item.code)
          if (p && item.qty > (p.stock || 0)) {
            throw new Error(`Stock insuficiente de "${p.name}" (quedan ${p.stock})`)
          }
        }

        const date = new Date().toISOString()
        const dayKey = dayKeyOf(date)

        let ganancia = 0
        for (const item of input.items) {
          if (item.isFree) {
            ganancia += item.price * item.qty
            continue
          }
          const p = await getRow<Product>(q, 'products', 'code', item.code)
          const cost = p?.cost ?? item.cost ?? 0
          ganancia += (item.price - cost) * item.qty
        }

        const saleData: Sale = {
          items: input.items,
          subtotal: input.subtotal,
          discount: input.discount,
          total: input.total,
          roundingAdjustment: input.roundingAdjustment,
          amountReceived: input.amountReceived,
          changeGiven: input.changeGiven,
          ganancia,
          payMethod: input.payMethod,
          customerId: input.customerId ?? undefined,
          customerName: input.customerName ?? undefined,
          fiadoName: input.fiadoName ?? undefined,
          date,
          dayKey,
          notes: input.notes,
        }
        const sale = await insertAutoRow(q, TABLE, saleData)
        await recordSaleReceipt(q, sale)

        for (const item of input.items) {
          if (item.isFree) continue
          const p = await getRow<Product>(q, 'products', 'code', item.code)
          if (p) await putRow(q, 'products', 'code', item.code, { ...p, stock: roundQty(Math.max(0, (p.stock || 0) - item.qty)) })
        }

        return sale
      })
    }, 201),
  )

  /** legacy pagarFiado()/condonarFiado() (repositories/sales.ts L93-103) — both use this same
   * mechanic; `condone` marks the forgiven case, which closes the debt without any cash coming in.
   * A real payment is cash into the Caja Menor. */
  router.post(
    '/:id/pagar-completo',
    handle(async (req) => {
      const saleId = Number(req.params.id)
      const note = (req.body?.note as string) || 'Pago completo'
      const condone = req.body?.condone === true
      const method: CollectMethod = req.body?.method === 'transferencia' ? 'transferencia' : 'efectivo'
      return db.tx(async (q) => {
        const s = await getRow<Sale>(q, TABLE, 'id', saleId)
        if (!s) throw new Error('Venta no encontrada')
        const debt = fiadoDebt(s)
        if (debt <= 0) return { debt: 0 }
        const pago: FiadoPago = { amount: debt, date: new Date().toISOString(), note, ...(condone ? { condonado: true } : { method }) }
        const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
        await putRow(q, TABLE, 'id', saleId, u)
        if (!condone) await recordFiadoCollection(q, { ...u, id: saleId }, debt, method)
        return { debt }
      })
    }),
  )

  /** legacy pagarTodosLosFiados()/condonarTodosLosFiados() (repositories/sales.ts L106-120). */
  router.post(
    '/pagar-todos',
    handle(async (req) => {
      const { saleIds, note, condone, method: rawMethod } = req.body as { saleIds: number[]; note: string; condone?: boolean; method?: CollectMethod }
      const method: CollectMethod = rawMethod === 'transferencia' ? 'transferencia' : 'efectivo'
      return db.tx(async (q) => {
        let total = 0
        for (const id of saleIds) {
          const s = await getRow<Sale>(q, TABLE, 'id', id)
          if (!s) continue
          const debt = fiadoDebt(s)
          if (debt <= 0) continue
          total += debt
          const pago: FiadoPago = { amount: debt, date: new Date().toISOString(), note, ...(condone === true ? { condonado: true } : { method }) }
          const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
          await putRow(q, TABLE, 'id', id, u)
          if (condone !== true) await recordFiadoCollection(q, { ...u, id }, debt, method)
        }
        return { total }
      })
    }),
  )

  router.post(
    '/:id/pagos',
    handle(async (req) => {
      const saleId = Number(req.params.id)
      const pago = req.body as FiadoPago
      return db.tx(async (q) => {
        const s = await getRow<Sale>(q, TABLE, 'id', saleId)
        if (!s) throw new Error('Venta no encontrada')
        const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
        await putRow(q, TABLE, 'id', saleId, u)
        if (!pago.condonado) await recordFiadoCollection(q, { ...u, id: saleId }, pago.amount, pago.method === 'transferencia' ? 'transferencia' : 'efectivo')
        return u
      })
    }, 201),
  )

  /** Post-hoc edit of an already-finalized sale — restores the original items' stock, applies
   * the new items' stock, recalculates totals and logs a correccion_venta audit entry. Legacy
   * confirmarCorreccion() (repositories/sales.ts L125-188). */
  router.put(
    '/:id/correct',
    handle(async (req) => {
      const saleId = Number(req.params.id)
      const { newItems, reason } = req.body as { newItems: CartItem[]; reason: string }
      return db.tx(async (q) => {
        const s = await getRow<Sale>(q, TABLE, 'id', saleId)
        if (!s) throw new Error('Venta no encontrada')

        const before: SaleSnapshot = { items: s.items, subtotal: s.subtotal, total: s.total, discount: s.discount || 0 }
        const isTracked = (ci: CartItem) => !ci.isFree && ci.code !== 'CORR' && !ci.code.startsWith('FREE_')

        for (const ci of s.items) {
          if (!isTracked(ci)) continue
          const p = await getRow<Product>(q, 'products', 'code', ci.code)
          if (p) await putRow(q, 'products', 'code', ci.code, { ...p, stock: roundQty(p.stock + ci.qty) })
        }
        for (const ci of newItems) {
          if (!isTracked(ci)) continue
          const p = await getRow<Product>(q, 'products', 'code', ci.code)
          if (p) await putRow(q, 'products', 'code', ci.code, { ...p, stock: roundQty(Math.max(0, p.stock - ci.qty)) })
        }

        const newSub = newItems.reduce((sum, i) => sum + i.price * i.qty, 0)
        const newDisc = s.discount || 0
        const newTotal = Math.max(0, newSub - newDisc)
        let newGanancia = 0
        for (const ci of newItems) {
          if (ci.isFree || !isTracked(ci)) {
            newGanancia += ci.price * ci.qty
            continue
          }
          const p = await getRow<Product>(q, 'products', 'code', ci.code)
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
        await insertAutoRow(q, 'auditLog', auditEntry)

        const patch = {
          items: newItems,
          subtotal: newSub,
          total: newTotal,
          ganancia: newGanancia,
          corrected: true,
          correctedAt: new Date().toISOString(),
          correctionReason: reason,
        }
        const updatedSale: Sale = { ...s, ...patch }
        await putRow(q, TABLE, 'id', saleId, updatedSale)
        await recordSaleCorrection(q, { ...updatedSale, id: saleId }, newTotal - before.total)
        return updatedSale
      })
    }),
  )

  return router
}
