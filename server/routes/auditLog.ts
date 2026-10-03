import { Router } from 'express'
import type { AuditLogEntry } from '../../src/types/auditLog'
import type { Db } from '../db'
import { insertAutoRow } from './generic'
import { handle } from './http'

export function auditLogRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => {
      const entry = req.body as Omit<AuditLogEntry, 'id'>
      return db.tx((q) => insertAutoRow(q, 'auditLog', entry))
    }, 201),
  )

  return router
}
