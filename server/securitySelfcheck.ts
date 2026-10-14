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

// A form saved after sales were made must not put back the stock it loaded when it opened.
const a1Stock = async () => (await row<{ s: number }>(`select (data ->> 'stock')::float8 as s from products where code = 'A1'`))!.s
const a1Audits = async () => (await row<{ n: number }>(`select count(*)::int as n from "auditLog" where data ->> 'code' = 'A1'`))!.n
const live = await a1Stock()
const auditsA1 = await a1Audits()
r = await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, min: 2, unit: 'unidad', esPaquete: false })
okStatus(r, 'el dueño guarda el producto sin tocar el stock (el formulario no lo manda)')
assert.equal(await a1Stock(), live, 'queda el stock que hay en este momento, no el que traía el formulario')
assert.equal(await a1Audits(), auditsA1, 'y no se registra ningún ajuste')
r = await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, stock: live + 7, min: 2, unit: 'unidad', esPaquete: false })
okStatus(r, 'si lo cambia a propósito, se guarda')
assert.equal(await a1Stock(), live + 7)
assert.equal(await a1Audits(), auditsA1 + 1, 'y deja huella como los demás ajustes')
const formAudit = await row<{ type: string; before: number; after: number; diff: number; user: string }>(
  `select data ->> 'type' as type, (data ->> 'before')::float8 as before, (data ->> 'after')::float8 as after, (data ->> 'diff')::float8 as diff, data ->> 'user' as "user" from "auditLog" where data ->> 'code' = 'A1' order by id desc limit 1`,
)
assert.deepEqual(formAudit, { type: 'ajuste', before: live, after: live + 7, diff: 7, user: 'Propietario' })
okStatus(await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, stock: live, min: 2, unit: 'unidad', esPaquete: false }), 'y lo deja como estaba')

// An import that replaces the stock leaves a trace too, and a file bigger than the Function can finish is refused up front.
const auditsImport = await a1Audits()
r = await post(OWNER, '/api/inventory/import', { parsed: [{ code: 'A1', name: 'Balde grande', price: 0, price2: 0, price3: 0, cost: 0, stock: live + 3, min: 0 }], dupAction: 'update' })
okStatus(r, 'importar actualizando')
assert.equal(await a1Stock(), live + 3)
assert.equal(await a1Audits(), auditsImport + 1, 'cambiar el stock desde un archivo deja huella')
assert.deepEqual(
  await row(`select data ->> 'type' as type, (data ->> 'diff')::float8 as diff, data ->> 'user' as "user" from "auditLog" where data ->> 'code' = 'A1' order by id desc limit 1`),
  { type: 'importacion', diff: 3, user: 'Propietario' },
)
await post(OWNER, '/api/inventory/import', { parsed: [{ code: 'A1', name: 'Balde grande', price: 0, price2: 0, price3: 0, cost: 0, stock: live + 3, min: 0 }], dupAction: 'update' })
assert.equal(await a1Audits(), auditsImport + 1, 'repetir el mismo archivo no vuelve a registrar nada: el stock no cambió')
okStatus(await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, stock: live, min: 2, unit: 'unidad', esPaquete: false }), 'y el stock vuelve a lo que era')
r = await post(OWNER, '/api/inventory/import', { parsed: Array.from({ length: 3001 }, (_, i) => ({ code: `Z${i}`, name: 'x' })), dupAction: 'skip' })
assert.equal(r.status, 400)
assert.match(String(r.body.error), /hasta 3\.000 filas por archivo \(este tiene 3\.001\)/)
r = await post(OWNER, '/api/entradas/bulk', { entries: Array.from({ length: 5001 }, (_, i) => ({ code: `Z${i}`, qty: 1 })) })
assert.equal(r.status, 400)
assert.match(String(r.body.error), /hasta 5\.000 productos por vez/)

