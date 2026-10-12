import { Router } from 'express'
import { PUSH_HOURS_LABEL } from '../../src/features/notifications/lib/notices'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { checkPushToken, dropPushToken, savePushToken, type PushSend } from '../domain/push'
import { handle } from './http'

/** Turning the phone notifications on and off for a device (server/domain/push.ts). `push` is null without Firebase
 * (the local server): the token is kept, but no test notification goes out. */
export function pushRouter(db: Db, push: PushSend | null) {
  const router = Router()

  // An Administrador turns them on for this device — and a first one goes out at once, so they see it works.
  router.post(
    '/token',
    handle(async (req) => {
      const token = checkPushToken((req.body as { token?: unknown } | undefined)?.token)
      const auth = authOf(req)
      await db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, auth), 'admin')
        await savePushToken(q, auth.email, token)
      })
      if (!push) return { tested: false }
      try {
        const gone = await push([token], { title: 'Avisos activados', body: `Aquí te llegarán los pendientes de la tienda a las ${PUSH_HOURS_LABEL}` })
        return { tested: gone.length === 0 }
      } catch (err) {
        console.error('No se pudo enviar el aviso de prueba:', err)
        return { tested: false }
      }
    }),
  )

  // Anyone signed in may turn a device off: the token itself (unguessable) is what names it.
  router.delete(
    '/token/:token',
    handle(async (req) => {
      const token = checkPushToken(req.params.token)
      await db.tx((q) => dropPushToken(q, token))
    }),
  )

  return router
}
