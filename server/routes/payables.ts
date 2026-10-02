import { Router } from 'express'
import type Database from 'better-sqlite3'
import { errorMessage, listAll } from './generic'
import { runAndBroadcast } from '../domain/tx'
import { payPayable, type PayInput } from '../domain/purchasing'
import type { Payable } from '../../src/types/purchaseOrder'

export function payablesRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Payable>(db, 'payables'))
  })

  router.post('/:id/pay', (req, res) => {
    try {
      res.json(runAndBroadcast(db, (out) => payPayable(db, out, Number(req.params.id), req.body as PayInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  return router
}
