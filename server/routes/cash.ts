import { Router } from 'express'
import type { CashSession } from '../../src/types/cash'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { handle } from './http'
import { openCaja, registerMovement, transferFunds, type MovementInput, type TransferInput } from '../domain/cash'

/** What someone who counts blind may learn about the session they just opened: not what the system
 * expected, nor the difference. */
function blindSession(s: CashSession): Partial<CashSession> {
  return { id: s.id, status: s.status, dayKey: s.dayKey, openedAt: s.openedAt, openedBy: s.openedBy }
}

/** Cash operations, mounted at /api/cash. Reads come from the synced `cashMovements` /
 * `cashSessions` tables (only for whoever may see the expected cash); every write here goes
 * through the ledger rules in `domain/cash.ts` and the permission of whoever is working. */
export function cashRouter(db: Db) {
  const router = Router()

  router.post(
    '/movement',
    handle(async (req) => {
      const input = (req.body ?? {}) as MovementInput
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'caja.gestionar')
        return registerMovement(q, { ...input, by })
      })
    }, 201),
  )

  router.post(
    '/transfer',
    handle(async (req) => {
      const input = (req.body ?? {}) as TransferInput
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'caja.gestionar')
        // Only these fields: a transfer from this route carries no note of its own.
        return transferFunds(q, { from: input.from, to: input.to, amount: input.amount, by })
      })
    }, 201),
  )

  /** Opening the drawer only needs `caja.abrir` — it's counting it. Setting the Caja Mayor's opening
   * balance (first opening only) and settling the opening's gap with the Caja Mayor (`settleWith: 'mayor'`: the day's base
   * taken from it, or cash carried to it) are managing the cajas: they move money in or out of the Caja Mayor. */
  router.post(
    '/open',
    handle(async (req) => {
      const { countedCash, mayorInitial, settleWith } = (req.body ?? {}) as { countedCash: number; mayorInitial?: number; settleWith?: unknown }
      return db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        await requireNeed(q, actor, 'caja.abrir')
        if (Number(mayorInitial) > 0) await requireNeed(q, actor, 'caja.gestionar')
        // Signed with whoever allowed it, if someone did ("Ana (autorizó Sofía)").
        const settledBy = settleWith === undefined ? undefined : await requireNeed(q, actor, 'caja.gestionar')
        const session = await openCaja(q, { countedCash, by: actor.operator.name, mayorInitial, ...(settleWith === undefined ? {} : { settleWith: settleWith as 'mayor', settledBy }) })
        return allowed(actor, 'caja.verEsperado') ? session : blindSession(session)
      })
    }, 201),
  )

  return router
}
