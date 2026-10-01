import { Router } from 'express'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Usuario, UsuarioRole } from '../../src/types/usuario'
import { listAll, getRow, putRow, deleteRow } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'usuarios'

interface UsuarioInput {
  name: string
  role: UsuarioRole
  /** Omitted on update to keep the existing PIN unchanged. */
  pinHash?: string
  active: boolean
}

/** Staff accounts — name, role (admin/cajero) and their own PIN hash. The PIN itself is hashed
 * client-side (same sha256 helper the master `settings.pinHash` already uses) so the server
 * never sees a plaintext PIN. */
export function usuariosRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Usuario>(db, TABLE))
  })

  router.post('/', (req, res) => {
    const input = req.body as UsuarioInput
    if (!input?.name?.trim()) return res.status(400).json({ error: 'El nombre es requerido' })
    if (!input?.pinHash) return res.status(400).json({ error: 'El PIN es requerido' })
    const usuario: Usuario = {
      id: randomUUID(),
      name: input.name.trim(),
      role: input.role,
      pinHash: input.pinHash,
      active: input.active,
      createdAt: new Date().toISOString(),
    }
    putRow(db, TABLE, 'id', usuario.id, {}, usuario)
    broadcast({ table: TABLE, op: 'put', data: usuario })
    res.status(201).json(usuario)
  })

  router.put('/:id', (req, res) => {
    const input = req.body as UsuarioInput
    const existing = getRow<Usuario>(db, TABLE, 'id', req.params.id)
    if (!existing) return res.status(404).json({ error: 'Usuario no encontrado' })
    const updated: Usuario = {
      ...existing,
      name: input.name.trim(),
      role: input.role,
      active: input.active,
      pinHash: input.pinHash || existing.pinHash,
    }
    putRow(db, TABLE, 'id', req.params.id, {}, updated)
    broadcast({ table: TABLE, op: 'put', data: updated })
    res.json(updated)
  })

  router.delete('/:id', (req, res) => {
    deleteRow(db, TABLE, 'id', req.params.id)
    broadcast({ table: TABLE, op: 'delete', data: req.params.id })
    res.status(204).end()
  })

  return router
}
