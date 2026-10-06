import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, approve, changeOwnerPin, heartbeat, recoverOwnerPin, securityInfo, signIn, signOut } from '../domain/counter'
import { handle } from './http'

/** Who is working on this device, mounted at /api/counter: PINs are checked here (never in the
 * browser) and the person they belong to is bound to the device's session — see
 * server/domain/counter.ts. A wrong PIN is counted even though the request fails: the count is
 * committed first, then the error goes out. */
export function counterRouter(db: Db) {
  const router = Router()

  router.post(
    '/sign-in',
    handle(async (req) => {
      const { pin, need } = (req.body ?? {}) as { pin?: unknown; need?: unknown }
      const result = await db.tx((q) => signIn(q, authOf(req), pin, need))
      if (result.error) throw result.error
      return { operator: result.operator, mustChangePin: result.mustChangePin === true }
    }),
  )

  router.post(
    '/sign-out',
    handle(async (req) => {
      await db.tx((q) => signOut(q, authOf(req)))
    }),
  )

  router.post(
    '/heartbeat',
    handle(async (req) => ({ operator: await db.tx((q) => heartbeat(q, authOf(req))) })),
  )

  router.post(
    '/approve',
    handle(async (req) => {
      const { pin, need } = (req.body ?? {}) as { pin?: unknown; need?: unknown }
      const result = await db.tx((q) => approve(q, authOf(req), pin, need))
      if (result.error) throw result.error
      return { approver: result.approver }
    }),
  )

  router.post(
    '/owner-pin',
    handle(async (req) => {
      const { pin, pinLength } = (req.body ?? {}) as { pin?: unknown; pinLength?: unknown }
      await db.tx(async (q) => changeOwnerPin(q, await actorOf(q, authOf(req)), pin, pinLength))
    }),
  )

  router.post(
    '/recover-owner-pin',
    handle(async (req) => {
      const { pin } = (req.body ?? {}) as { pin?: unknown }
      await db.tx((q) => recoverOwnerPin(q, authOf(req), pin))
    }),
  )

  router.get(
    '/security',
    handle(async (req) => db.tx(async (q) => securityInfo(q, await actorOf(q, authOf(req))))),
  )

  return router
}
