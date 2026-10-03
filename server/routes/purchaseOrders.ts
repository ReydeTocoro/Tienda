import { Router } from 'express'
import type { Db } from '../db'
import { handle } from './http'
import { cancelOrder, createOrder, receiveOrder, sendOrder, updateOrder, type OrderInput, type ReceiveInput } from '../domain/purchasing'

export function purchaseOrdersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => db.tx((q) => createOrder(q, req.body as OrderInput)), 201),
  )

  router.put(
    '/:id',
    handle(async (req) => db.tx((q) => updateOrder(q, Number(req.params.id), req.body as OrderInput))),
  )

  router.post(
    '/:id/send',
    handle(async (req) => db.tx((q) => sendOrder(q, Number(req.params.id)))),
  )

  router.post(
    '/:id/cancel',
    handle(async (req) => db.tx((q) => cancelOrder(q, Number(req.params.id)))),
  )

  router.post(
    '/:id/receive',
    handle(async (req) => db.tx((q) => receiveOrder(q, Number(req.params.id), req.body as ReceiveInput))),
  )

  return router
}
