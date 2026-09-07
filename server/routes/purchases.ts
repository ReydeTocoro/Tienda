import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Purchase } from '../../src/types/purchase'
import { listAll, insertAutoRow } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'purchases'

interface SavePurchaseInput {
  desc: string
  total: number
  provider?: string
}

/** legacy savePurchase() (repositories/purchases.ts L10-22). */
export function purchasesRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Purchase>(db, TABLE))
  })

  router.post('/', (req, res) => {
    const input = req.body as SavePurchaseInput
    const date = new Date().toISOString()
    const dayKey = date.slice(0, 10)
    const purchase: Purchase = {
      items: [{ name: input.desc, qty: 1, price: input.total }],
      desc: input.provider ? `${input.provider}: ${input.desc}` : input.desc,
      total: input.total,
      date,
      dayKey,
    }
    const saved = insertAutoRow(db, TABLE, purchase)
    broadcast({ table: TABLE, op: 'put', data: saved })
    res.status(201).json(saved)
  })

  return router
}
