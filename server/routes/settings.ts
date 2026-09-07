import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Settings } from '../../src/types/settings'
import { listAll, getRow, putRow } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'settings'

/** Single 'main' row, seeded at db.ts init. GET returns an array (with that one row) so the
 * client's generic initial-pull loop (GET /api/<table> -> bulkPut) works the same for every
 * table without a special case for this one. */
export function settingsRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Settings>(db, TABLE))
  })

  router.put('/', (req, res) => {
    const patch = req.body as Partial<Omit<Settings, 'key'>>
    const current = getRow<Settings>(db, TABLE, 'key', 'main')
    const updated: Settings = { ...(current as Settings), ...patch, key: 'main' }
    putRow(db, TABLE, 'key', 'main', {}, updated)
    broadcast({ table: TABLE, op: 'put', data: updated })
    res.json(updated)
  })

  return router
}