// Bulk entries (escaneo masivo) and the cyclic count do their arithmetic in one pass: a code that appears twice
// adds up in order, an unknown one is skipped, and each record shows the stock before and after it.
const b2Stock = async () => (await row<{ s: number }>(`select (data ->> 'stock')::float8 as s from products where code = 'B2'`))!.s
const b2Now = await b2Stock()
const entriesBefore = (await row<{ n: number }>(`select count(*)::int as n from entradas`))!.n
r = await post(OWNER, '/api/entradas/bulk', { source: 'prueba', entries: [{ code: 'A1', qty: 2 }, { code: 'A1', qty: 3 }, { code: 'NOPE', qty: 5 }, { code: 'B2', qty: 1 }] })
okStatus(r, 'escaneo masivo')
assert.equal(r.body.totalUnidades, 6, 'las unidades del código desconocido no cuentan')
assert.equal(await a1Stock(), live + 5)
assert.equal(await b2Stock(), b2Now + 1)
const chain = (await lite.query<{ code: string; antes: number; despues: number; source: string }>(`select data ->> 'code' as code, (data ->> 'stockAntes')::float8 as antes, (data ->> 'stockDespues')::float8 as despues, data ->> 'source' as source from entradas where data ->> 'source' = 'prueba' order by id`)).rows
assert.deepEqual(chain, [
  { code: 'A1', antes: live, despues: live + 2, source: 'prueba' },
  { code: 'A1', antes: live + 2, despues: live + 5, source: 'prueba' },
  { code: 'B2', antes: b2Now, despues: b2Now + 1, source: 'prueba' },
])
assert.equal((await row<{ n: number }>(`select count(*)::int as n from entradas`))!.n, entriesBefore + 3, 'un registro por cada entrada válida')
assert.equal((await row<{ p: number }>(`select (data ->> 'price')::int as p from products where code = 'A1'`))!.p, 2500, 'el resto del producto no se toca')
r = await post(OWNER, '/api/inventory/cyclic-count', {
  adjustments: [
    { code: 'A1', counted: live + 10, reason: 'primero' },
    { code: 'A1', counted: live + 4, reason: 'segundo' },
    { code: 'NOPE', counted: 1, reason: 'no existe' },
    { code: 'B2', counted: b2Now + 1, reason: 'igual' },
  ],
})
okStatus(r, 'conteo cíclico')
assert.equal(r.body.applied, 2, 'se aplican los dos del mismo código; el desconocido y el que no cambia no cuentan')
assert.equal(await a1Stock(), live + 4, 'queda el último conteo')
const counted = (await lite.query<{ type: string; before: number; after: number; reason: string }>(`select data ->> 'type' as type, (data ->> 'before')::float8 as before, (data ->> 'after')::float8 as after, data ->> 'reason' as reason from "auditLog" where data ->> 'reason' in ('primero', 'segundo') order by id`)).rows
assert.deepEqual(counted, [
  { type: 'ajuste', before: live + 5, after: live + 10, reason: 'primero' },
  { type: 'merma', before: live + 10, after: live + 4, reason: 'segundo' },
])
okStatus(await post(OWNER, '/api/products/A1/adjust-stock', { delta: live - (live + 4), reason: 'vuelve a lo de antes' }), 'y deja el stock como estaba')
okStatus(await post(OWNER, '/api/products/B2/adjust-stock', { delta: -1, reason: 'vuelve a lo de antes' }), 'igual con la ponchera')
assert.equal(await a1Stock(), live)
assert.equal(await b2Stock(), b2Now)
ok('Stock: cada acción pide su permiso en el servidor; una autorización vale para un paso en esa sesión y queda firmada por ambos; sin permiso no se fija el costo ni el stock')

