import { Router } from 'express'
import type { Db } from '../db'
import { handle } from './http'
import { payPayable, type PayInput } from '../domain/purchasing'

export function payablesRouter(db: Db) {
  const router = Router()

  router.post(
    '/:id/pay',
    handle(async (req) => db.tx((q) => payPayable(q, Number(req.params.id), req.body as PayInput))),
  )

  return router
}
