import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Usuario, UsuarioRole } from '../../src/types/usuario'
import type { Db } from '../db'
import { getRow, putRow, deleteRow } from './generic'
import { HttpError, handle } from './http'

const TABLE = 'usuarios'

interface UsuarioInput {
  name: string
  role: UsuarioRole
  /** Omitted on update to keep the existing PIN unchanged. */
  pinHash?: string
  active: boolean
}

/** Staff accounts inside the app — name, role (admin/cajero) and their own PIN hash. The PIN is
 * hashed client-side (same sha256 helper the master `settings.pinHash` uses) so the server never
 * sees a plaintext PIN. Separate from the Supabase login, which only opens the app on a device. */
export function usuariosRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => {
      const input = req.body as UsuarioInput
      if (!input?.name?.trim()) throw new HttpError(400, 'El nombre es requerido')
      if (!input?.pinHash) throw new HttpError(400, 'El PIN es requerido')
      const usuario: Usuario = {
        id: randomUUID(),
        name: input.name.trim(),
        role: input.role,
        pinHash: input.pinHash,
        active: input.active,
        createdAt: new Date().toISOString(),
      }
      await db.tx((q) => putRow(q, TABLE, 'id', usuario.id, usuario))
      return usuario
    }, 201),
  )

  router.put(
    '/:id',
    handle(async (req) => {
      const input = req.body as UsuarioInput
      return db.tx(async (q) => {
        const existing = await getRow<Usuario>(q, TABLE, 'id', req.params.id)
        if (!existing) throw new HttpError(404, 'Usuario no encontrado')
        const updated: Usuario = {
          ...existing,
          name: input.name.trim(),
          role: input.role,
          active: input.active,
          pinHash: input.pinHash || existing.pinHash,
        }
        await putRow(q, TABLE, 'id', req.params.id, updated)
        return updated
      })
    }),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx((q) => deleteRow(q, TABLE, 'id', req.params.id))
    }),
  )

  return router
}
