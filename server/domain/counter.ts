import { createHash } from 'node:crypto'
import type { Settings } from '../../src/types/settings'
import type { Usuario } from '../../src/types/usuario'
import { ADMIN_ROLE_ID, OWNER_ID, OWNER_NAME, isPermission, needsOfRole, permissionLabel, resolveRoles, sanitizeAccess, type Need } from '../../src/shared/lib/permissions'
import { newPinProblem } from '../../src/shared/lib/pin'
import type { AuthInfo } from '../auth'
import type { Sql } from '../db'
import { getRow, putRow } from '../routes/generic'
import { HttpError } from '../routes/http'

/** Who is working on each signed-in device — decided here, never by the browser:
 * - a PIN is checked against hashes no browser can read (private.pins), and wrong guesses are
 *   rate-limited per device and store-wide;
 * - whoever it belongs to is bound to the device's Supabase session (private.counter_sessions) with
 *   their role's permissions, which every route checks (`requireNeed`) and RLS reads
 *   (public.has_perm) before serving costs, profits, the cash ledger, purchasing or cierres;
 * - someone else's PIN can let one step through ("autorizar") without changing who is working.
 * Every function runs inside the caller's `db.tx`. */

export interface Operator {
  id: string
  name: string
  roleId: string
}

export interface Actor {
  sessionId: string
  /** Signed in on this device, or null: the open counter (or nobody, in PIN mode). */
  operator: Operator | null
  /** What may be done right now: the operator's role, else the open counter's role. */
  needs: Set<string>
}

/** How long a device keeps its signed-in person without a heartbeat (the app sends one every 45 s
 * while it's open): a closed tab or a sleeping phone loses the session within minutes. */
export const SESSION_TTL_SECONDS = 180

/** Sale steps (discount, fiado, changing the total, an unregistered product) wait for their sale and
 * are spent by it; any other approval lets its step through for a few minutes (a form being filled). */
export const SPENT_BY_SALE = new Set<Need>(['ventas.descuentos', 'ventas.fiar', 'ventas.cambiarTotal', 'ventas.productoLibre'])
const SALE_APPROVAL_SECONDS = 15 * 60
const APPROVAL_SECONDS = 5 * 60

export const PIN_TRIES = 5
/** A device's streak of wrong PINs is forgotten after this long without another one. */
const STREAK_RESET = '30 minutes'
/** Store-wide: this many wrong PINs within 24 hours lock every pad for an hour (doubling while it goes on). */
const STORE_MAX_WRONG = 30
const STORE_LOCK_MS = 60 * 60_000
const DAY_MS = 24 * 60 * 60_000

const FACTORY_PIN = '1234'

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const ownerOperator = (): Operator => ({ id: OWNER_ID, name: OWNER_NAME, roleId: ADMIN_ROLE_ID })
const pinOwnerId = (operatorId: string) => (operatorId === OWNER_ID ? 'owner' : `user:${operatorId}`)

async function settingsOf(q: Sql): Promise<Settings> {
  const s = await getRow<Settings>(q, 'settings', 'key', 'main')
  if (!s) throw new HttpError(500, 'Faltan los ajustes de la tienda')
  return s
}

async function rolesOf(q: Sql) {
  const settings = await settingsOf(q)
  const roles = resolveRoles(settings.roles)
  return { settings, roles, access: sanitizeAccess(settings.access, roles) }
}

// ------------------------------------------------------------------------------- the actor

/** Who is behind a request: the person signed in on that device, else the open counter. */
export async function actorOf(q: Sql, auth: AuthInfo): Promise<Actor> {
  const [b] = await q.query<{ operator_id: string; operator_name: string; role_id: string; perms: string[] }>(
    `select operator_id, operator_name, role_id, perms from private.counter_sessions where session_id = $1 and expires_at > now()`,
    [auth.sessionId],
  )
  if (b) return { sessionId: auth.sessionId, operator: { id: b.operator_id, name: b.operator_name, roleId: b.role_id }, needs: new Set(b.perms) }
  const [a] = await q.query<{ counter_perms: string[] }>(`select counter_perms from private.access_state where id = 1`)
  return { sessionId: auth.sessionId, operator: null, needs: new Set(a?.counter_perms ?? []) }
}

