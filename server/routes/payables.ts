import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { handle } from './http'
import { payPayable, type PayInput } from '../domain/purchasing'

/** Supplier debts, mounted at /api/payables — needs `proveedores.gestionar`. */
export function payablesRouter(db: Db) {
  const router = Router()

  router.post(
    '/:id/pay',
    handle(async (req) =>
      db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        const by = await requireNeed(q, actor, 'proveedores.gestionar')
        const input = (req.body ?? {}) as PayInput
        return payPayable(q, Number(req.params.id), { ...input, by: by ?? input.by }, { revealBalance: allowed(actor, 'caja.verEsperado') })
      }),
    ),
  )

  return router
}
