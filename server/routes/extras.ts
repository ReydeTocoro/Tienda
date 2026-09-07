import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Extra, ExtraType } from '../../src/types/extra'
import { listAll, insertAutoRow } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'extras'

export function extrasRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Extra>(db, TABLE))
  })

  router.post('/', (req, res) => {
    const { desc, amount, type } = req.body as { desc: string; amount: number; type: ExtraType }
    const date = new Date().toISOString()
    const extra: Extra = { desc, amount, type, date, dayKey: date.slice(0, 10) }
    const saved = insertAutoRow(db, TABLE, extra)
    broadcast({ table: TABLE, op: 'put', data: saved })
    res.status(201).json(saved)
  })

  return router
}