/** Whether the actor may do it on their own (no approval) — for what a response may show. */
export const allowed = (actor: Actor, need: Need): boolean => actor.needs.has(need)

/** Lets the step through if whoever is working may do it, or if someone allowed approved it on this
 * device with their PIN; otherwise a 403 carrying `need`, so the app can ask for that PIN and retry.
 * Returns who to attribute the step to (the operator, the approver, or null for the open counter). */
export async function requireNeed(q: Sql, actor: Actor, need: Need): Promise<string | null> {
  if (actor.needs.has(need)) return actor.operator?.name ?? null
  if (need !== 'admin') {
    const [ap] = await q.query<{ approver_name: string }>(
      `select approver_name from private.approvals where session_id = $1 and need = $2 and expires_at > now()`,
      [actor.sessionId, need],
    )
    if (ap) {
      if (SPENT_BY_SALE.has(need)) await q.query(`delete from private.approvals where session_id = $1 and need = $2`, [actor.sessionId, need])
      return ap.approver_name
    }
  }
  throw new HttpError(403, need === 'admin' ? 'Esto solo lo puede hacer un administrador' : `"${permissionLabel(need)}" necesita la autorización de alguien con permiso`, { need })
}

// ----------------------------------------------------------------------------------- PINs

/** Whose PIN this is: the owner's master PIN first, then the active users by name (two people could
 * share one only in rows saved before PINs had to be unique). */
async function pinOwner(q: Sql, pin: string): Promise<Operator | null> {
  const rows = await q.query<{ owner_id: string }>(`select owner_id from private.pins where hash = private.pin_digest($1)`, [sha256(pin)])
  if (!rows.length) return null
  if (rows.some((r) => r.owner_id === 'owner')) return ownerOperator()
  const users: Usuario[] = []
  for (const r of rows) {
    const u = await getRow<Usuario>(q, 'usuarios', 'id', r.owner_id.replace(/^user:/, ''))
    if (u?.active) users.push(u)
  }
  const u = users.sort((a, b) => a.name.localeCompare(b.name, 'es'))[0]
  return u ? { id: u.id, name: u.name, roleId: u.role } : null
}

const isPinShape = (pin: unknown): pin is string => typeof pin === 'string' && /^(\d{4}|\d{6})$/.test(pin)

/** 429 while this device or the whole store is locked out. Nothing written yet, so it can throw. */
async function assertNotLocked(q: Sql, sessionId: string): Promise<void> {
  const rows = await q.query<{ scope: string; locked_until: Date }>(
    `select scope, locked_until from private.pin_guard where scope in ($1, 'global') and locked_until > now()`,
    [`session:${sessionId}`],
  )
  if (!rows.length) return
  const lockedUntil = Math.max(...rows.map((r) => new Date(r.locked_until).getTime()))
  const store = rows.some((r) => r.scope === 'global')
  throw new HttpError(
    429,
    store ? 'Demasiados PIN equivocados en la tienda: el ingreso con PIN quedó bloqueado un rato' : 'Demasiados intentos: espera un momento',
    { lockedUntil, storeLock: store },
  )
}

/** Counts a wrong PIN. Every 5th in a row locks this device for 30 s, then 1, 2, 4… minutes (15 at
 * most); 30 within a day across the store lock every device for an hour, doubling while it goes on.
 * Returns the error to answer with — the caller throws it only after this transaction commits, so
 * the count can't be undone by the failure itself. */
