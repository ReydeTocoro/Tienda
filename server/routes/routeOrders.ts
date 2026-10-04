import { Router } from 'express'
import type { Db } from '../db'
import { handle } from './http'
import { cancelRouteOrder, createRouteOrder, deliverRouteOrder, setRouteOrderStatus, updateRouteOrder, type RouteOrderInput } from '../domain/routeOrders'

export function routeOrdersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => db.tx((q) => createRouteOrder(q, req.body as RouteOrderInput)), 201),
  )

  router.put(
    '/:id',
    handle(async (req) => db.tx((q) => updateRouteOrder(q, Number(req.params.id), req.body as RouteOrderInput))),
  )

  router.post(
    '/:id/preparar',
    handle(async (req) => db.tx((q) => setRouteOrderStatus(q, Number(req.params.id), 'preparado'))),
  )

  router.post(
    '/:id/reabrir',
    handle(async (req) => db.tx((q) => setRouteOrderStatus(q, Number(req.params.id), 'tomado'))),
  )

  router.post(
    '/:id/cancelar',
    handle(async (req) => db.tx((q) => cancelRouteOrder(q, Number(req.params.id)))),
  )

  /** Called right after the client's own `/api/sales/finalize` succeeds — see
   * server/domain/routeOrders.ts's doc comment for why this is a separate step. */
  router.post(
    '/:id/entregar',
    handle(async (req) => db.tx((q) => deliverRouteOrder(q, Number(req.params.id), Number((req.body as { saleId: number }).saleId)))),
  )

  return router
}
