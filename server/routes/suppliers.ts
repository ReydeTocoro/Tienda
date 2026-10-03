import { Router } from 'express'
import type { Db } from '../db'
import { handle } from './http'
import { createSupplier, deleteSupplier, updateSupplier, type SupplierInput } from '../domain/purchasing'

export function suppliersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => db.tx((q) => createSupplier(q, req.body as SupplierInput)), 201),
  )

  router.put(
    '/:id',
    handle(async (req) => db.tx((q) => updateSupplier(q, req.params.id, req.body as SupplierInput))),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx((q) => deleteSupplier(q, req.params.id))
    }),
  )

  return router
}
