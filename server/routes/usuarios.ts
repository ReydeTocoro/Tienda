import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf } from '../domain/counter'
import { createUsuario, deleteUsuario, updateUsuario, type UsuarioInput } from '../domain/users'
import { handle } from './http'

/** People who work at the store — name, role and their own PIN (sent once, hashed in the database,
 * never readable again). Separate from the Supabase login, which only opens the app on a device.
 * Administrador only; the rules (unique PIN and name, existing role) live in server/domain/users.ts. */
export function usuariosRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => db.tx(async (q) => createUsuario(q, await actorOf(q, authOf(req)), req.body as UsuarioInput)), 201),
  )

  router.put(
    '/:id',
    handle(async (req) => db.tx(async (q) => updateUsuario(q, await actorOf(q, authOf(req)), req.params.id, req.body as UsuarioInput))),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx(async (q) => deleteUsuario(q, await actorOf(q, authOf(req)), req.params.id))
    }),
  )

  return router
}
