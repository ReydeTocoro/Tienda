import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Sale, PayMethod, FiadoPago } from '../../src/types/sale'
import type { CartItem } from '../../src/types/cartItem'
import type { Product } from '../../src/types/product'
import type { CorrectionAuditEntry, SaleSnapshot } from '../../src/types/auditLog'
import { listAll, getRow, putRow, insertAutoRow, errorMessage, roundQty } from './generic'
import { broadcast, type BroadcastMsg } from '../broadcast'

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

export function salesRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Sale>(db, TABLE))
  })

  /** Insert the sale AND decrement stock atomically. Free items never touch stock. Legacy
   * finalizeSale() (repositories/sales.ts L23-66). */
  router.post('/finalize', (req, res) => {
    const input = req.body as FinalizeSaleInput
    try {
      const { sale, broadcasts } = db.transaction(() => {
        // Checked here (not just client-side) because this is the one place two devices selling
        // the same product at once can't race each other — better-sqlite3 transactions run fully
        // synchronously, so no other request's handler can interleave between this check and the
        // stock writes below.
        for (const item of input.items) {
          if (item.isFree) continue
          const p = getRow<Product>(db, 'products', 'code', item.code)
          if (p && item.qty > (p.stock || 0)) {
            throw new Error(`Stock insuficiente de "${p.name}" (quedan ${p.stock})`)
          }
        }

        const date = new Date().toISOString()
        const dayKey = date.slice(0, 10)

        let ganancia = 0
        for (const item of input.items) {
          if (item.isFree) {
            ganancia += item.price * item.qty
            continue
          }
          const p = getRow<Product>(db, 'products', 'code', item.code)
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
        const sale = insertAutoRow(db, TABLE, saleData)
        const broadcasts: BroadcastMsg[] = [{ table: TABLE, op: 'put', data: sale }]

        for (const item of input.items) {
          if (item.isFree) continue
          const p = getRow<Product>(db, 'products', 'code', item.code)
          if (p) {
            const u: Product = { ...p, stock: roundQty(Math.max(0, (p.stock || 0) - item.qty)) }
            putRow(db, 'products', 'code', item.code, {}, u)
            broadcasts.push({ table: 'products', op: 'put', data: u })
          }
        }

        return { sale, broadcasts }
      })()

      broadcasts.forEach(broadcast)
      res.status(201).json(sale)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** legacy pagarFiado()/condonarFiado() (repositories/sales.ts L93-103) — both use this same
   * mechanic, condoning is just a different note. */
  router.post('/:id/pagar-completo', (req, res) => {
    const saleId = Number(req.params.id)
    const note = (req.body?.note as string) || 'Pago completo'
    try {
      const { debt, sale } = db.transaction(() => {
        const s = getRow<Sale>(db, TABLE, 'id', saleId)
        if (!s) throw new Error('Venta no encontrada')
        const debt = fiadoDebt(s)
        if (debt <= 0) return { debt: 0, sale: s }
        const pagos = [...(s.fiadoPagos || []), { amount: debt, date: new Date().toISOString(), note }]
        const u: Sale = { ...s, fiadoPagos: pagos }
        putRow(db, TABLE, 'id', saleId, {}, u)
        return { debt, sale: u }
      })()
      if (debt > 0) broadcast({ table: TABLE, op: 'put', data: sale })
      res.json({ debt })
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** legacy pagarTodosLosFiados()/condonarTodosLosFiados() (repositories/sales.ts L106-120). */
  router.post('/pagar-todos', (req, res) => {
    const { saleIds, note } = req.body as { saleIds: number[]; note: string }
    const { total, broadcasts } = db.transaction(() => {
      let total = 0
      const broadcasts: BroadcastMsg[] = []
      for (const id of saleIds) {
        const s = getRow<Sale>(db, TABLE, 'id', id)
        if (!s) continue
        const debt = fiadoDebt(s)
        if (debt <= 0) continue
        total += debt
        const pagos = [...(s.fiadoPagos || []), { amount: debt, date: new Date().toISOString(), note }]
        const u: Sale = { ...s, fiadoPagos: pagos }
        putRow(db, TABLE, 'id', id, {}, u)
        broadcasts.push({ table: TABLE, op: 'put', data: u })
      }
      return { total, broadcasts }
    })()
    broadcasts.forEach(broadcast)
    res.json({ total })
  })

  router.post('/:id/pagos', (req, res) => {
    const saleId = Number(req.params.id)
    const pago = req.body as FiadoPago
    try {
      const updated = db.transaction(() => {
        const s = getRow<Sale>(db, TABLE, 'id', saleId)
        if (!s) throw new Error('Venta no encontrada')
        const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
        putRow(db, TABLE, 'id', saleId, {}, u)
        return u
      })()
      broadcast({ table: TABLE, op: 'put', data: updated })
      res.status(201).json(updated)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** Post-hoc edit of an already-finalized sale — restores the original items' stock, applies
   * the new items' stock, recalculates totals and logs a correccion_venta audit entry. Legacy
   * confirmarCorreccion() (repositories/sales.ts L125-188). */
  router.put('/:id/correct', (req, res) => {
    const saleId = Number(req.params.id)
    const { newItems, reason } = req.body as { newItems: CartItem[]; reason: string }
    try {
      const { sale, broadcasts } = db.transaction(() => {
        const s = getRow<Sale>(db, TABLE, 'id', saleId)
        if (!s) throw new Error('Venta no encontrada')

        const before: SaleSnapshot = { items: s.items, subtotal: s.subtotal, total: s.total, discount: s.discount || 0 }
        const isTracked = (ci: CartItem) => !ci.isFree && ci.code !== 'CORR' && !ci.code.startsWith('FREE_')
        const broadcasts: BroadcastMsg[] = []

        for (const ci of s.items) {
          if (!isTracked(ci)) continue
          const p = getRow<Product>(db, 'products', 'code', ci.code)
          if (p) {
            const u: Product = { ...p, stock: roundQty(p.stock + ci.qty) }
            putRow(db, 'products', 'code', ci.code, {}, u)
            broadcasts.push({ table: 'products', op: 'put', data: u })
          }
        }
        for (const ci of newItems) {
          if (!isTracked(ci)) continue
          const p = getRow<Product>(db, 'products', 'code', ci.code)
          if (p) {
            const u: Product = { ...p, stock: roundQty(Math.max(0, p.stock - ci.qty)) }
            putRow(db, 'products', 'code', ci.code, {}, u)
            broadcasts.push({ table: 'products', op: 'put', data: u })
          }
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
          const p = getRow<Product>(db, 'products', 'code', ci.code)
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
        const savedEntry = insertAutoRow(db, 'auditLog', auditEntry)
        broadcasts.push({ table: 'auditLog', op: 'put', data: savedEntry })

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
        putRow(db, TABLE, 'id', saleId, {}, updatedSale)
        broadcasts.push({ table: TABLE, op: 'put', data: updatedSale })

        return { sale: updatedSale, broadcasts }
      })()

      broadcasts.forEach(broadcast)
      res.json(sale)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  return router
}
