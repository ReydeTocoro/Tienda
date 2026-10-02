import { Router } from 'express'
import type Database from 'better-sqlite3'
import { errorMessage, listAll } from './generic'
import { runAndBroadcast } from '../domain/tx'
import { cancelOrder, createOrder, receiveOrder, sendOrder, updateOrder, type OrderInput, type ReceiveInput } from '../domain/purchasing'
import type { PurchaseOrder } from '../../src/types/purchaseOrder'

export function purchaseOrdersRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<PurchaseOrder>(db, 'purchaseOrders'))
  })

  router.post('/', (req, res) => {
    try {
      res.status(201).json(runAndBroadcast(db, (out) => createOrder(db, out, req.body as OrderInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.put('/:id', (req, res) => {
    try {
      res.json(runAndBroadcast(db, (out) => updateOrder(db, out, Number(req.params.id), req.body as OrderInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.post('/:id/send', (req, res) => {
    try {
      res.json(runAndBroadcast(db, (out) => sendOrder(db, out, Number(req.params.id))))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.post('/:id/cancel', (req, res) => {
    try {
      res.json(runAndBroadcast(db, (out) => cancelOrder(db, out, Number(req.params.id))))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.post('/:id/receive', (req, res) => {
    try {
      res.json(runAndBroadcast(db, (out) => receiveOrder(db, out, Number(req.params.id), req.body as ReceiveInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  return router
}
