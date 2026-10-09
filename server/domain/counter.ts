import { createHash } from 'node:crypto'
import type { Settings } from '../../src/types/settings'
import type { Usuario } from '../../src/types/usuario'
import { ADMIN_ROLE_ID, OWNER_ID, OWNER_NAME, isPermission, needsOfRole, permissionLabel, resolveRoles, type Need } from '../../src/shared/lib/permissions'
import { newPinProblem } from '../../src/shared/lib/pin'
import type { AuthInfo } from '../auth'
import type { Sql } from '../db'
import { getRow, putRow } from '../routes/generic'
import { HttpError } from '../routes/http'

/** Who is working on each signed-in device — decided here, never by the browser:
 * - every person signs in with their own Supabase account: an owner's (public.staff, always
 *   Administrador) or an active user's (public.usuarios.email, with that user's role);
 * - the session is bound to that person (private.counter_sessions) with their role's permissions,
 *   which RLS reads (public.has_perm) before serving costs, profits, the cash ledger, purchasing or
 *   cierres — while every route checks the same permissions itself (`requireNeed`);
 * - someone else's PIN can let one step through ("autorizar") without changing who is working; a PIN
 *   is checked against hashes no browser can read (private.pins), and wrong guesses are rate-limited
 *   per device and store-wide.
 * Every function runs inside the caller's `db.tx`. */

export interface Operator {
  id: string
  name: string
  roleId: string
}

export interface Actor {
  sessionId: string
  /** The person whose account is signed in on that device. */
  operator: Operator
  /** What they may do on their own: their role's permissions. */
  needs: Set<string>
}

/** How long a session stays bound without hearing from the app (it renews it every minute while
 * open). Only a cleanup: the binding is worth nothing without that session's own sign-in. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60

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

const rolesOf = async (q: Sql) => resolveRoles((await settingsOf(q)).roles)

// ------------------------------------------------------------------------------ the account

/** Who signs in with this email: an owner, or the active user it belongs to — else nobody. */
export async function accountOperator(q: Sql, email: string): Promise<Operator | null> {
  if ((await q.query(`select 1 from public.staff where lower(email) = lower($1)`, [email])).length) return ownerOperator()
  const [u] = await q.query<{ data: Usuario }>(
    `select data from public.usuarios where lower(data ->> 'email') = lower($1) and (data -> 'active') = 'true'::jsonb`,
    [email],
  )
  return u ? { id: u.data.id, name: u.data.name, roleId: u.data.role } : null
}

/** Whether this signed-in session may use the store: the account is an owner's or an active user's,
 * and it signed in after the switch to one account per person (private.account_policy) — a session
 * from before (the owner's account left open on a shared device) has to sign in again. A session
 * whose token doesn't say when the password was typed isn't held back (it would loop forever). */
export async function checkAccount(q: Sql, auth: AuthInfo): Promise<void> {
  const [p] = await q.query<{ since: Date }>(`select sessions_since as since from private.account_policy where id = 1`)
  if (p && auth.passwordAt !== null && auth.passwordAt < new Date(p.since).getTime()) {
    throw new HttpError(401, 'Ahora cada persona entra con su propia cuenta: inicia sesión de nuevo', { reauth: true })
  }
  if (!(await accountOperator(q, auth.email))) throw new HttpError(403, 'Esta cuenta no tiene acceso a la tienda')
}

// -------------------------------------------------------------------------------- the actor

/** Who is behind a request: the person whose account is signed in on that device. */
export async function actorOf(q: Sql, auth: AuthInfo): Promise<Actor> {
  const operator = await accountOperator(q, auth.email)
  if (!operator) throw new HttpError(403, 'Esta cuenta no tiene acceso a la tienda')
  return { sessionId: auth.sessionId, operator, needs: new Set(needsOfRole(await rolesOf(q), operator.roleId)) }
}

/** Whether the actor may do it on their own (no approval) — for what a response may show. */
export const allowed = (actor: Actor, need: Need): boolean => actor.needs.has(need)

/** Lets the step through if whoever is working may do it, or if someone allowed approved it on this
 * device with their PIN; otherwise a 403 carrying `need`, so the app can ask for that PIN and retry.
 * Returns who to attribute the step to: the operator, and who authorized it if someone did. */
