import { randomUUID } from 'node:crypto'
import type { Usuario } from '../../src/types/usuario'
import type { BusinessInfo, Settings } from '../../src/types/settings'
import { ADMIN_ROLE_ID, resolveRoles, sanitizeAccess, sanitizeRoles } from '../../src/shared/lib/permissions'
import type { Sql } from '../db'
import { deleteRow, getRow, listAll, putRow } from '../routes/generic'
import { HttpError } from '../routes/http'
import { assertNewPin, refreshCounterPerms, requireNeed, storePin, type Actor } from './counter'

/** Users, roles and the settings that carry them — Administrador only (theme aside). The app checks
 * all of this before sending, but the rules that keep the store usable live here, where two devices
 * can't race past them:
 * - nobody shares a PIN — with another user or with the owner's master PIN — since a PIN alone
 *   says who is signing in (PINs are hashed in the database, server/domain/counter.ts);
 * - no two users share a name (sales and cierres are signed with it);
 * - every user's role exists, so a role in use can't be deleted out from under them. */

const USERS = 'usuarios'
const MAX_NAME = 40

export interface UsuarioInput {
  name: string
  role: string
  /** The PIN as typed, only when setting or changing it — hashed in the database, never stored. */
  pin?: string
  active: boolean
}

async function settingsOf(sql: Sql): Promise<Settings> {
  const s = await getRow<Settings>(sql, 'settings', 'key', 'main')
  if (!s) throw new HttpError(500, 'Faltan los ajustes de la tienda')
  return s
}

async function checkUsuario(sql: Sql, input: UsuarioInput, selfId: string | null): Promise<{ name: string; role: string; settings: Settings }> {
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME) : ''
  if (!name) throw new HttpError(400, 'Escribe el nombre')
  const settings = await settingsOf(sql)
  const role = typeof input.role === 'string' ? input.role : ''
  if (!resolveRoles(settings.roles).some((r) => r.id === role)) throw new HttpError(400, 'Ese rol no existe')
  const others = (await listAll<Usuario>(sql, USERS)).filter((u) => u.id !== selfId)
  if (others.some((u) => u.name.trim().toLowerCase() === name.toLowerCase())) throw new HttpError(409, `Ya hay un usuario llamado "${name}"`)
  return { name, role, settings }
}

export async function createUsuario(sql: Sql, actor: Actor, input: UsuarioInput): Promise<Usuario> {
  await requireNeed(sql, actor, 'admin')
  if (!input?.pin) throw new HttpError(400, 'El PIN es requerido')
  const { name, role, settings } = await checkUsuario(sql, input, null)
  const id = randomUUID()
  const pinLength = settings.pinLength === 6 ? 6 : 4
  const pin = await assertNewPin(sql, input.pin, pinLength, id)
  const usuario: Usuario = { id, name, role, pinLength, active: input.active !== false, createdAt: new Date().toISOString() }
  await putRow(sql, USERS, 'id', id, usuario)
  await storePin(sql, id, pin)
  return usuario
}

export async function updateUsuario(sql: Sql, actor: Actor, id: string, input: UsuarioInput): Promise<Usuario> {
  await requireNeed(sql, actor, 'admin')
  const existing = await getRow<Usuario>(sql, USERS, 'id', id)
  if (!existing) throw new HttpError(404, 'Usuario no encontrado')
  const { name, role, settings } = await checkUsuario(sql, input, id)
  const updated: Usuario = { ...existing, name, role, active: input.active !== false }
  if (input.pin !== undefined) {
    const pinLength = settings.pinLength === 6 ? 6 : 4
    await storePin(sql, id, await assertNewPin(sql, input.pin, pinLength, id))
    updated.pinLength = pinLength
  }
  await putRow(sql, USERS, 'id', id, updated)
  // A new name, role or a deactivation applies at once to wherever they are signed in.
  await refreshCounterPerms(sql)
  return updated
}

export async function deleteUsuario(sql: Sql, actor: Actor, id: string): Promise<void> {
  await requireNeed(sql, actor, 'admin')
  // The table's trigger takes their PIN and signs them out everywhere.
  await deleteRow(sql, USERS, 'id', id)
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanBusiness(input: unknown): BusinessInfo {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return { nit: text(b.nit, 30), phone: text(b.phone, 30), address: text(b.address, 80), receiptFooter: text(b.receiptFooter, 80) }
}

/** What a settings patch may touch, and who may touch it. The master PIN, the PIN length, the caja's
 * base and the last cashier have their own routes (counter and cierre), never this one. */
const ANYONE = new Set(['theme'])
const ADMIN_ONLY = new Set(['storeName', 'business', 'roles', 'access', 'hidScannerEnabled'])

/** Merges a settings patch into the 'main' row, cleaning what has rules: `roles` (catalog
 * permissions only, built-ins kept, none removed while someone still has it) and `access` (a counter
 * role that exists and isn't the Administrador). */
export async function applySettingsPatch(sql: Sql, actor: Actor, patch: Record<string, unknown>): Promise<Settings> {
  const keys = Object.keys(patch && typeof patch === 'object' ? patch : {})
  const unknown = keys.find((k) => !ANYONE.has(k) && !ADMIN_ONLY.has(k))
  if (unknown) throw new HttpError(400, `Ese ajuste no se cambia aquí (${unknown})`)
  if (keys.some((k) => ADMIN_ONLY.has(k))) await requireNeed(sql, actor, 'admin')

  const current = await settingsOf(sql)
  const next: Settings = { ...current, key: 'main' }
  if ('theme' in patch) next.theme = patch.theme === 'dark' ? 'dark' : 'light'
  if ('hidScannerEnabled' in patch) next.hidScannerEnabled = patch.hidScannerEnabled === true
  if ('storeName' in patch) {
    const storeName = text(patch.storeName, 60)
    if (!storeName) throw new HttpError(400, 'Escribe el nombre de la tienda')
    next.storeName = storeName
  }
  if ('business' in patch) next.business = cleanBusiness(patch.business)
  if ('roles' in patch) {
    const roles = sanitizeRoles(patch.roles)
    const ids = new Set([ADMIN_ROLE_ID, ...roles.map((r) => r.id)])
    const orphan = (await listAll<Usuario>(sql, USERS)).find((u) => !ids.has(u.role))
    if (orphan) throw new HttpError(409, `No se puede quitar el rol de ${orphan.name}: asígnale otro primero`)
    next.roles = roles
  }
  if ('roles' in patch || 'access' in patch) {
    next.access = sanitizeAccess('access' in patch ? patch.access : next.access, resolveRoles(next.roles))
  }
  await putRow(sql, 'settings', 'key', 'main', next)
  if ('roles' in patch || 'access' in patch) await refreshCounterPerms(sql)
  return next
}
