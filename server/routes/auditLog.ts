import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { AuditLogEntry } from '../../src/types/auditLog'
import { listAll, insertAutoRow } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'auditLog'

export function auditLogRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<AuditLogEntry>(db, TABLE))
  })

  router.post('/', (req, res) => {
    const entry = req.body as Omit<AuditLogEntry, 'id'>
    const saved = insertAutoRow(db, TABLE, entry)
    broadcast({ table: TABLE, op: 'put', data: saved })
    res.status(201).json(saved)
  })

  return router
}
