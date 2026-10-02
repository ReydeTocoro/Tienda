import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Cierre } from '../../src/types/cierre'
import { listAll, errorMessage } from './generic'
import { runAndBroadcast } from '../domain/tx'
import { confirmCierre, type ConfirmCierreInput } from '../domain/cierre'

export function cierresRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Cierre>(db, 'cierres'))
  })

  router.post('/', (req, res) => {
    try {
      res.status(201).json(runAndBroadcast(db, (out) => confirmCierre(db, out, req.body as ConfirmCierreInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  return router
}