// Every change of the stock outside a sale goes to the audit trail: what, from what to what, why, and who.
const tombstonesOf = async (pk: string) => (await lite.query<{ table_name: string }>(`select table_name from deletions where pk = $1 order by table_name`, [pk])).rows.map((x) => x.table_name)
const lastAudit = () =>
  row<{ type: string; code: string; before: number; after: number; reason: string; user: string }>(
    `select data ->> 'type' as type, data ->> 'code' as code, (data ->> 'before')::float8 as before, (data ->> 'after')::float8 as after, data ->> 'reason' as reason, data ->> 'user' as "user" from "auditLog" order by id desc limit 1`,
  )
const audited = (type: string, code: string, before: number, after: number, reason: string) => ({ type, code, before, after, reason, user: 'Propietario' })
const auditsBeforeRefusal = await a1Audits()
r = await post(OWNER, '/api/products/A1/adjust-stock', { delta: 2 })
assert.equal(r.status, 400, 'el ajuste rápido sin motivo no se hace')
assert.match(String(r.body.error), /motivo/)
r = await post(OWNER, '/api/products/A1/adjust-stock', { delta: 2, reason: '   ' })
assert.equal(r.status, 400, 'ni con un motivo en blanco')
assert.equal(await a1Stock(), live)
assert.equal(await a1Audits(), auditsBeforeRefusal)
okStatus(await post(OWNER, '/api/products/A1/adjust-stock', { delta: 2, reason: 'Devolución de un cliente' }), 'con su motivo, sí')
assert.deepEqual(await lastAudit(), audited('ajuste', 'A1', live, live + 2, 'Devolución de un cliente'))
okStatus(await post(OWNER, '/api/products/A1/adjust-stock', { delta: -2, reason: 'Producto dañado' }), 'y para descontar')
assert.deepEqual(await lastAudit(), audited('merma', 'A1', live + 2, live, 'Producto dañado'))
okStatus(await post(OWNER, '/api/entradas', { code: 'A1', qty: 4 }), 'una entrada de mercancía')
assert.deepEqual(await lastAudit(), audited('entrada', 'A1', live, live + 4, 'Entrada de mercancía'))
okStatus(await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, stock: live, min: 2, unit: 'unidad', esPaquete: false, stockReason: 'Conté de nuevo' }), 'el formulario manda el motivo del cambio de stock')
assert.deepEqual(await lastAudit(), audited('merma', 'A1', live + 4, live, 'Conté de nuevo'))
okStatus(await post(OWNER, '/api/products', { code: 'AUD1', name: 'Para auditar', price: 100, stock: 3 }), 'un producto nuevo con existencias')
assert.deepEqual(await lastAudit(), audited('nuevo', 'AUD1', 0, 3, 'Producto creado con existencias'))
okStatus(await call(OWNER, 'DELETE', '/api/products/AUD1'), 'y eliminarlo')
assert.deepEqual(await lastAudit(), audited('eliminado', 'AUD1', 3, 0, 'Producto eliminado del inventario'))
needs(await post(ANA, '/api/products/A1/adjust-stock', { delta: 1, reason: 'prueba' }), 'stock.ajustar', 'quien no puede ajustar sigue sin poder, aunque escriba un motivo')
ok('auditoría: el ajuste rápido exige motivo; ajustes, entradas, el formulario, un producto creado o eliminado con existencias quedan con antes → después, motivo y quién lo hizo')

