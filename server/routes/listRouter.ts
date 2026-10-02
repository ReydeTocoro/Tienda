import { Router } from 'express'
import type Database from 'better-sqlite3'
import { listAll } from './generic'

/** `GET /` returning a whole table — what the client sync layer pulls on every (re)connect. */
export function listRouter(db: Database.Database, table: string) {
  const router = Router()
  router.get('/', (_req, res) => {
    res.json(listAll(db, table))
  })
  return router
}
