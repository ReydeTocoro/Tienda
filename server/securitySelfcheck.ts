/** Self-check of the store's security, end to end, on an in-memory Postgres (PGlite) built from the
 * real migrations — never the Supabase data:  npm run check:security
 *
 * - What the migrations do to existing data (costs, profits and PIN hashes leave the public rows;
 *   each user's own account opens the store and the open counter goes) and their emergency rollbacks.
 * - What a browser can read straight from the database (RLS): secret tables only while someone
 *   allowed is signed in, on that very session, once the server bound it.
 * - The real API (Express, same routes as production) attacked by every kind of account — the owner,
 *   a cashier, a supervisor, custom roles, a stranger, a session from before the switch: each
 *   account's role, every permission, PIN approvals and their lockouts, prices and totals of a sale,
 *   and responses that don't leak what the person may not see.
 * Only Supabase Auth is faked: the test says which session and account a request comes from, and
 * the accounts themselves live in memory. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { RequestHandler } from 'express'
import { createApp } from './app'
import type { AuthInfo } from './auth'
import { pgliteDb } from './db'
import { checkAccount, refreshCounterPerms } from './domain/counter'
import type { HttpError } from './routes/http'
import { asBrowser, applyMigration, fakeAccounts, testDatabase } from './testDb'
import { DEFAULT_ROLES, type Role } from '../src/shared/lib/permissions'

let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

// ─── 1. The migration on existing data ──────────────────────────────────────────────────────────
const old = await testDatabase({ until: '20261005000000_permisos_servidor.sql' })
await old.exec(`
insert into public.products (code, data) values ('A1', '{"code":"A1","name":"Balde","price":2000,"cost":1200,"stock":5}');
insert into public.sales (data) values ('{"items":[{"code":"A1","name":"Balde","price":2000,"cost":1200,"qty":1,"isFree":false}],"subtotal":2000,"discount":0,"total":2000,"ganancia":800,"payMethod":"efectivo","date":"2026-10-01T10:00:00Z","dayKey":"2026-10-01"}');
insert into public.usuarios (id, data) values ('u1', '{"id":"u1","name":"Ana","role":"cajero","pinHash":"5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5","active":true}');
insert into public.cierres (data) values ('{"tipo":"Z","fecha":"2026-10-01","totalVentas":2000,"totalGanancia":800}');
insert into public."auditLog" (data) values ('{"type":"correccion_venta","saleId":1,"before":{"items":[{"code":"A1","cost":1200,"price":2000,"qty":1}],"total":2000},"after":{"items":[{"code":"A1","cost":1200,"price":2000,"qty":2}],"total":4000}}');
insert into public."cashSessions" (data) values ('{"status":"abierta","dayKey":"2026-10-01","openedAt":"2026-10-01T08:00:00Z","openedBy":"Ana","openingCash":100}');
`)
const epochBefore = (await old.query<{ value: string }>(`select value from sync_meta where key = 'epoch'`)).rows[0].value
const snapshot = async () => ({
  products: (await old.query(`select data from products order by code`)).rows,
  sales: (await old.query(`select data from sales order by id`)).rows,
  cierres: (await old.query(`select data from cierres order by id`)).rows,
  settings: (await old.query(`select data from settings`)).rows,
})
const before = await snapshot()
await applyMigration(old, '20261005000000_permisos_servidor.sql')
const one = async <T>(sql: string) => (await old.query<T>(sql)).rows[0]
assert.deepEqual((await one<{ data: object }>(`select data from products`)).data, { code: 'A1', name: 'Balde', price: 2000, stock: 5 })
assert.deepEqual((await one<{ data: object }>(`select data from "productCosts"`)).data, { code: 'A1', cost: 1200 })
const migratedSale = (await one<{ data: Record<string, unknown> }>(`select data from sales`)).data
assert.equal('ganancia' in migratedSale, false)
assert.equal(JSON.stringify(migratedSale).includes('cost'), false)
assert.deepEqual((await one<{ data: object }>(`select data from profits where key = 'sale:1'`)).data, { key: 'sale:1', kind: 'sale', refId: 1, dayKey: '2026-10-01', ganancia: 800, itemCosts: [1200] })
assert.equal((await one<{ g: number }>(`select (data ->> 'ganancia')::int as g from profits where key = 'cierre:1'`)).g, 800)
assert.equal(JSON.stringify((await one<{ data: object }>(`select data from "auditLog"`)).data).includes('cost'), false)
assert.equal(JSON.stringify((await one<{ data: object }>(`select data from settings`)).data).includes('pinHash'), false)
assert.equal(JSON.stringify((await one<{ data: object }>(`select data from usuarios`)).data).includes('pinHash'), false)
assert.deepEqual((await old.query(`select owner_id from private.pins order by owner_id`)).rows, [{ owner_id: 'owner' }, { owner_id: 'user:u1' }])
assert.equal((await one<{ open: boolean }>(`select (data ->> 'open')::boolean as open from "cajaState"`)).open, true)
assert.equal((await one<{ value: string }>(`select value from sync_meta where key = 'epoch'`)).value, String(Number(epochBefore) + 1))
ok('la migración saca costos, ganancias y PIN de las filas públicas, abre "cajaState" y obliga a los equipos a descargar todo de nuevo')

// The emergency rollback puts everything back (the PINs excepted: the owner's goes back to 1234).
await old.exec(fs.readFileSync('supabase/rollback/20261005000000_permisos_servidor.down.sql', 'utf8'))
assert.deepEqual(await snapshot(), before, 'costos, ganancias y el PIN de fábrica vuelven a quedar como estaban')
assert.equal((await old.query(`select 1 from information_schema.schemata where schema_name = 'private'`)).rows.length, 0)
assert.equal((await one<{ n: number }>(`select count(*)::int as n from pg_policies where policyname = 'staff can read'`)).n, 16)
await old.close()
ok('la reversión de emergencia (supabase/rollback) devuelve los datos a como estaban')

// ─── 1b. One account per person, on existing data ───────────────────────────────────────────────
const prev = await testDatabase({ until: '20261007000000_cuentas_por_persona.sql' })
await prev.exec(`
insert into public.staff (email, name) values ('dueno@x.com', 'Propietario');
insert into public.usuarios (id, data) values ('u1', '{"id":"u1","name":"Ana","role":"cajero","email":"ana@x.com","active":true}');
insert into public.usuarios (id, data) values ('u2', '{"id":"u2","name":"Beto","role":"cajero","email":"beto@x.com","active":false}');
insert into public.usuarios (id, data) values ('u3', '{"id":"u3","name":"Viejo","role":"cajero","active":true}');
insert into public."productCosts" (code, data) values ('A1', '{"code":"A1","cost":1200}');
update private.access_state set counter_perms = '{costos.ver}';
insert into private.counter_sessions values ('pin-dev', 'u1', 'Ana', 'cajero', '{}', now() + interval '1 hour');
`)
const staffFor = async (lite: typeof prev, email: string) =>
  asBrowser(lite, { email, session_id: 'any', role: 'authenticated' }, async () => (await lite.query<{ ok: boolean }>(`select public.is_staff() as ok`)).rows[0].ok)
const costsFor = async (lite: typeof prev, email: string) =>
  asBrowser(lite, { email, session_id: 'sin-vinculo', role: 'authenticated' }, async () => (await lite.query(`select 1 from "productCosts"`)).rows.length)
assert.equal(await staffFor(prev, 'ana@x.com'), false, 'antes, solo la cuenta del dueño abría la tienda')
assert.equal(await costsFor(prev, 'dueno@x.com'), 1, 'y el mostrador abierto podía tener permisos sin nadie ingresado')
await applyMigration(prev, '20261007000000_cuentas_por_persona.sql')
assert.equal(await staffFor(prev, 'dueno@x.com'), true, 'el dueño sigue entrando')
assert.equal(await staffFor(prev, 'ANA@x.com'), true, 'una usuaria activa entra con su propio correo')
assert.equal(await staffFor(prev, 'beto@x.com'), false, 'un usuario inactivo, no')
assert.equal(await staffFor(prev, 'intruso@x.com'), false, 'ni una cuenta ajena')
assert.equal(await costsFor(prev, 'dueno@x.com'), 0, 'sin una sesión vinculada en el servidor ya no hay nada secreto')
assert.equal((await prev.query(`select 1 from private.counter_sessions`)).rows.length, 0, 'los ingresos con PIN se olvidan')
const since = (await prev.query<{ s: Date }>(`select sessions_since as s from private.account_policy`)).rows[0].s
assert.ok(Math.abs(new Date(since).getTime() - Date.now()) < 60_000, 'las sesiones de antes de este momento deben iniciar de nuevo')
await assert.rejects(() => prev.query(`insert into public.usuarios (id, data) values ('u4', '{"id":"u4","name":"Otra","role":"cajero","email":"Ana@X.com","active":true}')`), /usuarios_email/, 'dos usuarios no comparten correo')
ok('la migración de cuentas por persona: cada usuario activo entra con su correo, el mostrador abierto desaparece y las sesiones de antes deben iniciar de nuevo')

await prev.exec(fs.readFileSync('supabase/rollback/20261007000000_cuentas_por_persona.down.sql', 'utf8'))
assert.equal(await staffFor(prev, 'ana@x.com'), false, 'tras revertir, solo la cuenta del dueño abre la tienda')
assert.equal(await staffFor(prev, 'dueno@x.com'), true)
await prev.query(`update private.access_state set counter_perms = '{costos.ver}'`)
assert.equal(await costsFor(prev, 'dueno@x.com'), 1, 'y el mostrador abierto vuelve a contar')
assert.equal((await prev.query(`select 1 from information_schema.tables where table_schema = 'private' and table_name = 'account_policy'`)).rows.length, 0)
await prev.close()
ok('la reversión de emergencia de cuentas por persona deja la base como la espera la versión anterior')

// ─── The test store and its API ─────────────────────────────────────────────────────────────────
const lite = await testDatabase()
const db = pgliteDb(lite)
const OWNER_EMAIL = 'dueno@x.com'
await lite.exec(`
insert into public.staff (email, name) values ('${OWNER_EMAIL}', 'Propietario');
insert into public.products (code, data) values ('A1', '{"code":"A1","name":"Balde","price":2000,"cost":1200,"stock":50,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}');
insert into public.products (code, data) values ('B2', '{"code":"B2","name":"Ponchera","price":5000,"cost":3000,"stock":50,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}');
`)

/** A signed-in device: its Supabase session, the account's email and, if it says, when that session
 * typed the password. */