// Three days of stock movements are kept (today and the two before, in the store's days): the next movement deletes the
// older ones — and every device is told — while a correction of an invoice stays (Reporte's history reads it).
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const oldLine = (reason: string, date: string) => JSON.stringify({ type: 'ajuste', date, code: 'A1', name: 'Balde', before: 1, after: 2, diff: 1, reason, user: 'x' })
await lite.query(`insert into "auditLog" (data) values ($1), ($2), ($3)`, [oldLine('hace 48 horas', hoursAgo(48)), oldLine('hace 72 horas', hoursAgo(72)), oldLine('hace 5 días', hoursAgo(120))])
await lite.query(`insert into "auditLog" (data) values ($1)`, [JSON.stringify({ type: 'correccion_venta', date: hoursAgo(120), saleId: 1, reason: 'corrección vieja', before: { items: [], subtotal: 0, discount: 0, total: 0 }, after: { items: [], subtotal: 0, discount: 0, total: 0 }, totalDiff: 0 })])
const kept = async () => (await lite.query<{ r: string }>(`select data ->> 'reason' as r from "auditLog" where data ->> 'reason' in ('hace 48 horas', 'hace 72 horas', 'hace 5 días', 'corrección vieja') order by id`)).rows.map((x) => x.r)
const oldIds = (await lite.query<{ id: string }>(`select id::text from "auditLog" where data ->> 'reason' in ('hace 72 horas', 'hace 5 días')`)).rows.map((x) => x.id)
okStatus(await post(OWNER, '/api/products/A1/adjust-stock', { delta: 1, reason: 'otro movimiento' }), 'el siguiente movimiento')
assert.deepEqual(await kept(), ['hace 48 horas', 'corrección vieja'], 'se borra lo de antes de anteayer; queda lo de los tres días y la corrección de factura')
for (const id of oldIds) assert.deepEqual(await tombstonesOf(id), ['auditLog'], 'y cada equipo se entera de que se borró')
okStatus(await post(OWNER, '/api/products/A1/adjust-stock', { delta: -1, reason: 'vuelve' }), 'y vuelve')
ok('la auditoría del stock guarda tres días: el siguiente movimiento borra lo más viejo (en todos los equipos) y las correcciones de facturas se conservan')

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
r = await post(OWNER, '/api/sales/finalize', sale([{ code: 'FREE_x1', name: 'Bolsa', price: 300, qty: 1, isFree: true }]))
assert.equal(r.status, 400, 'un producto que no es del inventario (el antiguo "producto libre") ya no se vende, ni siquiera el dueño')
assert.match(String(r.body.error), /"Bolsa" ya no existe en el inventario/)
okStatus(await approve(PEPE, '7310', 'ventas.descuentos'), 'la supervisora autoriza el descuento')
r = await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 })
okStatus(r, 'con la autorización, la venta con descuento pasa')
assert.equal(r.body.sellerName, 'Pepe', 'y es venta de Pepe')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 }), 'ventas.descuentos', 'la autorización se gastó en esa venta')
ok('Ventas: precio, totales y stock se verifican en el servidor y solo se venden productos del inventario; descuento, cambio de total y fiado piden permiso o autorización, que se gasta en una sola venta; la ganancia y el vendedor los pone el servidor')

