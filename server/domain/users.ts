import { randomUUID } from 'node:crypto'
import type { Usuario } from '../../src/types/usuario'
import type { BusinessInfo, Settings } from '../../src/types/settings'
import { ADMIN_ROLE_ID, resolveRoles, sanitizeAccess, sanitizeRoles } from '../../src/shared/lib/permissions'
import { cleanEmail, newPasswordProblem } from '../../src/shared/lib/account'
import type { Accounts } from '../accounts'
import type { Sql } from '../db'
import { deleteRow, getRow, listAll, putRow } from '../routes/generic'
import { HttpError } from '../routes/http'
import { assertNewPin, refreshCounterPerms, requireNeed, storePin, type Actor } from './counter'

/** Users, roles and the settings that carry them — Administrador only (theme aside). The app checks
 * all of this before sending, but the rules that keep the store usable live here, where two devices
 * can't race past them:
 * - each user signs in with their own account (their `email`; Supabase Auth keeps the password,
 *   server/accounts.ts), which no other user nor an owner has;
 * - nobody shares a PIN — with another user or with the owner's master PIN — since a PIN alone says
 *   who is authorizing (PINs are hashed in the database, server/domain/counter.ts);
 * - no two users share a name (sales and cierres are signed with it);
 * - every user's role exists, so a role in use can't be deleted out from under them;
 * - an administrator can't lock themselves out (deactivate or delete themselves, or drop their own
 *   Administrador role).
 * Supabase Auth is written last, once every rule passed: it isn't part of the transaction. */

const USERS = 'usuarios'
const MAX_NAME = 40

