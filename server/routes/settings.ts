import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf } from '../domain/counter'
import { applySettingsPatch } from '../domain/users'
import { handle } from './http'

/** The single 'main' row (seeded by the first migration): a PUT merges a partial patch into it.
 * Only the Administrador changes settings (the theme aside); roles and the access mode are checked
 * on the way in (server/domain/users.ts). */
export function settingsRouter(db: Db) {
  const router = Router()

  router.put(
    '/',
    handle(async (req) => db.tx(async (q) => applySettingsPatch(q, await actorOf(q, authOf(req)), (req.body ?? {}) as Record<string, unknown>))),
  )

  return router
}