async function registerWrongPin(q: Sql, sessionId: string): Promise<HttpError> {
  const [s] = await q.query<{ failures: number }>(
    `insert into private.pin_guard (scope, failures, window_start) values ($1, 1, now())
     on conflict (scope) do update set
       failures = case when pin_guard.window_start < now() - interval '${STREAK_RESET}' then 1 else pin_guard.failures + 1 end,
       window_start = now()
     returning failures`,
    [`session:${sessionId}`],
  )
  const [g] = await q.query<{ failures: number }>(
    `insert into private.pin_guard (scope, failures, window_start) values ('global', 1, now())
     on conflict (scope) do update set
       failures = case when pin_guard.window_start < now() - interval '24 hours' then 1 else pin_guard.failures + 1 end,
       window_start = case when pin_guard.window_start < now() - interval '24 hours' then now() else pin_guard.window_start end
     returning failures`,
  )
  let lockedUntil: number | undefined
  if (g.failures >= STORE_MAX_WRONG) {
    lockedUntil = Date.now() + Math.min(STORE_LOCK_MS * 2 ** (g.failures - STORE_MAX_WRONG), DAY_MS)
    await q.query(`update private.pin_guard set locked_until = $1 where scope = 'global'`, [new Date(lockedUntil)])
    return new HttpError(429, 'Demasiados PIN equivocados en la tienda: el ingreso con PIN quedó bloqueado un rato', { lockedUntil, storeLock: true })
  }
  if (s.failures % PIN_TRIES === 0) {
    lockedUntil = Date.now() + Math.min(30_000 * 2 ** (s.failures / PIN_TRIES - 1), 15 * 60_000)
    await q.query(`update private.pin_guard set locked_until = $1 where scope = $2`, [new Date(lockedUntil), `session:${sessionId}`])
    return new HttpError(429, 'Demasiados intentos: espera un momento', { lockedUntil })
  }
  return new HttpError(401, 'PIN incorrecto', { attemptsLeft: PIN_TRIES - (s.failures % PIN_TRIES) })
}

type Checked = { operator: Operator; needs: Need[]; error?: undefined } | { error: HttpError }

/** The common part of signing in and approving: lockout, PIN, and (with `need`) a named refusal for
 * the right PIN of someone who may not do it — which isn't a wrong guess, so it doesn't count. */
async function checkPin(q: Sql, sessionId: string, pin: unknown, need?: Need): Promise<Checked> {
  await assertNotLocked(q, sessionId)
  const operator = isPinShape(pin) ? await pinOwner(q, pin) : null
  if (!operator) return { error: await registerWrongPin(q, sessionId) }
  const { roles } = await rolesOf(q)
  const needs = needsOfRole(roles, operator.roleId)
  if (need && !needs.includes(need)) return { error: new HttpError(403, `${operator.name} no tiene permiso para esto`, { refused: true }) }
  return { operator, needs }
}

const isNeed = (v: unknown): v is Need => v === 'admin' || isPermission(v)

async function sweep(q: Sql): Promise<void> {
  await q.query(`delete from private.counter_sessions where expires_at < now() - interval '1 day'`)
  await q.query(`delete from private.approvals where expires_at < now()`)
  await q.query(`delete from private.pin_guard where scope <> 'global' and window_start < now() - interval '1 day' and (locked_until is null or locked_until < now())`)
}

export interface SignInResult {
  operator?: Operator
  /** The owner came in with the factory PIN (1234): the app makes them choose another first. */
  mustChangePin?: boolean
  error?: HttpError
}

/** A PIN signs its owner in on this device (module entry, the lock screen, "cambiar de usuario").
 * With `need`, only someone who may do it. Throw `error` after the transaction commits. */
export async function signIn(q: Sql, auth: AuthInfo, pin: unknown, need?: unknown): Promise<SignInResult> {
  if (need !== undefined && need !== null && !isNeed(need)) throw new HttpError(400, 'Permiso desconocido')
  const checked = await checkPin(q, auth.sessionId, pin, (need ?? undefined) as Need | undefined)
  if (checked.error) return { error: checked.error }
  const { operator, needs } = checked
  await sweep(q)
  await q.query(
    `insert into private.counter_sessions (session_id, operator_id, operator_name, role_id, perms, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
     on conflict (session_id) do update set operator_id = excluded.operator_id, operator_name = excluded.operator_name,
       role_id = excluded.role_id, perms = excluded.perms, expires_at = excluded.expires_at, created_at = now()`,
    [auth.sessionId, operator.id, operator.name, operator.roleId, needs, SESSION_TTL_SECONDS],
  )
  // Approvals given to whoever worked here before don't carry over to the new person.
  await q.query(`delete from private.approvals where session_id = $1`, [auth.sessionId])
  return { operator, mustChangePin: operator.id === OWNER_ID && pin === FACTORY_PIN }
}