export interface UsuarioInput {
  name: string
  role: string
  /** The email they sign in with. Omitted on update = unchanged; once set it can change but not go. */
  email?: string
  /** A new password for that account, as typed — sent once, kept only by Supabase Auth. Required to
   * create the account; omitted = unchanged. */
  password?: string
  /** A PIN to authorize steps on other people's sessions — optional; sent once, hashed by the
   * database. Omitted on update = unchanged. */
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

/** A sign-in email nobody else has: not an owner's, not another user's. */
async function checkEmail(sql: Sql, input: unknown, selfId: string | null): Promise<string> {
  const email = cleanEmail(input)
  if (!email) throw new HttpError(400, 'Escribe un correo válido para que pueda iniciar sesión')
  if ((await sql.query(`select 1 from public.staff where lower(email) = $1`, [email])).length) throw new HttpError(409, 'Ese correo es la cuenta del propietario')
  const taken = (await listAll<Usuario>(sql, USERS)).find((u) => u.id !== selfId && u.email?.toLowerCase() === email)
  if (taken) throw new HttpError(409, `Ese correo ya lo usa ${taken.name}`)
  return email
}

/** The new password, or null when none was sent. Without the Supabase secret key the server can't
 * set one: the account is then made in the Supabase dashboard. */
function checkPassword(input: unknown, accounts: Accounts): string | null {
  if (input === undefined || input === null || input === '') return null
  if (!accounts.enabled) throw new HttpError(503, 'Este servidor no puede poner contraseñas: crea la cuenta en Supabase (Authentication → Users) con ese correo')
  const password = typeof input === 'string' ? input : ''
  const problem = newPasswordProblem(password, password)
  if (problem) throw new HttpError(400, problem)
  return password
}

const pinLengthOf = (settings: Settings): 4 | 6 => (settings.pinLength === 6 ? 6 : 4)
const hasValue = (v: unknown) => v !== undefined && v !== null && v !== ''

export async function createUsuario(sql: Sql, actor: Actor, input: UsuarioInput, accounts: Accounts): Promise<Usuario> {
  await requireNeed(sql, actor, 'admin')
  const { name, role, settings } = await checkUsuario(sql, input, null)
  const email = await checkEmail(sql, input.email, null)
  const password = checkPassword(input.password, accounts)
  if (accounts.enabled && !password) throw new HttpError(400, 'Escribe una contraseña para su cuenta')
  const id = randomUUID()
  const pinLength = pinLengthOf(settings)
  const pin = hasValue(input.pin) ? await assertNewPin(sql, input.pin, pinLength, id) : null
  const usuario: Usuario = { id, name, role, email, ...(pin ? { pinLength } : {}), active: input.active !== false, createdAt: new Date().toISOString() }
  await putRow(sql, USERS, 'id', id, usuario)
  if (pin) await storePin(sql, id, pin)
  if (password) await accounts.ensure(email, password, name)
  return usuario
}

export async function updateUsuario(sql: Sql, actor: Actor, id: string, input: UsuarioInput, accounts: Accounts): Promise<Usuario> {
  await requireNeed(sql, actor, 'admin')
  const existing = await getRow<Usuario>(sql, USERS, 'id', id)
  if (!existing) throw new HttpError(404, 'Usuario no encontrado')
  const { name, role, settings } = await checkUsuario(sql, input, id)
  const active = input.active !== false
  if (actor.operator.id === id) {
    if (!active) throw new HttpError(409, 'No puedes desactivar tu propio usuario')
    if (existing.role === ADMIN_ROLE_ID && role !== ADMIN_ROLE_ID) throw new HttpError(409, 'No puedes quitarte a ti mismo el rol de Administrador')
  }
  const email = input.email === undefined ? existing.email : await checkEmail(sql, input.email, id)
  const password = checkPassword(input.password, accounts)
  if (password && !email) throw new HttpError(400, 'Escribe primero el correo de su cuenta')
  if (accounts.enabled && email && !existing.email && !password) throw new HttpError(400, 'Escribe una contraseña para su cuenta')
  const updated: Usuario = { ...existing, name, role, active, ...(email ? { email } : {}) }
  let pin: string | null = null
  if (hasValue(input.pin)) {
    updated.pinLength = pinLengthOf(settings)
    pin = await assertNewPin(sql, input.pin, updated.pinLength, id)
  }
  await putRow(sql, USERS, 'id', id, updated)
  if (pin) await storePin(sql, id, pin)
  // A new name, role or a deactivation applies at once to wherever they are signed in.
  await refreshCounterPerms(sql)
  if (!accounts.enabled || !email) return updated
  if (existing.email && existing.email !== email) {
    const moved = await accounts.changeEmail(existing.email, email)
    if (!moved && !password) throw new HttpError(409, `${existing.email} no tiene cuenta en Supabase: escribe una contraseña para crearla con el correo nuevo`)
    if (password) {
      try {
        await accounts.ensure(email, password, name)
      } catch (err) {
        // Supabase refused the password: the account goes back to the email the user keeps.
        if (moved) await accounts.changeEmail(email, existing.email).catch(() => false)
        throw err
      }
    }
  } else if (password) {
    await accounts.ensure(email, password, name)
  }
  return updated
}

export async function deleteUsuario(sql: Sql, actor: Actor, id: string, accounts: Accounts): Promise<void> {
  await requireNeed(sql, actor, 'admin')
  if (actor.operator.id === id) throw new HttpError(409, 'No puedes eliminar tu propio usuario')
  const existing = await getRow<Usuario>(sql, USERS, 'id', id)
  // The table's trigger takes their PIN and their sessions' permissions.
  await deleteRow(sql, USERS, 'id', id)
  // Without the secret key their account stays in Supabase Auth, but it no longer opens anything.
  if (existing?.email && accounts.enabled) await accounts.remove(existing.email)
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
 * permissions only, built-ins kept, none removed while someone still has it) and `access`. */
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
  if ('access' in patch) next.access = sanitizeAccess(patch.access)
  await putRow(sql, 'settings', 'key', 'main', next)
  if ('roles' in patch) await refreshCounterPerms(sql)
  return next
}
