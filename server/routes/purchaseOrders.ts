import { Router, type Request } from 'express'
import type { Db, Sql } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { handle } from './http'
import { cancelOrder, createOrder, receiveOrder, sendOrder, updateOrder, type OrderInput, type ReceiveInput } from '../domain/purchasing'

/** Whoever is working, once they may manage purchasing — with the name to sign it with. */
async function buyer(q: Sql, req: Request) {
  const actor = await actorOf(q, authOf(req))
  const by = await requireNeed(q, actor, 'proveedores.gestionar')
  return { actor, by }
}

/** Purchase orders, mounted at /api/purchaseOrders — needs `proveedores.gestionar`. */
export function purchaseOrdersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(
      async (req) =>
        db.tx(async (q) => {
          await buyer(q, req)
          return createOrder(q, req.body as OrderInput)
        }),
      201,
    ),
  )

  router.put(
    '/:id',
    handle(async (req) =>
      db.tx(async (q) => {
        await buyer(q, req)
        return updateOrder(q, Number(req.params.id), req.body as OrderInput)
      }),
    ),
  )

  router.post(
    '/:id/send',
    handle(async (req) =>
      db.tx(async (q) => {
        await buyer(q, req)
        return sendOrder(q, Number(req.params.id))
      }),
    ),
  )

  router.post(
    '/:id/cancel',
    handle(async (req) =>
      db.tx(async (q) => {
        await buyer(q, req)
        return cancelOrder(q, Number(req.params.id))
      }),
    ),
  )

  router.post(
    '/:id/receive',
    handle(async (req) =>
      db.tx(async (q) => {
        const { actor, by } = await buyer(q, req)
        const input = (req.body ?? {}) as ReceiveInput
        return receiveOrder(q, Number(req.params.id), { ...input, by: by ?? input.by }, { revealBalance: allowed(actor, 'caja.verEsperado') })
      }),
    ),
  )

  return router
}
