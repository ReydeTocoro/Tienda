import { Router } from 'express'
import type { CashSession } from '../../src/types/cash'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { handle } from './http'
import { openCaja, registerMovement, transferFunds, type MovementInput, type TransferInput } from '../domain/cash'

const name = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 40) : '')

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
        return registerMovement(q, { ...input, by: by ?? name(input.by) })
      })
    }, 201),
  )

  router.post(
    '/transfer',
    handle(async (req) => {
      const input = (req.body ?? {}) as TransferInput
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'caja.gestionar')
        return transferFunds(q, { ...input, by: by ?? name(input.by) })
      })
    }, 201),
  )

  /** Opening the drawer only needs `caja.abrir` — it's counting it. Setting the Caja Mayor's opening
   * balance (first opening only) is managing the cajas. */
  router.post(
    '/open',
    handle(async (req) => {
      const { countedCash, by, mayorInitial } = (req.body ?? {}) as { countedCash: number; by: string; mayorInitial?: number }
      return db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        const approver = await requireNeed(q, actor, 'caja.abrir')
        if (Number(mayorInitial) > 0) await requireNeed(q, actor, 'caja.gestionar')
        const session = await openCaja(q, { countedCash, by: actor.operator?.name ?? (name(by) || approver || ''), mayorInitial })
        return allowed(actor, 'caja.verEsperado') ? session : blindSession(session)
      })
    }, 201),
  )

  return router
}