export async function requireNeed(q: Sql, actor: Actor, need: Need): Promise<string> {
  if (actor.needs.has(need)) return actor.operator.name
  if (need !== 'admin') {
    const [ap] = await q.query<{ approver_name: string }>(
      `select approver_name from private.approvals where session_id = $1 and need = $2 and expires_at > now()`,
      [actor.sessionId, need],
    )
    if (ap) {
      if (SPENT_BY_SALE.has(need)) await q.query(`delete from private.approvals where session_id = $1 and need = $2`, [actor.sessionId, need])
      return `${actor.operator.name} (autorizó ${ap.approver_name})`
    }
  }
  throw new HttpError(403, need === 'admin' ? 'Esto solo lo puede hacer un administrador' : `"${permissionLabel(need)}" necesita la autorización de alguien con permiso`, { need })
}

async function sweep(q: Sql): Promise<void> {
  await q.query(`delete from private.counter_sessions where expires_at < now() - interval '1 day'`)
  await q.query(`delete from private.approvals where expires_at < now()`)
  await q.query(`delete from private.pin_guard where scope <> 'global' and window_start < now() - interval '1 day' and (locked_until is null or locked_until < now())`)
}

/** Binds this session to the person whose account it is (RLS reads it), or renews the binding; the
 * app calls it as it starts and then every minute. Answers who that is, as of now — their name and
 * role follow an admin's edits. */
export async function bindSession(q: Sql, auth: AuthInfo): Promise<Operator> {
  const { operator, needs } = await actorOf(q, auth)
  await sweep(q)
  await q.query(
    `insert into private.counter_sessions (session_id, operator_id, operator_name, role_id, perms, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
     on conflict (session_id) do update set operator_id = excluded.operator_id, operator_name = excluded.operator_name,
       role_id = excluded.role_id, perms = excluded.perms, expires_at = excluded.expires_at`,
    [auth.sessionId, operator.id, operator.name, operator.roleId, [...needs], SESSION_TTL_SECONDS],
  )
  return operator
}

/** The session is ending (signing out): it stops reading anything secret right away. */
export async function signOut(q: Sql, auth: AuthInfo): Promise<void> {
  await q.query(`delete from private.counter_sessions where session_id = $1`, [auth.sessionId])
  await q.query(`delete from private.approvals where session_id = $1`, [auth.sessionId])
}

/** After roles or a user changed: every bound session's permissions follow at once (RLS reads
 * them), and a deactivated or deleted user's sessions lose everything. */
export async function refreshCounterPerms(q: Sql): Promise<void> {
  const roles = await rolesOf(q)
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

// ---------------------------------------------------------------------- PINs: authorizing

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
    store ? 'Demasiados PIN equivocados en la tienda: las autorizaciones con PIN quedaron bloqueadas un rato' : 'Demasiados intentos: espera un momento',
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
    return new HttpError(429, 'Demasiados PIN equivocados en la tienda: las autorizaciones con PIN quedaron bloqueadas un rato', { lockedUntil, storeLock: true })
  }
  if (s.failures % PIN_TRIES === 0) {
    lockedUntil = Date.now() + Math.min(30_000 * 2 ** (s.failures / PIN_TRIES - 1), 15 * 60_000)
    await q.query(`update private.pin_guard set locked_until = $1 where scope = $2`, [new Date(lockedUntil), `session:${sessionId}`])
    return new HttpError(429, 'Demasiados intentos: espera un momento', { lockedUntil })
  }
  return new HttpError(401, 'PIN incorrecto', { attemptsLeft: PIN_TRIES - (s.failures % PIN_TRIES) })
}

const isNeed = (v: unknown): v is Need => v === 'admin' || isPermission(v)

export interface ApproveResult {
  approver?: Operator
  error?: HttpError
}

/** Someone allowed lets one step through on this device without taking it over (a supervisor
 * authorizing a cashier's discount): lockout, PIN, and a named refusal for the right PIN of someone
 * who may not do it — which isn't a wrong guess, so it doesn't count. The master PIN doesn't
 * authorize anything while it's still the factory 1234, which anyone could type. Throw `error`
 * after the transaction commits. */
