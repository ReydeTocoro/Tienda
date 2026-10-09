import { Router } from 'express'
import type { Accounts } from '../accounts'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf } from '../domain/counter'
import { createUsuario, deleteUsuario, updateUsuario, type UsuarioInput } from '../domain/users'
import { handle } from './http'

/** People who work at the store — name, role, the email of their own sign-in account (its password
 * is sent once and kept only by Supabase Auth) and an optional PIN to authorize steps (sent once,
 * hashed in the database). Administrador only; the rules (unique email, name and PIN, an existing
 * role) live in server/domain/users.ts. */
export function usuariosRouter(db: Db, accounts: Accounts) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => db.tx(async (q) => createUsuario(q, await actorOf(q, authOf(req)), req.body as UsuarioInput, accounts)), 201),
  )

  router.put(
    '/:id',
    handle(async (req) => db.tx(async (q) => updateUsuario(q, await actorOf(q, authOf(req)), req.params.id, req.body as UsuarioInput, accounts))),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx(async (q) => deleteUsuario(q, await actorOf(q, authOf(req)), req.params.id, accounts))
    }),
  )

  return router
}