// Up to three selling prices: Precio 2 and 3 are kept on the product and a sale line may be charged at
// any of the product's prices (the cashier picks on the cart line) — with no permission, since the
// Administrador registered them all — but never at one that isn't registered or was removed.
const stockOf = async (code: string) => (await row<{ s: number }>(`select (data ->> 'stock')::float8 as s from products where code = $1`, [code]))!.s
const extras = async (code: string) => (await row<{ p2: number | null; p3: number | null }>(`select (data ->> 'price2')::int as p2, (data ->> 'price3')::int as p3 from products where code = $1`, [code]))!
const ponchera = async (more: Record<string, unknown>) => ({ code: 'B2', name: 'Ponchera', price: 5000, stock: await stockOf('B2'), min: 0, unit: 'unidad', esPaquete: false, ...more })
r = await put(OWNER, '/api/products/B2', await ponchera({ price2: 4500, price3: 4000 }))
okStatus(r, 'el dueño le pone Precio 2 y Precio 3')
assert.deepEqual([r.body.price2, r.body.price3], [4500, 4000])
assert.deepEqual(await extras('B2'), { p2: 4500, p3: 4000 })
r = await put(BETO, '/api/products/B2', { code: 'B2', name: 'Ponchera', price: 5000, min: 0, unit: 'unidad', esPaquete: false })
okStatus(r, 'una pantalla que no conoce los precios extra guarda el producto')
assert.deepEqual(await extras('B2'), { p2: 4500, p3: 4000 }, 'y no los borra')
r = await post(ANA, '/api/sales/finalize', sale([{ code: 'B2', price: 4500, qty: 1 }]))
okStatus(r, 'la cajera cobra al Precio 2 sin pedir permiso')
assert.equal(r.body.total, 4500)
assert.equal((r.body.items as Array<{ price: number }>)[0].price, 4500)
assert.equal((await row<{ g: number }>(`select (data ->> 'ganancia')::int as g from profits where key = $1`, [`sale:${r.body.id}`]))!.g, 4500 - 3000, 'la ganancia sale del precio al que se cobró')
r = await post(PEPE, '/api/sales/finalize', sale([{ code: 'B2', price: 4000, qty: 2 }]))
okStatus(r, 'y quien no tiene ningún permiso, al Precio 3')
assert.equal(r.body.total, 8000)
r = await post(ANA, '/api/sales/finalize', sale([{ code: 'B2', price: 4200, qty: 1 }]))
assert.equal(r.status, 400, 'un precio que no es de los tres, no')
assert.match(String(r.body.error), /precio de "Ponchera" cambió/)
r = await post(ANA, '/api/sales/finalize', sale([{ code: 'B2', price: 4500, qty: 1 }, { code: 'B2', price: 4200, qty: 1 }]))
assert.equal(r.status, 400, 'ni una línea suelta entre las buenas')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 4000, qty: 1 }]), total: 3500 }), 'ventas.cambiarTotal', 'el Precio 3 no regala cambiar el total')
r = await put(OWNER, '/api/products/B2', await ponchera({ price2: 0 }))
okStatus(r, 'el dueño quita el Precio 2')
assert.equal('price2' in r.body, false)
assert.deepEqual(await extras('B2'), { p2: null, p3: 4000 }, 'y el 3 sigue')
r = await post(ANA, '/api/sales/finalize', sale([{ code: 'B2', price: 4500, qty: 1 }]))
assert.equal(r.status, 400, 'ya no se cobra a un precio que se quitó')
r = await put(OWNER, '/api/products/B2', await ponchera({ price2: -1 }))
assert.equal(r.status, 400, 'un precio negativo no vale')
r = await put(OWNER, '/api/products/B2', await ponchera({ price3: 'abc' }))
assert.equal(r.status, 400, 'ni un texto')
assert.deepEqual(await extras('B2'), { p2: null, p3: 4000 }, 'y lo rechazado no cambia nada')
r = await post(OWNER, '/api/inventory/import', { parsed: [{ code: 'B2', name: 'Ponchera', price: 0, price2: 4400, price3: 0, cost: 0, stock: 0, min: 0 }], dupAction: 'update' })
okStatus(r, 'la importación trae Precio 2')
assert.deepEqual(await extras('B2'), { p2: 4400, p3: 4000 }, 'se pone el Precio 2 y lo que el archivo no trae se queda')
assert.equal((await row<{ p: number }>(`select (data ->> 'price')::int as p from products where code = 'B2'`))!.p, 5000)
okStatus(await put(OWNER, '/api/products/B2', await ponchera({ price2: null, price3: '' })), 'se dejan sin precios extra, como estaban')
assert.deepEqual(await extras('B2'), { p2: null, p3: null })
ok('Varios precios: el producto guarda Precio 2 y 3 (y una pantalla que no los conoce no los borra); se cobra a cualquiera de sus precios sin permiso, a ningún otro, ni a uno ya quitado; lo inválido se rechaza; la importación los trae')

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
needs(await post(ANA, `/api/sales/${saleId}/void`, { reason: 'x' }), 'facturas.corregir', 'ni las anula')
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