interface Device {
  session: string
  email: string
  passwordAt?: number
}

/** Stands in for Supabase Auth's token check (server/auth.ts): the headers say which session and
 * account a request comes from. What the server then checks about that account is the real thing. */
const fakeAuth: RequestHandler = async (req, res, next) => {
  const session = req.header('x-test-session')
  if (!session) return void res.status(401).json({ error: 'Inicia sesión para continuar' })
  const passwordAt = req.header('x-test-password-at')
  const auth: AuthInfo = { sessionId: session, email: req.header('x-test-email') ?? '', passwordAt: passwordAt ? Number(passwordAt) : null }
  try {
    await checkAccount(db, auth)
  } catch (err) {
    const e = err as HttpError
    return void res.status(e.status).json({ ...e.extra, error: e.message })
  }
  req.auth = auth
  next()
}
const accounts = fakeAccounts()
const app = createApp(db, fakeAuth, accounts)
await db.tx(refreshCounterPerms)
const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

interface Reply {
  status: number
  body: Record<string, unknown>
}
async function call(dev: Device, method: string, path: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = { 'x-test-session': dev.session, 'x-test-email': dev.email }
  if (dev.passwordAt !== undefined) headers['x-test-password-at'] = String(dev.passwordAt)
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
}
const post = (d: Device, path: string, body?: unknown) => call(d, 'POST', path, body ?? {})
const put = (d: Device, path: string, body?: unknown) => call(d, 'PUT', path, body ?? {})
/** The request was refused for lack of `need` — the app would ask for an allowed PIN and retry. */
function needs(r: Reply, need: string, label: string) {
  assert.equal(r.status, 403, `${label}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.need, need, label)
}
function okStatus(r: Reply, label: string) {
  assert.ok(r.status >= 200 && r.status < 300, `${label}: ${r.status} ${JSON.stringify(r.body)}`)
}
/** What the app does as it starts, and every minute after. */
const bind = (d: Device) => post(d, '/api/counter/session')
const approve = (d: Device, pin: string, need: string) => post(d, '/api/counter/approve', { pin, need })
/** Rows of a table a browser on that device gets straight from the database. */
const browserRows = (d: Device, table: string) =>
  asBrowser(lite, { email: d.email, session_id: d.session, role: 'authenticated' }, async () => (await lite.query(`select data from public."${table}"`)).rows.length)
const row = async <T>(sql: string, params: unknown[] = []) => (await lite.query<T>(sql, params)).rows[0]

// ─── 2. Accounts ────────────────────────────────────────────────────────────────────────────────
const OWNER: Device = { session: 'dev-owner', email: OWNER_EMAIL }
let r = await bind(OWNER)
okStatus(r, 'el dueño entra con su cuenta')
assert.deepEqual(r.body.operator, { id: 'owner', name: 'Propietario', roleId: 'admin' })
r = await bind({ session: 'dev-x', email: 'intruso@x.com' })
assert.equal(r.status, 403)
assert.match(String(r.body.error), /no tiene acceso/)
r = await bind({ session: 'dev-de-antes', email: OWNER_EMAIL, passwordAt: Date.now() - 60 * 60_000 })
assert.equal(r.status, 401, 'una sesión iniciada antes del cambio a cuentas por persona')
assert.equal(r.body.reauth, true, 'la app pide iniciar sesión de nuevo')
okStatus(await bind({ session: 'dev-recien', email: OWNER_EMAIL, passwordAt: Date.now() }), 'una iniciada después, entra')
assert.equal((await post(OWNER, '/api/counter/sign-in', { pin: '1234' })).status, 404, 'el PIN ya no sirve para entrar')

const restricted: Role = { id: 'practicante', name: 'Practicante', permissions: [] }
const compras: Role = { id: 'compras', name: 'Compras', permissions: ['costos.ver', 'proveedores.gestionar'] }
const bodega: Role = { id: 'bodega', name: 'Bodega', permissions: ['stock.ver', 'stock.editar'] }
okStatus(await put(OWNER, '/api/settings', { roles: [...DEFAULT_ROLES, restricted, compras, bodega] }), 'roles propios')
const mkUser = async (name: string, role: string, pin: string) => {
  const email = `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@x.com`
  const res = await post(OWNER, '/api/usuarios', { name, role, email, password: `${role}-clave-2026`, pin, active: true })
  okStatus(res, `crear ${name}`)
  return { ...(res.body as { id: string }), device: { session: `dev-${email.split('@')[0]}`, email } as Device }
}
const ana = await mkUser('Ana', 'cajero', '4821')
const sofia = await mkUser('Sofía', 'supervisor', '7310')
const pepe = await mkUser('Pepe', 'practicante', '5096')
const carla = await mkUser('Carla', 'compras', '6203')
const beto = await mkUser('Beto', 'bodega', '8142')
assert.deepEqual([...accounts.passwords.keys()].sort(), ['ana@x.com', 'beto@x.com', 'carla@x.com', 'pepe@x.com', 'sofia@x.com'], 'cada uno con su propia cuenta')
const [ANA, SOFIA, PEPE, CARLA, BETO] = [ana.device, sofia.device, pepe.device, carla.device, beto.device]
r = await bind(ANA)
assert.deepEqual(r.body.operator, { id: ana.id, name: 'Ana', roleId: 'cajero' }, 'la cuenta de Ana es Ana, con su rol')
r = await bind({ session: 'dev-ana-2', email: 'ANA@X.com' })
assert.equal((r.body.operator as { name: string }).name, 'Ana', 'el correo no distingue mayúsculas')
for (const d of [SOFIA, PEPE, CARLA, BETO]) okStatus(await bind(d), `entra ${d.email}`)
ok('cada persona entra con su propia cuenta: la del dueño es Administrador, la de cada usuario trae su rol; una cuenta ajena no entra, una sesión de antes del cambio debe iniciar de nuevo y el PIN ya no abre nada')

// ─── 3. PINs authorize one step ─────────────────────────────────────────────────────────────────
r = await approve(PEPE, '1234', 'ventas.descuentos')
assert.equal(r.status, 403, 'el PIN maestro de fábrica no autoriza nada')
assert.match(String(r.body.error), /sigue siendo 1234/)
r = await approve(PEPE, '4821', 'stock.ver')
assert.equal(r.status, 403)
assert.match(String(r.body.error), /Ana no tiene permiso/)
assert.equal(r.body.refused, true)
for (let i = 1; i <= 4; i++) {
  r = await approve(PEPE, '0000', 'ventas.descuentos')
  assert.equal(r.status, 401)
  assert.equal(r.body.attemptsLeft, 5 - i, 'las negativas con nombre no contaron como intentos fallidos')
}
r = await approve(PEPE, '0001', 'ventas.descuentos')
assert.equal(r.status, 429, 'el quinto PIN equivocado bloquea el dispositivo')
assert.ok(Number(r.body.lockedUntil) > Date.now() + 20_000)
assert.equal((await approve(PEPE, '7310', 'ventas.descuentos')).status, 429, 'bloqueado, ni el PIN correcto sirve')
okStatus(await approve({ session: 'dev-pepe-2', email: PEPE.email }, '7310', 'ventas.descuentos'), 'el bloqueo es de ese dispositivo, no de los demás')
await lite.query(`update private.pin_guard set locked_until = now() - interval '1 second' where scope = $1`, [`session:${PEPE.session}`])
for (const pin of ['9999', '9998', '9997', '9996']) assert.equal((await approve(PEPE, pin, 'ventas.descuentos')).status, 401)
r = await approve(PEPE, '9995', 'ventas.descuentos')
assert.equal(r.status, 429)
assert.ok(Number(r.body.lockedUntil) > Date.now() + 50_000, 'el segundo bloqueo dura el doble')
await lite.query(`update private.pin_guard set locked_until = null where scope = $1`, [`session:${PEPE.session}`])
okStatus(await approve(PEPE, '7310', 'ventas.descuentos'), 'pasado el bloqueo, la supervisora autoriza')

let storeLock: Reply | null = null
for (let i = 0; i < 40 && !storeLock; i++) {
  const res = await approve({ session: `dev-bot-${i % 8}`, email: PEPE.email }, String(1000 + i), 'ventas.descuentos')
  if (res.body.storeLock) storeLock = res
}
assert.ok(storeLock, 'muchos PIN equivocados en la tienda bloquean las autorizaciones')
assert.equal((await approve({ session: 'dev-nuevo', email: PEPE.email }, '7310', 'ventas.descuentos')).status, 429, 'en todos los dispositivos, incluso con el PIN correcto')
const during = await call(OWNER, 'GET', '/api/counter/security')
okStatus(during, 'el dueño ve el bloqueo')
assert.ok(Number(during.body.wrongPins24h) >= 30 && Number(during.body.lockedUntil) > Date.now(), 'con los intentos fallidos del día')
assert.equal((await post(OWNER, '/api/counter/recover-owner-pin', { pin: '3691' })).status, 404, 'ya no hay "olvidé el PIN" sin cuenta')
needs(await post(SOFIA, '/api/counter/owner-pin', { pin: '3691', pinLength: 4 }), 'admin', 'solo un administrador pone el PIN maestro')
okStatus(await post(OWNER, '/api/counter/owner-pin', { pin: '2580', pinLength: 4 }), 'el dueño, con su cuenta, pone un PIN maestro nuevo sin saber el anterior')
okStatus(await approve({ session: 'dev-nuevo', email: PEPE.email }, '2580', 'ventas.descuentos'), 'eso quita los bloqueos, y el PIN nuevo autoriza')
await lite.query(`delete from private.approvals`)
ok('los PIN solo autorizan un paso: negativa con nombre que no cuenta, 5 errores bloquean ese dispositivo y 30 en la tienda bloquean todos; el PIN de fábrica no autoriza; el dueño, con su cuenta, pone uno nuevo y quita los bloqueos')

// ─── 4. What a browser can read ─────────────────────────────────────────────────────────────────
assert.equal(await browserRows(ANA, 'products'), 2)
assert.equal(await browserRows(ANA, 'productCosts'), 0, 'la cajera no recibe precios de compra')
assert.equal(await browserRows(OWNER, 'productCosts'), 2, 'el dueño sí, en su dispositivo')
const UNBOUND: Device = { session: 'dev-sin-vincular', email: OWNER_EMAIL }
assert.equal(await browserRows(UNBOUND, 'productCosts'), 0, 'una sesión que el servidor aún no vinculó, no')
assert.equal(await browserRows(UNBOUND, 'products'), 2, 'aunque ve lo de todos')
await lite.query(`update private.counter_sessions set expires_at = now() - interval '1 second' where session_id = $1`, [OWNER.session])
assert.equal(await browserRows(OWNER, 'productCosts'), 0, 'un vínculo vencido deja de recibirlos')
r = await bind(OWNER)
assert.equal((r.body.operator as { name: string }).name, 'Propietario', 'y la app lo renueva sola')
assert.equal(await browserRows(OWNER, 'productCosts'), 2)
okStatus(await post(OWNER, '/api/counter/sign-out'), 'cerrar sesión')
assert.equal(await browserRows(OWNER, 'productCosts'), 0, 'al cerrar sesión, ese dispositivo deja de recibirlos')
await bind(OWNER)
const outsider = await asBrowser(lite, { email: 'intruso@x.com', session_id: OWNER.session }, async () => (await lite.query(`select 1 from products`)).rows.length)
assert.equal(outsider, 0, 'una cuenta que no es de la tienda no ve nada, ni con la sesión de otro')
await assert.rejects(() => asBrowser(lite, null, () => lite.query(`select 1 from products`)), /permission denied/, 'sin sesión, nada')
const anaClaims = { email: ANA.email, session_id: ANA.session }
await assert.rejects(() => asBrowser(lite, anaClaims, () => lite.query(`select * from private.pins`)), /permission denied/, 'los PIN no se leen')
await assert.rejects(() => asBrowser(lite, anaClaims, () => lite.query(`select * from private.counter_sessions`)), /permission denied/)
await assert.rejects(() => asBrowser(lite, anaClaims, () => lite.query(`select * from private.account_policy`)), /permission denied/)
await assert.rejects(() => asBrowser(lite, anaClaims, () => lite.query(`update products set data = data`)), /permission denied/, 'el navegador no escribe')
await assert.rejects(() => asBrowser(lite, anaClaims, () => lite.query(`update usuarios set data = data || '{"role":"admin"}'`)), /permission denied/, 'ni se cambia el rol')
await assert.rejects(
  () => asBrowser(lite, anaClaims, () => lite.query(`insert into private.counter_sessions values ('${ANA.session}', 'owner', 'x', 'admin', '{costos.ver}', now() + interval '1 hour')`)),
  /permission denied/,
  'ni puede ponerse permisos a sí misma',
)
ok('desde el navegador: costos solo con alguien autorizado en esa misma sesión, ya vinculada; nada para vínculos vencidos o cerrados, cuentas ajenas o sin sesión; PIN y sesiones ilegibles; ninguna escritura')

// ─── 5. Stock ───────────────────────────────────────────────────────────────────────────────────
needs(await post(PEPE, '/api/products', { code: 'C3', name: 'Tina', price: 9000, cost: 1 }), 'stock.editar', 'sin permiso no crea productos')
needs(await post(ANA, '/api/products/A1/adjust-stock', { delta: 5 }), 'stock.ajustar', 'la cajera no ajusta existencias')
needs(await call(ANA, 'DELETE', '/api/products/A1'), 'stock.eliminar', 'ni borra productos')
needs(await post(ANA, '/api/entradas', { code: 'A1', qty: 3 }), 'stock.entradas', 'ni registra entradas')
needs(await post(ANA, '/api/inventory/import', { parsed: [], dupAction: 'skip' }), 'stock.importar', 'ni importa')
needs(await post(ANA, '/api/inventory/cyclic-count', { adjustments: [] }), 'stock.ajustar', 'ni hace conteos')
needs(await post(ANA, '/api/inventory/open-package', { code: 'A1', qty: 1 }), 'stock.ajustar', 'ni abre paquetes')
r = await approve(PEPE, '4821', 'stock.editar')
assert.equal(r.status, 403, 'la cajera no puede autorizar lo que ella misma no puede hacer')
okStatus(await approve(PEPE, '7310', 'stock.editar'), 'la supervisora autoriza crear un producto')
r = await post(PEPE, '/api/products', { code: 'C3', name: 'Tina', price: 9000, cost: 4000, stock: 2 })
okStatus(r, 'con su autorización, Pepe crea el producto')
assert.equal('cost' in r.body, false, 'sin el costo: quien trabaja no puede ver ni fijar precios de compra')
assert.equal(await row(`select 1 from "productCosts" where code = 'C3'`), undefined)
needs(await post(ANA, '/api/products', { code: 'D4', name: 'Otro', price: 1 }), 'stock.editar', 'la autorización era para la sesión de Pepe, no para otra')
okStatus(await approve(PEPE, '7310', 'stock.ajustar'), 'la supervisora autoriza un conteo')
okStatus(await post(PEPE, '/api/inventory/cyclic-count', { adjustments: [{ code: 'B2', counted: 49, reason: 'roto' }] }), 'Pepe cuenta')
assert.equal((await row<{ u: string }>(`select data ->> 'user' as u from "auditLog" order by id desc limit 1`))!.u, 'Pepe (autorizó Sofía)', 'queda a nombre de quien lo hizo y de quien lo autorizó')

r = await put(BETO, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, cost: 1, stock: 999, min: 2, unit: 'unidad', esPaquete: false })
okStatus(r, 'bodega edita el producto')
assert.equal(r.body.stock, 50, 'sin "ajustar existencias", el stock queda como estaba')
assert.equal((await row<{ c: number }>(`select (data ->> 'cost')::int as c from "productCosts" where code = 'A1'`))!.c, 1200, 'y el precio de compra también')
assert.equal((await row<{ p: number }>(`select (data ->> 'price')::int as p from products where code = 'A1'`))!.p, 2500)
r = await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, cost: 1300, stock: 50, min: 2 })
okStatus(r, 'el dueño cambia el precio de compra')
assert.equal(r.body.cost, 1300)
assert.equal((await row<{ c: number }>(`select (data ->> 'cost')::int as c from "productCosts" where code = 'A1'`))!.c, 1300)
ok('Stock: cada acción pide su permiso en el servidor; una autorización vale para un paso en esa sesión y queda firmada por ambos; sin permiso no se fija el costo ni el stock')

// ─── 6. Sales ───────────────────────────────────────────────────────────────────────────────────
const sale = (items: Array<{ code: string; price: number; qty: number; isFree?: boolean; name?: string }>, extra: Record<string, unknown> = {}) => {
  const lines = items.map((i) => ({ name: i.name ?? i.code, brand: '', unit: 'unidad', isFree: false, ...i }))
  const subtotal = lines.reduce((a, i) => a + i.price * i.qty, 0)
  return { items: lines, subtotal, discount: 0, total: subtotal, payMethod: 'efectivo', ...extra }
}
r = await post(ANA, '/api/sales/finalize', { ...sale([{ code: 'A1', price: 2500, qty: 2 }]), sellerId: 'owner', sellerName: 'Propietario' })
okStatus(r, 'la cajera vende')
assert.equal(r.body.sellerName, 'Ana', 'la venta queda a nombre de la cuenta que la hizo, no de lo que diga el navegador')
assert.equal('ganancia' in r.body, false, 'la respuesta no trae la ganancia')
const saleId = r.body.id as number
assert.equal((await row<{ g: number }>(`select (data ->> 'ganancia')::int as g from profits where key = $1`, [`sale:${saleId}`]))!.g, (2500 - 1300) * 2, 'la ganancia se calcula en el servidor con el costo real')
r = await post(ANA, '/api/sales/finalize', sale([{ code: 'A1', price: 100, qty: 1 }]))
assert.equal(r.status, 400)
assert.match(String(r.body.error), /precio de "Balde grande" cambió/, 'no se puede vender a un precio inventado')
r = await post(ANA, '/api/sales/finalize', { ...sale([{ code: 'A1', price: 2500, qty: 1 }]), subtotal: 100, total: 100 })
assert.equal(r.status, 400, 'ni con totales que no cuadran')
r = await post(ANA, '/api/sales/finalize', sale([{ code: 'A1', price: 2500, qty: 1000 }]))
assert.match(String(r.body.error), /Stock insuficiente/)

needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 }), 'ventas.descuentos', 'descuento')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), total: 4000 }), 'ventas.cambiarTotal', 'cambiar el total')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), payMethod: 'fiado', fiadoName: 'Don José' }), 'ventas.fiar', 'fiar')
needs(await post(PEPE, '/api/sales/finalize', sale([{ code: 'FREE_x1', name: 'Bolsa', price: 300, qty: 1, isFree: true }])), 'ventas.productoLibre', 'producto sin registrar')
okStatus(await approve(PEPE, '7310', 'ventas.descuentos'), 'la supervisora autoriza el descuento')
r = await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 })
okStatus(r, 'con la autorización, la venta con descuento pasa')
assert.equal(r.body.sellerName, 'Pepe', 'y es venta de Pepe')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 }), 'ventas.descuentos', 'la autorización se gastó en esa venta')
ok('Ventas: precio, totales y stock se verifican en el servidor; descuento, cambio de total, fiado y producto libre piden permiso o autorización, que se gasta en una sola venta; la ganancia y el vendedor los pone el servidor')

r = await post(OWNER, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), payMethod: 'fiado', fiadoName: 'Don José' })
okStatus(r, 'el dueño fía')
const fiadoId = r.body.id as number
needs(await post(ANA, `/api/sales/${fiadoId}/pagos`, { amount: 1000, note: '' }), 'fiados.abonar', 'la cajera no recibe abonos')
needs(await post(ANA, `/api/sales/${fiadoId}/pagar-completo`, { condone: true }), 'fiados.condonar', 'ni condona')
r = await post(OWNER, `/api/sales/${fiadoId}/pagos`, { amount: 99_999, note: '' })
assert.match(String(r.body.error), /supera la deuda/, 'no se abona más de lo que se debe')
r = await post(OWNER, `/api/sales/${saleId}/pagar-completo`, {})
assert.match(String(r.body.error), /no es un fiado/, 'una venta de contado no se "paga" otra vez')
needs(await put(ANA, `/api/sales/${saleId}/correct`, { newItems: [], reason: 'x' }), 'facturas.corregir', 'la cajera no corrige facturas')
ok('Fiados y facturas: abonar, condonar y corregir piden su permiso; no se abona de más ni se cobra dos veces una venta de contado')

// ─── 7. Caja ────────────────────────────────────────────────────────────────────────────────────
needs(await post(PEPE, '/api/cash/open', { countedCash: 50_000 }), 'caja.abrir', 'abrir la caja')
needs(await post(ANA, '/api/cash/open', { countedCash: 50_000, mayorInitial: 100_000 }), 'caja.gestionar', 'el saldo inicial de la Caja Mayor es de quien gestiona las cajas')
okStatus(await post(OWNER, '/api/cash/open', { countedCash: 50_000 }), 'el dueño inicia las cajas')
await lite.query(`update "cashSessions" set data = data || '{"status":"cerrada"}'`)
r = await post(ANA, '/api/cash/open', { countedCash: 40_000, by: 'Otra' })
okStatus(r, 'la cajera abre la caja contando el efectivo')
assert.equal('systemAtOpen' in r.body || 'openDiff' in r.body, false, 'a ciegas: la respuesta no dice cuánto esperaba el sistema ni la diferencia')
assert.equal(r.body.openedBy, 'Ana', 'a nombre de quien entró, no de lo que diga el navegador')
assert.equal(await browserRows(ANA, 'cashMovements'), 0, 'ni puede leer el libro de caja')
assert.equal(await browserRows(ANA, 'cashSessions'), 0)
assert.equal(await browserRows(ANA, 'cajaState'), 1, 'pero sí sabe que la caja está abierta')
needs(await post(ANA, '/api/cash/movement', { caja: 'menor', direction: 'out', amount: 100, concept: 'x' }), 'caja.gestionar', 'gastos de caja')
needs(await post(ANA, '/api/cash/transfer', { from: 'menor', to: 'mayor', amount: 100 }), 'caja.gestionar', 'traslados')
needs(await post(ANA, '/api/cierres', { dayKey: new Date().toISOString().slice(0, 10), cajero: 'Ana', notas: '', efectivoFisico: 1 }), 'caja.cerrar', 'cierre')
okStatus(await approve(ANA, '7310', 'caja.cerrar'), 'la supervisora autoriza el cierre')
const today = (await row<{ d: string }>(`select data ->> 'dayKey' as d from "cashSessions" order by id desc limit 1`))!.d
r = await post(ANA, '/api/cierres', { dayKey: today, cajero: 'Otra', notas: '', efectivoFisico: 45_000 })
okStatus(r, 'la cajera cierra a ciegas')
assert.equal(r.body.cajero, 'Ana', 'firmado por quien entró con su cuenta')
assert.equal('arqueo' in r.body || 'totalGanancia' in r.body || 'dejadoEnCaja' in r.body, false, 'la respuesta no trae el arqueo ni la ganancia')
assert.equal(await browserRows(ANA, 'cierres'), 0, 'ni puede leer los cierres')
assert.equal(await browserRows(SOFIA, 'cierres'), 1, 'la supervisora (Reportes) sí')
assert.equal(await browserRows(SOFIA, 'profits'), 0, 'pero no las ganancias')
assert.equal(await browserRows(SOFIA, 'productCosts'), 0, 'ni los costos')
ok('Caja: abrir pide permiso y es a ciegas (ni la respuesta ni la base de datos le dicen lo esperado); gastos, traslados y cierre piden permiso; todo queda firmado por la cuenta que trabaja')

// ─── 8. Proveedores, settings, users ────────────────────────────────────────────────────────────
needs(await post(SOFIA, '/api/suppliers', { name: 'X', paymentTerms: { kind: 'contado' } }), 'proveedores.gestionar', 'la supervisora no gestiona proveedores')
r = await post(CARLA, '/api/suppliers', { name: 'Distri', paymentTerms: { kind: 'credito', days: 30 } })
okStatus(r, 'compras crea un proveedor')
const order = await post(CARLA, '/api/purchaseOrders', { supplierId: r.body.id, lines: [{ code: 'B2', qty: 10, unitCost: 3100 }], send: true })
okStatus(order, 'y un pedido')
okStatus(await post(CARLA, `/api/purchaseOrders/${order.body.id}/receive`, { payment: { mode: 'credito' } }), 'lo recibe a crédito')
const payable = await row<{ id: number }>(`select id from payables limit 1`)
r = await post(CARLA, `/api/payables/${payable!.id}/pay`, { amount: 31_000, caja: 'mayor' })
assert.equal(r.status, 400)
assert.match(String(r.body.error), /Saldo insuficiente/)
assert.equal(/hay \$/.test(String(r.body.error)), false, 'sin "ver el efectivo esperado", el error no dice cuánto hay en la caja')
assert.equal(await browserRows(CARLA, 'purchaseOrders'), 1)
assert.equal(await browserRows(CARLA, 'cashMovements'), 0)
needs(await put(ANA, '/api/settings', { storeName: 'Hackeada' }), 'admin', 'la cajera no cambia los ajustes')
okStatus(await put(ANA, '/api/settings', { theme: 'dark' }), 'el tema sí')
needs(await post(SOFIA, '/api/usuarios', { name: 'Intruso', role: 'admin', email: 'intruso@x.com', password: 'una-clave-123', active: true }), 'admin', 'la supervisora no crea usuarios')
needs(await put(SOFIA, `/api/usuarios/${sofia.id}`, { name: 'Sofía', role: 'admin', active: true }), 'admin', 'ni se sube de rol')
needs(await call(SOFIA, 'GET', '/api/counter/security'), 'admin', 'ni ve la seguridad')
r = await approve(PEPE, '2580', 'admin')
assert.equal(r.status, 400, 'lo de administrador no se "autoriza": un administrador entra con su cuenta')
r = await call(OWNER, 'GET', '/api/counter/security')
okStatus(r, 'el dueño ve la seguridad')
assert.equal(r.body.ownerPinDefault, false)
assert.equal(r.body.lockedUntil, null, 'el bloqueo ya se levantó')
assert.deepEqual(r.body.owners, [{ email: OWNER_EMAIL, name: 'Propietario' }])
assert.equal(r.body.accountsEnabled, true)
assert.ok((r.body.pinUserIds as string[]).includes(ana.id))
ok('Proveedores, ajustes y usuarios: cada uno pide su permiso; un error de pago no revela el saldo; lo de administrador exige la cuenta de un administrador')

// The owner's name — the one on their `staff` row until the Administrador types another — and profile pictures.
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/' + 'A'.repeat(200)
const nameOf = async (d: Device) => ((await bind(d)).body.operator as { name: string }).name
assert.equal(await nameOf(OWNER), 'Propietario', 'sin nada más, el nombre que trae su fila de staff')
await lite.query(`update public.staff set name = 'Franci Rojas Samboni' where email = $1`, [OWNER_EMAIL])
assert.equal(await nameOf(OWNER), 'Franci Rojas Samboni', 'con otro nombre en staff, ese es el suyo')
r = await post(OWNER, '/api/sales/finalize', sale([{ code: 'B2', price: 5000, qty: 1 }]))
okStatus(r, 'el dueño vende')
assert.equal(r.body.sellerName, 'Franci Rojas Samboni', 'y la venta lleva su nombre')
okStatus(await approve(PEPE, '2580', 'stock.ajustar'), 'su PIN maestro autoriza')
okStatus(await post(PEPE, '/api/inventory/cyclic-count', { adjustments: [{ code: 'B2', counted: 40, reason: 'conteo' }] }), 'un conteo en la sesión de Pepe')
assert.equal((await row<{ u: string }>(`select data ->> 'user' as u from "auditLog" order by id desc limit 1`))!.u, 'Pepe (autorizó Franci Rojas Samboni)', 'queda a nombre de quien autorizó')
needs(await put(ANA, '/api/settings', { owner: { name: 'Otra' } }), 'admin', 'solo un administrador cambia los datos del propietario')
okStatus(await put(OWNER, '/api/settings', { owner: { name: 'Doña Franci', photo: PHOTO } }), 'el administrador escribe su nombre y su foto')
assert.equal(await nameOf(OWNER), 'Doña Franci', 'lo escrito en Configuración gana al de staff')
assert.equal((await row<{ p: string }>(`select data -> 'owner' ->> 'photo' as p from settings`))!.p, PHOTO, 'la foto viaja con los ajustes a todos los equipos')
r = await put(OWNER, '/api/settings', { owner: { name: 'Doña Franci', photo: 'data:image/svg+xml;base64,PHN2Zz4=' } })
assert.equal(r.status, 400, 'una foto que no es JPEG, no')
assert.match(String(r.body.error), /foto no es válida/)
const lola = await post(OWNER, '/api/usuarios', { name: 'Lola', role: 'cajero', email: 'lola@x.com', password: 'cajero-clave-2026', photo: PHOTO, active: true })
okStatus(lola, 'se crea un usuario con foto')
assert.equal(lola.body.photo, PHOTO)
assert.equal(await browserRows(ANA, 'usuarios'), 6, 'todos los equipos reciben la lista con las fotos')
r = await post(OWNER, '/api/usuarios', { name: 'Mala', role: 'cajero', email: 'mala@x.com', password: 'cajero-clave-2026', photo: 'javascript:alert(1)', active: true })
assert.equal(r.status, 400, 'una foto inválida no deja crear al usuario')
assert.equal(accounts.passwords.has('mala@x.com'), false, 'ni su cuenta')
okStatus(await call(OWNER, 'DELETE', `/api/usuarios/${lola.body.id}`), 'se borra el de prueba')
ok('el nombre del propietario sale de staff o de lo que escribe en Configuración, y firma sus ventas y autorizaciones; las fotos (suyas y de los usuarios) se validan en el servidor')

// ─── 9. Permissions follow every change at once ─────────────────────────────────────────────────
assert.equal(await browserRows(CARLA, 'productCosts'), 2, 'Compras recibe los costos (C3 se creó sin costo)')
okStatus(await put(OWNER, '/api/settings', { roles: [...DEFAULT_ROLES, restricted, { ...compras, permissions: [] }, bodega] }), 'el dueño le quita los permisos a Compras')
assert.equal(await browserRows(CARLA, 'productCosts'), 0, 'Carla deja de recibir costos sin tener que volver a entrar')
needs(await post(CARLA, '/api/suppliers', { name: 'Y', paymentTerms: { kind: 'contado' } }), 'proveedores.gestionar', 'ni gestiona proveedores')
okStatus(await put(OWNER, `/api/usuarios/${sofia.id}`, { name: 'Sofía', role: 'cajero', active: true }), 'Sofía pasa a Cajero')
assert.equal(await browserRows(SOFIA, 'cierres'), 0, 'y deja de ver los cierres al instante')
assert.equal(((await bind(SOFIA)).body.operator as { roleId: string }).roleId, 'cajero', 'su app lo sabe en el siguiente minuto')

okStatus(await put(OWNER, `/api/usuarios/${beto.id}`, { name: 'Beto', role: 'bodega', active: false }), 'el dueño desactiva a Beto')
r = await bind(BETO)
assert.equal(r.status, 403, 'Beto queda fuera')
assert.match(String(r.body.error), /no tiene acceso/)
r = await put(BETO, '/api/products/A1', { code: 'A1', name: 'x', price: 1 })
assert.equal(r.status, 403, 'ni escribe nada')
assert.equal(await browserRows(BETO, 'products'), 0, 'ni ve nada desde su navegador')
assert.equal(await row(`select 1 from private.counter_sessions where session_id = $1`, [BETO.session]), undefined, 'su sesión pierde el vínculo')
okStatus(await put(OWNER, `/api/usuarios/${beto.id}`, { name: 'Beto', role: 'bodega', active: true }), 'reactivarlo')
okStatus(await bind(BETO), 'y vuelve a entrar con la misma cuenta')

okStatus(await put(OWNER, `/api/usuarios/${ana.id}`, { name: 'Ana', role: 'cajero', email: 'ana.m@x.com', active: true }), 'el dueño cambia el correo de Ana')
assert.equal(accounts.passwords.has('ana@x.com'), false, 'su cuenta pasa al correo nuevo')
assert.equal(accounts.passwords.get('ana.m@x.com'), 'cajero-clave-2026', 'con la misma contraseña')
assert.equal((await bind(ANA)).status, 403, 'la sesión con el correo viejo ya no sirve')
const ANA_NEW: Device = { session: 'dev-ana-nueva', email: 'ana.m@x.com' }
assert.equal(((await bind(ANA_NEW)).body.operator as { name: string }).name, 'Ana', 'con el nuevo, entra')
okStatus(await call(OWNER, 'DELETE', `/api/usuarios/${ana.id}`), 'el dueño borra a Ana')
assert.equal(accounts.passwords.has('ana.m@x.com'), false, 'y con ella su cuenta')
assert.equal((await bind(ANA_NEW)).status, 403, 'queda fuera en todas partes')
assert.equal((await approve(PEPE, '4821', 'ventas.descuentos')).status, 401, 'su PIN ya no autoriza')

const gerente = await mkUser('Gerente', 'admin', '3692')
okStatus(await bind(gerente.device), 'un usuario Administrador entra con su cuenta')
okStatus(await put(gerente.device, '/api/settings', { storeName: 'Plastimax' }), 'y administra la tienda')
r = await call(gerente.device, 'DELETE', `/api/usuarios/${gerente.id}`)
assert.equal(r.status, 409, 'pero no se elimina a sí mismo')
r = await put(gerente.device, `/api/usuarios/${gerente.id}`, { name: 'Gerente', role: 'admin', active: false })
assert.equal(r.status, 409, 'ni se desactiva')
ok('los permisos siguen al instante los cambios de roles y de usuarios, también en lo que el navegador puede leer: desactivar, cambiar el correo o borrar a alguien lo saca de todas partes')

server.close()
await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones de seguridad pasaron.`)