export async function approve(q: Sql, auth: AuthInfo, pin: unknown, need: unknown): Promise<ApproveResult> {
  if (!isNeed(need) || need === 'admin') throw new HttpError(400, 'Permiso desconocido')
  await assertNotLocked(q, auth.sessionId)
  const approver = isPinShape(pin) ? await pinOwner(q, pin) : null
  if (!approver) return { error: await registerWrongPin(q, auth.sessionId) }
  if (approver.id === OWNER_ID && pin === FACTORY_PIN) {
    return { error: new HttpError(403, 'El PIN maestro sigue siendo 1234: cámbialo en Configuración → Seguridad para poder autorizar con él', { refused: true }) }
  }
  if (!needsOfRole(await rolesOf(q), approver.roleId).includes(need)) return { error: new HttpError(403, `${approver.name} no tiene permiso para esto`, { refused: true }) }
  const seconds = SPENT_BY_SALE.has(need) ? SALE_APPROVAL_SECONDS : APPROVAL_SECONDS
  await q.query(
    `insert into private.approvals (session_id, need, approver_id, approver_name, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     on conflict (session_id, need) do update set approver_id = excluded.approver_id, approver_name = excluded.approver_name, expires_at = excluded.expires_at`,
    [auth.sessionId, need, approver.id, approver.name, seconds],
  )
  return { approver }
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

/** The owner's master PIN (and with it the PIN length of the whole store), changed by an admin —
 * who doesn't need the old one, so it's also how a forgotten one is replaced. It lifts every PIN
 * lockout too. */
export async function changeOwnerPin(q: Sql, actor: Actor, pin: unknown, pinLength: unknown): Promise<void> {
  await requireNeed(q, actor, 'admin')
  const length = pinLength === 6 ? 6 : pinLength === 4 ? 4 : 0
  if (!length) throw new HttpError(400, 'El PIN debe tener 4 o 6 dígitos')
  const value = await assertNewPin(q, pin, length, OWNER_ID)
  await storePin(q, OWNER_ID, value)
  const settings = await settingsOf(q)
  await putRow(q, 'settings', 'key', 'main', { ...settings, pinLength: length, pinChangedAt: new Date().toISOString() })
  await q.query(`delete from private.pin_guard`)
}

export interface SecurityInfo {
  /** The master PIN is still the factory one (1234). */
  ownerPinDefault: boolean
  /** Users who have a PIN to authorize with. */
  pinUserIds: string[]
  /** Users whose PIN someone else also has (only possible in rows saved before PINs had to be unique). */
  sharedPinUserIds: string[]
  ownerSharesPin: boolean
  /** Wrong PINs across the store in the current 24-hour window, and a store-wide lock if one is on. */
  wrongPins24h: number
  lockedUntil: number | null
  /** The owners' sign-in emails (public.staff). */
  ownerEmails: string[]
  /** The server can create accounts and set passwords (it has the Supabase secret key). */
  accountsEnabled: boolean
}

export async function securityInfo(q: Sql, actor: Actor, accountsEnabled: boolean): Promise<SecurityInfo> {
  await requireNeed(q, actor, 'admin')
  const [owner] = await q.query<{ factory: boolean }>(`select hash = private.pin_digest($1) as factory from private.pins where owner_id = 'owner'`, [sha256(FACTORY_PIN)])
  const users = await q.query<{ owner_id: string }>(`select owner_id from private.pins where owner_id like 'user:%'`)
  const shared = await q.query<{ owner_id: string }>(`select owner_id from private.pins where hash in (select hash from private.pins group by hash having count(*) > 1)`)
  const [g] = await q.query<{ failures: number; window_start: Date; locked_until: Date | null }>(`select failures, window_start, locked_until from private.pin_guard where scope = 'global'`)
  const owners = await q.query<{ email: string }>(`select email from public.staff order by created_at, email`)
  const fresh = g && Date.now() - new Date(g.window_start).getTime() < DAY_MS
  const lockedUntil = g?.locked_until && new Date(g.locked_until).getTime() > Date.now() ? new Date(g.locked_until).getTime() : null
  return {
    ownerPinDefault: !owner || owner.factory,
    pinUserIds: users.map((r) => r.owner_id.slice(5)),
    sharedPinUserIds: shared.filter((r) => r.owner_id.startsWith('user:')).map((r) => r.owner_id.slice(5)),
    ownerSharesPin: shared.some((r) => r.owner_id === 'owner'),
    wrongPins24h: fresh ? g.failures : 0,
    lockedUntil,
    ownerEmails: owners.map((r) => r.email),
    accountsEnabled,
  }
}