// ─── 8c. Changing a product's code ──────────────────────────────────────────────────────────────
// Everything that points at the code follows it — the cost (unseen by whoever may not see costs), the sales that
// sold the product, the purchase orders still open (not the ones already received), a package and its loose
// unit — in one step; the old code is announced to every device as deleted, can be used again, and the change
// is signed in the audit trail.
const salesRows = async () => (await lite.query<{ id: number; data: unknown }>(`select id, data from sales order by id`)).rows
const profitRows = async () => (await lite.query(`select key, data from profits order by key`)).rows
const itemsWith = async (code: string) => (await row<{ n: number }>(`select count(*)::int as n from sales s, jsonb_array_elements(s.data -> 'items') i where i ->> 'code' = $1`, [code]))!.n
const tombstones = async (pk: string) => (await lite.query<{ table_name: string }>(`select table_name from deletions where pk = $1 order by table_name`, [pk])).rows.map((x) => x.table_name)
const costFor = async (code: string) => (await row<{ c: number }>(`select (data ->> 'cost')::int as c from "productCosts" where code = $1`, [code]))?.c
const exists = async (code: string) => (await row(`select 1 from products where code = $1`, [code])) !== undefined
const auditCount = async () => (await row<{ n: number }>(`select count(*)::int as n from "auditLog"`))!.n
const supplierId = (await row<{ id: string }>(`select id from suppliers limit 1`))!.id
const orderLines = async (id: unknown) => (await row<{ codes: string[] }>(`select array(select l ->> 'code' from jsonb_array_elements(data -> 'lines') l) as codes from "purchaseOrders" where id = $1`, [id]))!.codes
const stockB2 = await stockOf('B2')
const full = (more: Record<string, unknown>) => ({ code: 'B2', name: 'Ponchera', price: 5000, stock: stockB2, min: 0, unit: 'unidad', esPaquete: false, ...more })

const closedOrder = (await row<{ id: number }>(`select id from "purchaseOrders" order by id limit 1`))!.id
r = await post(CARLA, '/api/purchaseOrders', { supplierId, lines: [{ code: 'B2', qty: 5, unitCost: 3100 }], send: true })
okStatus(r, 'un pedido enviado (abierto) que pide la ponchera')
const openOrder = r.body.id
r = await post(CARLA, '/api/purchaseOrders', { supplierId, lines: [{ code: 'B2', qty: 2, unitCost: 3100 }] })
okStatus(r, 'y un borrador')
const draftOrder = r.body.id
const salesBefore = await salesRows()
const profitsBefore = await profitRows()
const soldB2 = await itemsWith('B2')
assert.ok(soldB2 >= 3, 'la ponchera ya se vendió varias veces')
assert.equal((await row<{ n: number }>(`select count(*)::int as n from sales where data -> 'items' @> '[{"code":"B2"}]'`))!.n, soldB2, 'una línea de B2 por venta: filas y líneas coinciden')
const costB2 = (await costFor('B2'))!
assert.ok(costB2 > 0)
const audits = await auditCount()

needs(await put(ANA, '/api/products/B2', full({ code: 'B2-NUEVO' })), 'stock.editar', 'una cajera no cambia códigos')
r = await put(BETO, '/api/products/B2', full({ code: '  ' }))
assert.equal(r.status, 400, 'un código vacío no vale')
r = await put(BETO, '/api/products/B2', full({ code: 'X'.repeat(61) }))
assert.equal(r.status, 400, 'ni uno que no cabe (no se corta: podría ser el de otro producto)')
r = await put(BETO, '/api/products/B2', full({ code: 'A1' }))
assert.equal(r.status, 409, 'ni el de otro producto')
assert.match(String(r.body.error), /código ya existe/)
r = await put(BETO, '/api/products/B2', full({ code: 'a1' }))
assert.equal(r.status, 409, 'ni cambiando solo mayúsculas: el lector no las distingue')
assert.equal(await auditCount(), audits, 'y lo rechazado no deja huella ni cambia nada')
assert.equal(await exists('B2'), true)
r = await put(BETO, '/api/products/B2', { name: 'Ponchera', price: 5000, min: 0, unit: 'unidad', esPaquete: false })
okStatus(r, 'una pantalla que no manda el código guarda el producto')
assert.equal(await exists('B2'), true, 'y no lo cambia')
r = await put(BETO, '/api/products/B2', full({ code: 'B2' }))
okStatus(r, 'con el mismo código tampoco')
assert.equal(await auditCount(), audits)

