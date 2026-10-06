import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { handle } from './http'
import { createSupplier, deleteSupplier, updateSupplier, type SupplierInput } from '../domain/purchasing'

/** Suppliers, mounted at /api/suppliers — needs `proveedores.gestionar`. */
export function suppliersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(
      async (req) =>
        db.tx(async (q) => {
          await requireNeed(q, await actorOf(q, authOf(req)), 'proveedores.gestionar')
          return createSupplier(q, req.body as SupplierInput)
        }),
      201,
    ),
  )

  router.put(
    '/:id',
    handle(async (req) =>
      db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'proveedores.gestionar')
        return updateSupplier(q, req.params.id, req.body as SupplierInput)
      }),
    ),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'proveedores.gestionar')
        await deleteSupplier(q, req.params.id)
      })
    }),
  )

  return router
}
