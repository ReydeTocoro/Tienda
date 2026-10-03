import { Router } from 'express'
import type { Settings } from '../../src/types/settings'
import type { Db } from '../db'
import { getRow, putRow } from './generic'
import { handle } from './http'

const TABLE = 'settings'

/** The single 'main' row (seeded by the first migration): a PUT merges a partial patch into it. */
export function settingsRouter(db: Db) {
  const router = Router()

  router.put(
    '/',
    handle(async (req) => {
      const patch = req.body as Partial<Omit<Settings, 'key'>>
      return db.tx(async (q) => {
        const current = await getRow<Settings>(q, TABLE, 'key', 'main')
        const updated: Settings = { ...(current as Settings), ...patch, key: 'main' }
        await putRow(q, TABLE, 'key', 'main', updated)
        return updated
      })
    }),
  )

  return router
}