r = await put(BETO, '/api/products/B2', full({ code: '  B2-NUEVO  ' }))
okStatus(r, 'bodega cambia el código (se recorta)')
assert.equal(r.body.code, 'B2-NUEVO')
assert.equal('cost' in r.body, false, 'sin mostrarle el costo que no puede ver')
assert.equal(await exists('B2'), false, 'el código viejo ya no existe')
assert.equal(await stockOf('B2-NUEVO'), stockB2, 'las existencias siguen')
assert.equal(await costFor('B2-NUEVO'), costB2, 'el costo se fue con el producto, sin que nadie lo viera')
assert.equal(await costFor('B2'), undefined, 'y no queda uno huérfano')
assert.equal(await itemsWith('B2'), 0, 'ninguna venta apunta al código viejo')
assert.equal(await itemsWith('B2-NUEVO'), soldB2, 'todas las ventas siguen al nuevo')
assert.deepEqual(await salesRows(), salesBefore.map((s) => ({ id: s.id, data: JSON.parse(JSON.stringify(s.data).replaceAll('"code":"B2"', '"code":"B2-NUEVO"')) })), 'y de las ventas solo cambió el código')
assert.deepEqual(await profitRows(), profitsBefore, 'las ganancias de esas ventas quedan como estaban')
assert.deepEqual(await orderLines(openOrder), ['B2-NUEVO'], 'el pedido abierto pide el código nuevo')
assert.deepEqual(await orderLines(draftOrder), ['B2-NUEVO'], 'el borrador también')
assert.deepEqual(await orderLines(closedOrder), ['B2'], 'el pedido ya recibido es historia y no cambia')
assert.deepEqual(await tombstones('B2'), ['productCosts', 'products'], 'cada equipo se entera de que el código viejo se fue (y su costo)')
assert.deepEqual(await tombstones('B2-NUEVO'), [], 'y del nuevo no se borra nada')
const changed = (await row<{ data: Record<string, unknown> }>(`select data from "auditLog" order by id desc limit 1`))!.data
assert.deepEqual({ ...changed, id: undefined, date: undefined }, { type: 'cambio_codigo', oldCode: 'B2', code: 'B2-NUEVO', name: 'Ponchera', user: 'Beto', ventas: soldB2, pedidos: 2, id: undefined, date: undefined }, 'queda firmado por quien lo hizo')
assert.equal(await auditCount(), audits + 1)
okStatus(await post(CARLA, `/api/purchaseOrders/${openOrder}/receive`, { payment: { mode: 'credito' } }), 'el pedido abierto se recibe con el código nuevo')
assert.equal(await stockOf('B2-NUEVO'), stockB2 + 5, 'y las existencias suben al producto de siempre')
await lite.query(`update products set data = jsonb_set(data, '{stock}', to_jsonb($1::float8)) where code = 'B2-NUEVO'`, [stockB2])

// the old code is free again, for another product, and a device that catches up late won't forget it
r = await post(OWNER, '/api/products', { code: 'B2', name: 'Otra cosa', price: 100, stock: 1 })
okStatus(r, 'el código viejo se puede usar de nuevo')
assert.deepEqual(await tombstones('B2'), [], 'sin dejar el aviso de borrado, que haría desaparecer lo nuevo en un equipo atrasado')
okStatus(await call(OWNER, 'DELETE', '/api/products/B2'), 'se quita el de prueba')

