import { Router } from 'express'
import type { Db } from '../db'
import { handle } from './http'
import { openCaja, registerMovement, transferFunds, type MovementInput, type TransferInput } from '../domain/cash'

/** Cash operations, mounted at /api/cash. Reads come from the synced `cashMovements` /
 * `cashSessions` tables; every write here goes through the ledger rules in `domain/cash.ts`. */
export function cashRouter(db: Db) {
  const router = Router()

  router.post(
    '/movement',
    handle(async (req) => db.tx((q) => registerMovement(q, req.body as MovementInput)), 201),
  )

  router.post(
    '/transfer',
    handle(async (req) => db.tx((q) => transferFunds(q, req.body as TransferInput)), 201),
  )

  router.post(
    '/open',
    handle(async (req) => {
      const { countedCash, by, mayorInitial } = req.body as { countedCash: number; by: string; mayorInitial?: number }
      return db.tx((q) => openCaja(q, { countedCash, by, mayorInitial }))
    }, 201),
  )

  return router
}