export async function signOut(q: Sql, auth: AuthInfo): Promise<void> {
  await q.query(`delete from private.counter_sessions where session_id = $1`, [auth.sessionId])
  await q.query(`delete from private.approvals where session_id = $1`, [auth.sessionId])
}

/** Keeps this device's person signed in a little longer; null once their session is gone (expired,
 * replaced, or their user was deactivated). */
export async function heartbeat(q: Sql, auth: AuthInfo): Promise<Operator | null> {
  const [b] = await q.query<{ operator_id: string; operator_name: string; role_id: string }>(
    `update private.counter_sessions set expires_at = now() + make_interval(secs => $2)
     where session_id = $1 and expires_at > now()
     returning operator_id, operator_name, role_id`,
    [auth.sessionId, SESSION_TTL_SECONDS],
  )
  return b ? { id: b.operator_id, name: b.operator_name, roleId: b.role_id } : null
}

export interface ApproveResult {
  approver?: Operator
  error?: HttpError
}

/** Someone allowed lets one step through on this device without signing in (a supervisor
 * authorizing a cashier's discount). Throw `error` after the transaction commits. */
export async function approve(q: Sql, auth: AuthInfo, pin: unknown, need: unknown): Promise<ApproveResult> {
  if (!isNeed(need) || need === 'admin') throw new HttpError(400, 'Permiso desconocido')
  const checked = await checkPin(q, auth.sessionId, pin, need)
  if (checked.error) return { error: checked.error }
  const seconds = SPENT_BY_SALE.has(need) ? SALE_APPROVAL_SECONDS : APPROVAL_SECONDS
  await q.query(
    `insert into private.approvals (session_id, need, approver_id, approver_name, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     on conflict (session_id, need) do update set approver_id = excluded.approver_id, approver_name = excluded.approver_name, expires_at = excluded.expires_at`,
    [auth.sessionId, need, checked.operator.id, checked.operator.name, seconds],
  )
  return { approver: checked.operator }
}

/** After roles, the access mode or a user changed: the open counter's permissions and every signed-in
 * person's follow at once (RLS reads them), and a deactivated user is signed out everywhere. */
export async function refreshCounterPerms(q: Sql): Promise<void> {
  const { roles, access } = await rolesOf(q)
  await q.query(
    `insert into private.access_state (id, counter_perms) values (1, $1) on conflict (id) do update set counter_perms = excluded.counter_perms`,
    [access.mode === 'abierto' ? needsOfRole(roles, access.counterRole) : []],
  )
  const bindings = await q.query<{ session_id: string; operator_id: string }>(`select session_id, operator_id from private.counter_sessions`)
  for (const b of bindings) {
    if (b.operator_id === OWNER_ID) {
      await q.query(`update private.counter_sessions set perms = $2 where session_id = $1`, [b.session_id, needsOfRole(roles, ADMIN_ROLE_ID)])
      continue
    }
    const u = await getRow<Usuario>(q, 'usuarios', 'id', b.operator_id)
    if (!u || !u.active) {
      await q.query(`delete from private.counter_sessions where session_id = $1`, [b.session_id])
      continue
    }
    await q.query(`update private.counter_sessions set operator_name = $2, role_id = $3, perms = $4 where session_id = $1`, [
      b.session_id,
      u.name,
      u.role,
      needsOfRole(roles, u.role),
    ])
  }
}

// ------------------------------------------------------------------------ setting PINs