// the package and its loose unit point at each other by code
okStatus(await post(OWNER, '/api/products', { code: 'PQ1', name: 'Paquete', price: 600, stock: 3, esPaquete: true, unidadesPor: 6, codigoSuelta: 'PQ1-S', nombreSuelta: 'Suelta', precioSuelta: 120 }), 'se crea un paquete')
r = await post(OWNER, '/api/products', { code: 'pq1-s', name: 'Intruso', price: 1 })
assert.equal(r.status, 409, 'el código que un paquete guarda para su unidad suelta no se da a otro producto')
assert.match(String(r.body.error), /reservado/)
r = await put(OWNER, '/api/products/B2-NUEVO', full({ code: 'PQ1-S' }))
assert.equal(r.status, 409, 'tampoco cambiando el código de uno')
okStatus(await post(OWNER, '/api/inventory/open-package', { code: 'PQ1', qty: 1 }), 'se abre un paquete')
assert.deepEqual(
  (await lite.query<{ code: string; before: number; after: number; type: string }>(`select data ->> 'code' as code, (data ->> 'before')::float8 as before, (data ->> 'after')::float8 as after, data ->> 'type' as type from "auditLog" order by id desc limit 2`)).rows.reverse(),
  [
    { code: 'PQ1', before: 3, after: 2, type: 'paquete' },
    { code: 'PQ1-S', before: 0, after: 6, type: 'paquete' },
  ],
  'abrir un paquete deja las dos huellas: el paquete que sale y las unidades sueltas que entran',
)
assert.equal((await row<{ p: string }>(`select data ->> 'codigoPaquete' as p from products where code = 'PQ1-S'`))!.p, 'PQ1')
okStatus(await put(OWNER, '/api/products/PQ1', { code: 'PQ9', name: 'Paquete', price: 600, stock: 2, esPaquete: true, unidadesPor: 6, codigoSuelta: 'PQ1-S', nombreSuelta: 'Suelta', precioSuelta: 120 }), 'se cambia el código del paquete')
assert.equal((await row<{ p: string }>(`select data ->> 'codigoPaquete' as p from products where code = 'PQ1-S'`))!.p, 'PQ9', 'su unidad suelta lo sigue')
okStatus(await put(OWNER, '/api/products/PQ1-S', { code: 'PQ9-S', name: 'Suelta', price: 120, stock: 6, unit: 'unidad', esPaquete: false }), 'y el de la unidad suelta')
assert.equal((await row<{ s: string }>(`select data ->> 'codigoSuelta' as s from products where code = 'PQ9'`))!.s, 'PQ9-S', 'el paquete la sigue')
for (const code of ['PQ9', 'PQ9-S']) okStatus(await call(OWNER, 'DELETE', `/api/products/${code}`), `se quita ${code}`)

// back to the first code, now with the owner's typed cost, which replaces the stored one
r = await put(OWNER, '/api/products/B2-NUEVO', full({ code: 'B2', cost: costB2 + 50 }))
okStatus(r, 'el dueño devuelve el código de antes')
assert.equal(r.body.cost, costB2 + 50, 'ella sí ve el costo')
assert.equal(await itemsWith('B2-NUEVO'), 0)
assert.deepEqual(await salesRows(), salesBefore, 'las ventas quedan exactamente como al principio')
assert.deepEqual(await orderLines(draftOrder), ['B2'], 'el borrador, que sigue abierto, vuelve con él')
assert.deepEqual(await orderLines(openOrder), ['B2-NUEVO'], 'y el que se recibió con el código nuevo es historia: se queda como se recibió')
assert.equal(await costFor('B2'), costB2 + 50, 'el costo que ella escribe reemplaza al guardado')
assert.deepEqual(await tombstones('B2'), [], 'y el código que vuelve no queda marcado como borrado')
assert.deepEqual(await tombstones('B2-NUEVO'), ['productCosts', 'products'])
ok('Cambiar el código de un producto: el costo, las ventas, los pedidos abiertos y el paquete con su unidad suelta lo siguen en un solo paso; se rechaza el vacío, el largo, el de otro producto (con o sin mayúsculas) y el reservado de una unidad suelta; el código viejo queda libre, los equipos se enteran y queda firmado')

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
