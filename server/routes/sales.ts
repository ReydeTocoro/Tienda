import { Router } from 'express'
import type { FiadoPago } from '../../src/types/sale'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf } from '../domain/counter'
import { ingestOfflineSale } from '../domain/offlineSales'
import { addFiadoPago, assertSaleId, correctSale, finalizeSale, markReviewed, settleFiados, voidSale, type FinalizeSaleInput } from '../domain/sales'
import { handle } from './http'

/** Sales and fiados, mounted at /api/sales. The rules — prices, permissions, profit — are in
 * server/domain/sales.ts. */
export function salesRouter(db: Db) {
  const router = Router()

  router.post(
    '/finalize',
    handle(async (req) => db.tx(async (q) => finalizeSale(q, await actorOf(q, authOf(req)), req.body as FinalizeSaleInput)), 201),
  )

  /** A sale a device made without internet and sends now: it is saved whatever it holds (the goods already
   * left), the oddities go into its `reviewNotes`, and sending it twice saves it once. */
  router.post(
    '/offline',
    handle(async (req) => db.tx(async (q) => ingestOfflineSale(q, await actorOf(q, authOf(req)), req.body)), 201),
  )

  /** Marks the oddities of an offline sale as read. */
  router.post(
    '/:id/review',
    handle(async (req) => {
      const saleId = assertSaleId(req.params.id)
      return db.tx(async (q) => markReviewed(q, await actorOf(q, authOf(req)), saleId))
    }),
  )

  /** Pays — or, with `condone`, forgives — the rest of one fiado. */
  router.post(
    '/:id/pagar-completo',
    handle(async (req) => {
      const saleId = assertSaleId(req.params.id)
      const { note, condone, method, account } = (req.body ?? {}) as { note?: string; condone?: boolean; method?: string; account?: unknown }
      return db.tx(async (q) => ({ debt: await settleFiados(q, await actorOf(q, authOf(req)), [saleId], note || 'Pago completo', condone === true, method, true, account) }))
    }),
  )

  router.post(
    '/pagar-todos',
    handle(async (req) => {
      const { saleIds, note, condone, method, account } = (req.body ?? {}) as { saleIds: number[]; note: string; condone?: boolean; method?: string; account?: unknown }
      return db.tx(async (q) => ({ total: await settleFiados(q, await actorOf(q, authOf(req)), saleIds, note, condone === true, method, false, account) }))
    }),
  )

  router.post(
    '/:id/pagos',
    handle(async (req) => {
      const saleId = assertSaleId(req.params.id)
      return db.tx(async (q) => addFiadoPago(q, await actorOf(q, authOf(req)), saleId, req.body as Partial<FiadoPago>))
    }, 201),
  )

  router.put(
    '/:id/correct',
    handle(async (req) => {
      const saleId = assertSaleId(req.params.id)
      const { newItems, reason } = (req.body ?? {}) as { newItems: unknown; reason: unknown }
      return db.tx(async (q) => correctSale(q, await actorOf(q, authOf(req)), saleId, newItems, reason))
    }),
  )

  /** Annuls the invoice: stock back on the shelf, money back out of the caja, the row kept as history. */
  router.post(
    '/:id/void',
    handle(async (req) => {
      const saleId = assertSaleId(req.params.id)
      const { reason } = (req.body ?? {}) as { reason: unknown }
      return db.tx(async (q) => voidSale(q, await actorOf(q, authOf(req)), saleId, reason))
    }),
  )

  return router
}