/** 400 for a PIN the store's rules reject (length, digits, too easy), 409 if someone else has it. */
export async function assertNewPin(q: Sql, pin: unknown, length: number, operatorId: string): Promise<string> {
  const value = typeof pin === 'string' ? pin : ''
  const problem = newPinProblem(value, value, length)
  if (problem) throw new HttpError(400, problem)
  const taken = await q.query(`select 1 from private.pins where hash = private.pin_digest($1) and owner_id <> $2 limit 1`, [sha256(value), pinOwnerId(operatorId)])
  if (taken.length) throw new HttpError(409, 'Ese PIN ya lo usa otra persona: elige otro')
  return value
}

export async function storePin(q: Sql, operatorId: string, pin: string): Promise<void> {
  await q.query(
    `insert into private.pins (owner_id, hash) values ($1, private.pin_digest($2)) on conflict (owner_id) do update set hash = excluded.hash`,
    [pinOwnerId(operatorId), sha256(pin)],
  )
}

/** The owner's master PIN (and with it the PIN length of the whole store), changed by an admin. */
export async function changeOwnerPin(q: Sql, actor: Actor, pin: unknown, pinLength: unknown): Promise<void> {
  await requireNeed(q, actor, 'admin')
  const length = pinLength === 6 ? 6 : pinLength === 4 ? 4 : 0
  if (!length) throw new HttpError(400, 'El PIN debe tener 4 o 6 dígitos')
  const value = await assertNewPin(q, pin, length, OWNER_ID)
  await storePin(q, OWNER_ID, value)
  const settings = await settingsOf(q)
  await putRow(q, 'settings', 'key', 'main', { ...settings, pinLength: length, pinChangedAt: new Date().toISOString() })
}

/** "¿Olvidaste el PIN del propietario?": whoever typed the store account's password on this device in
 * the last 10 minutes (a fresh sign-in, proven by the token itself) sets a new master PIN. It also
 * lifts every PIN lockout. */
export async function recoverOwnerPin(q: Sql, auth: AuthInfo, pin: unknown): Promise<void> {
  if (!auth.passwordAt || Date.now() - auth.passwordAt > 10 * 60_000) throw new HttpError(403, 'Confirma la contraseña de la cuenta para restablecer el PIN')
  const settings = await settingsOf(q)
  const value = await assertNewPin(q, pin, settings.pinLength === 6 ? 6 : 4, OWNER_ID)
  await storePin(q, OWNER_ID, value)
  await putRow(q, 'settings', 'key', 'main', { ...settings, pinChangedAt: new Date().toISOString() })
  await q.query(`delete from private.pin_guard`)
}

export interface SecurityInfo {
  /** The master PIN is still the factory one (1234). */
  ownerPinDefault: boolean
  /** Users whose PIN someone else also has (only possible in rows saved before PINs had to be unique). */
  sharedPinUserIds: string[]
  ownerSharesPin: boolean
  /** Wrong PINs across the store in the current 24-hour window, and a store-wide lock if one is on. */
  wrongPins24h: number
  lockedUntil: number | null
}

export async function securityInfo(q: Sql, actor: Actor): Promise<SecurityInfo> {
  await requireNeed(q, actor, 'admin')
  const [owner] = await q.query<{ factory: boolean }>(`select hash = private.pin_digest($1) as factory from private.pins where owner_id = 'owner'`, [sha256(FACTORY_PIN)])
  const shared = await q.query<{ owner_id: string }>(`select owner_id from private.pins where hash in (select hash from private.pins group by hash having count(*) > 1)`)
  const [g] = await q.query<{ failures: number; window_start: Date; locked_until: Date | null }>(`select failures, window_start, locked_until from private.pin_guard where scope = 'global'`)
  const fresh = g && Date.now() - new Date(g.window_start).getTime() < DAY_MS
  const lockedUntil = g?.locked_until && new Date(g.locked_until).getTime() > Date.now() ? new Date(g.locked_until).getTime() : null
  return {
    ownerPinDefault: !owner || owner.factory,
    sharedPinUserIds: shared.filter((r) => r.owner_id.startsWith('user:')).map((r) => r.owner_id.slice(5)),
    ownerSharesPin: shared.some((r) => r.owner_id === 'owner'),
    wrongPins24h: fresh ? g.failures : 0,
    lockedUntil,
  }
}
