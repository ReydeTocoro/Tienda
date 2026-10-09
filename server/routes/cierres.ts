import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { handle } from './http'
import { confirmCierre, type ConfirmCierreInput } from '../domain/cierre'

/** Cierre Z, mounted at /api/cierres — needs `caja.cerrar`. Whoever closes blind (no
 * `caja.verEsperado`) gets back only that it's closed, not the arqueo. */
export function cierresRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => {
      const input = (req.body ?? {}) as ConfirmCierreInput
      return db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        await requireNeed(q, actor, 'caja.cerrar')
        // The cierre is signed by whoever is working, whatever the browser says.
        const cierre = await confirmCierre(q, { ...input, cajero: actor.operator.name })
        if (allowed(actor, 'caja.verEsperado')) return cierre
        return { id: cierre.id, tipo: cierre.tipo, fecha: cierre.fecha, cajero: cierre.cajero, cerradoEn: cierre.cerradoEn }
      })
    }, 201),
  )

  return router
}
