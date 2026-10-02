import { Router } from 'express'
import type Database from 'better-sqlite3'
import { errorMessage } from './generic'
import { runAndBroadcast } from '../domain/tx'
import { openCaja, registerMovement, transferFunds, type MovementInput, type TransferInput } from '../domain/cash'

/** Cash operations, mounted at /api/cash. Reads come from the synced `cashMovements` /
 * `cashSessions` tables; every write here goes through the ledger rules in `domain/cash.ts`. */
export function cashRouter(db: Database.Database) {
  const router = Router()

  router.post('/movement', (req, res) => {
    try {
      res.status(201).json(runAndBroadcast(db, (out) => registerMovement(db, out, req.body as MovementInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.post('/transfer', (req, res) => {
    try {
      res.status(201).json(runAndBroadcast(db, (out) => transferFunds(db, out, req.body as TransferInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.post('/open', (req, res) => {
    try {
      const { countedCash, by, mayorInitial } = req.body as { countedCash: number; by: string; mayorInitial?: number }
      res.status(201).json(runAndBroadcast(db, (out) => openCaja(db, out, { countedCash, by, mayorInitial })))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  return router
}
