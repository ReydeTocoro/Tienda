import { Router } from 'express'
import type { Accounts } from '../accounts'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, approve, bindSession, changeOwnerPin, securityInfo, signOut } from '../domain/counter'
import { handle } from './http'

/** Who is working on this device, mounted at /api/counter: the signed-in account's person bound to
 * the device's session, and PINs that authorize one step — checked here, never in the browser (see
 * server/domain/counter.ts). A wrong PIN is counted even though the request fails: the count is
 * committed first, then the error goes out. */
export function counterRouter(db: Db, accounts: Accounts) {
  const router = Router()

  // As the app starts and then every minute: who this account is now, bound to the session for RLS.
  router.post(
    '/session',
    handle(async (req) => ({ operator: await db.tx((q) => bindSession(q, authOf(req))) })),
  )

  router.post(
    '/sign-out',
    handle(async (req) => {
      await db.tx((q) => signOut(q, authOf(req)))
    }),
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

  router.get(
    '/security',
    handle(async (req) => db.tx(async (q) => securityInfo(q, await actorOf(q, authOf(req)), accounts.enabled))),
  )

  return router
}
