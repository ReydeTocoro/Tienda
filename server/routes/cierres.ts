import { Router } from 'express'
import type { Db } from '../db'
import { handle } from './http'
import { confirmCierre, type ConfirmCierreInput } from '../domain/cierre'

export function cierresRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => db.tx((q) => confirmCierre(q, req.body as ConfirmCierreInput)), 201),
  )

  return router
}
