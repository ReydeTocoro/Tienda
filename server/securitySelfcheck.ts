/** Self-check of the store's security, end to end, on an in-memory Postgres (PGlite) built from the
 * real migrations — never the Supabase data:  npm run check:security
 *
 * - What the migration does to existing data (costs, profits and PIN hashes leave the public rows).
 * - What a browser can read straight from the database (RLS): secret tables only while someone
 *   allowed is signed in on that very device.
 * - The real API (Express, same routes as production) attacked as the open counter, a cashier, a
 *   supervisor and the owner: PIN checks and lockouts, every permission, approvals, prices and totals
 *   of a sale, and responses that don't leak what the person may not see.
 * Only the Supabase login is faked: the test says which device session a request comes from. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { RequestHandler } from 'express'
import { createApp } from './app'
import { pgliteDb } from './db'
import { refreshCounterPerms } from './domain/counter'
import { asBrowser, applyMigration, testDatabase } from './testDb'
import { DEFAULT_ROLES, type Role } from '../src/shared/lib/permissions'

let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)
const STAFF = 'tienda@x.com'

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

// ─── The test store and its API ─────────────────────────────────────────────────────────────────
const lite = await testDatabase()
const db = pgliteDb(lite)
await lite.exec(`
insert into public.staff (email, name) values ('${STAFF}', 'Tienda');
insert into public.products (code, data) values ('A1', '{"code":"A1","name":"Balde","price":2000,"cost":1200,"stock":50,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}');
insert into public.products (code, data) values ('B2', '{"code":"B2","name":"Ponchera","price":5000,"cost":3000,"stock":50,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}');
`)

/** Stands in for Supabase Auth: `x-test-session` is the device's session, `x-test-password-at` when
 * that session last typed the account password. */
const fakeAuth: RequestHandler = (req, res, next) => {
  const session = req.header('x-test-session')
  if (!session) return void res.status(401).json({ error: 'Inicia sesión para continuar' })
  const passwordAt = req.header('x-test-password-at')
  req.auth = { sessionId: session, email: STAFF, passwordAt: passwordAt ? Number(passwordAt) : null }
  next()
}
const app = createApp(db, fakeAuth)
await db.tx(refreshCounterPerms)
const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

interface Reply {
  status: number
  body: Record<string, unknown>
}
async function call(session: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(base + path, {
    method,
    headers: { 'x-test-session': session, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
}
const post = (s: string, path: string, body?: unknown, headers?: Record<string, string>) => call(s, 'POST', path, body ?? {}, headers)
const put = (s: string, path: string, body?: unknown) => call(s, 'PUT', path, body ?? {})
/** The request was refused for lack of `need` — the app would ask for an allowed PIN and retry. */
function needs(r: Reply, need: string, label: string) {
  assert.equal(r.status, 403, `${label}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.need, need, label)
}
function okStatus(r: Reply, label: string) {
  assert.ok(r.status >= 200 && r.status < 300, `${label}: ${r.status} ${JSON.stringify(r.body)}`)
}
const signIn = (s: string, pin: string, need?: string) => post(s, '/api/counter/sign-in', { pin, need })
/** Rows of a table a browser on device `session` gets straight from the database. */
const browserRows = (session: string, table: string) =>
  asBrowser(lite, { email: STAFF, session_id: session, role: 'authenticated' }, async () => (await lite.query(`select data from public."${table}"`)).rows.length)
const row = async <T>(sql: string, params: unknown[] = []) => (await lite.query<T>(sql, params)).rows[0]

// ─── 2. PINs ────────────────────────────────────────────────────────────────────────────────────
const OWNER = 'dev-owner'
let r = await signIn(OWNER, '1234')
okStatus(r, 'el dueño entra con el PIN de fábrica')
assert.equal((r.body.operator as { id: string }).id, 'owner')
assert.equal(r.body.mustChangePin, true, 'y la app le pide cambiarlo')
okStatus(await post(OWNER, '/api/counter/owner-pin', { pin: '2580', pinLength: 4 }), 'cambia el PIN maestro')
r = await signIn('dev-x', '1234')
assert.equal(r.status, 401)
assert.equal(r.body.attemptsLeft, 4)
ok('el PIN se verifica en el servidor: el de fábrica obliga a cambiarlo, y el viejo deja de servir')

// Users, created by the owner through the API
const restricted: Role = { id: 'practicante', name: 'Practicante', permissions: [] }
const compras: Role = { id: 'compras', name: 'Compras', permissions: ['costos.ver', 'proveedores.gestionar'] }
const bodega: Role = { id: 'bodega', name: 'Bodega', permissions: ['stock.ver', 'stock.editar'] }
okStatus(await put(OWNER, '/api/settings', { roles: [...DEFAULT_ROLES, restricted, compras, bodega] }), 'roles propios')
const mkUser = async (name: string, role: string, pin: string) => {
  const res = await post(OWNER, '/api/usuarios', { name, role, pin, active: true })
  okStatus(res, `crear ${name}`)
  return res.body as { id: string }
}
const ana = await mkUser('Ana', 'cajero', '4821')
await mkUser('Sofía', 'supervisor', '7310')
await mkUser('Pepe', 'practicante', '5096')
await mkUser('Carla', 'compras', '6203')
const beto = await mkUser('Beto', 'bodega', '8142')

const CAJERA = 'dev-cajera'
r = await signIn(CAJERA, '4821', 'stock.ver')
assert.equal(r.status, 403)
assert.match(String(r.body.error), /Ana no tiene permiso/)
assert.equal(r.body.refused, true)
for (let i = 1; i <= 4; i++) {
  r = await signIn(CAJERA, '0000')
  assert.equal(r.status, 401)
  assert.equal(r.body.attemptsLeft, 5 - i, 'la negativa con nombre no contó como intento fallido')
}
r = await signIn(CAJERA, '0001')
assert.equal(r.status, 429, 'el quinto PIN equivocado bloquea el dispositivo')
assert.ok(Number(r.body.lockedUntil) > Date.now() + 20_000)
assert.equal((await signIn(CAJERA, '4821')).status, 429, 'bloqueado, ni el PIN correcto entra')
okStatus(await signIn('dev-otro', '4821'), 'el bloqueo es de ese dispositivo, no de los demás')
await lite.query(`update private.pin_guard set locked_until = now() - interval '1 second' where scope = $1`, [`session:${CAJERA}`])
r = await signIn(CAJERA, '9999')
assert.equal(r.status, 401)
r = await signIn(CAJERA, '9998')
r = await signIn(CAJERA, '9997')
r = await signIn(CAJERA, '9996')
r = await signIn(CAJERA, '9995')
assert.equal(r.status, 429)
assert.ok(Number(r.body.lockedUntil) > Date.now() + 50_000, 'el segundo bloqueo dura el doble')
await lite.query(`update private.pin_guard set locked_until = null where scope = $1`, [`session:${CAJERA}`])
okStatus(await signIn(CAJERA, '4821'), 'pasado el bloqueo entra con su PIN')
ok('PIN: negativa con nombre que no cuenta, 5 errores bloquean ese dispositivo 30 s y luego el doble, los demás siguen')

// Store-wide limit: many devices guessing
let storeLock: Reply | null = null
for (let i = 0; i < 40 && !storeLock; i++) {
  const res = await signIn(`dev-bot-${i % 8}`, String(1000 + i))
  if (res.body.storeLock) storeLock = res
}
assert.ok(storeLock, 'muchos PIN equivocados en la tienda bloquean el ingreso')
assert.equal((await signIn('dev-nuevo', '2580')).status, 429, 'para todos los dispositivos, incluso con el PIN correcto')
const during = await call(OWNER, 'GET', '/api/counter/security')
okStatus(during, 'el dueño, que ya estaba ingresado, ve el bloqueo')
assert.ok(Number(during.body.wrongPins24h) >= 30 && Number(during.body.lockedUntil) > Date.now(), 'con los intentos fallidos del día')
r = await post('dev-nuevo', '/api/counter/recover-owner-pin', { pin: '3691' })
assert.equal(r.status, 403, 'restablecer sin haber escrito la contraseña de la cuenta no sirve')
r = await post('dev-nuevo', '/api/counter/recover-owner-pin', { pin: '3691' }, { 'x-test-password-at': String(Date.now() - 11 * 60_000) })
assert.equal(r.status, 403, 'ni con una contraseña escrita hace más de 10 minutos')
okStatus(await post('dev-nuevo', '/api/counter/recover-owner-pin', { pin: '3691' }, { 'x-test-password-at': String(Date.now() - 5_000) }), 'recién escrita, sí')
okStatus(await signIn('dev-nuevo', '3691'), 'y el ingreso queda desbloqueado con el PIN nuevo')
ok('30 PIN equivocados en la tienda bloquean todos los dispositivos; solo la contraseña de la cuenta, recién escrita, restablece el PIN maestro y desbloquea')

// ─── 3. What a browser can read ─────────────────────────────────────────────────────────────────
await signIn(OWNER, '3691')
await signIn(CAJERA, '4821')
assert.equal(await browserRows(CAJERA, 'products'), 2)
assert.equal(await browserRows(CAJERA, 'productCosts'), 0, 'la cajera no recibe precios de compra')
assert.equal(await browserRows(OWNER, 'productCosts'), 2, 'el dueño sí, en su dispositivo')
assert.equal(await browserRows('dev-sin-nadie', 'productCosts'), 0, 'el mostrador abierto (Cajero) tampoco')
await lite.query(`update private.counter_sessions set expires_at = now() - interval '1 second' where session_id = $1`, [OWNER])
assert.equal(await browserRows(OWNER, 'productCosts'), 0, 'una sesión vencida (pestaña cerrada) deja de recibirlos')
r = await post(OWNER, '/api/counter/heartbeat')
assert.equal(r.body.operator, null, 'y el latido avisa a la app que ya no hay nadie')
await signIn(OWNER, '3691')
r = await post(OWNER, '/api/counter/heartbeat')
assert.equal((r.body.operator as { name: string }).name, 'Propietario')
okStatus(await post(OWNER, '/api/counter/sign-out'), 'salir')
assert.equal(await browserRows(OWNER, 'productCosts'), 0, 'al salir, el dispositivo deja de recibirlos')
const nonStaff = await asBrowser(lite, { email: 'intruso@x.com', session_id: OWNER }, async () => (await lite.query(`select 1 from products`)).rows.length)
assert.equal(nonStaff, 0, 'una cuenta que no es de la tienda no ve nada')
await assert.rejects(() => asBrowser(lite, null, () => lite.query(`select 1 from products`)), /permission denied/, 'sin sesión, nada')
await assert.rejects(() => asBrowser(lite, { email: STAFF, session_id: CAJERA }, () => lite.query(`select * from private.pins`)), /permission denied/, 'los PIN no se leen')
await assert.rejects(() => asBrowser(lite, { email: STAFF, session_id: CAJERA }, () => lite.query(`select * from private.counter_sessions`)), /permission denied/)
await assert.rejects(() => asBrowser(lite, { email: STAFF, session_id: CAJERA }, () => lite.query(`update products set data = data`)), /permission denied/, 'el navegador no escribe')
await assert.rejects(
  () => asBrowser(lite, { email: STAFF, session_id: CAJERA }, () => lite.query(`insert into private.counter_sessions values ('${CAJERA}', 'owner', 'x', 'admin', '{costos.ver}', now() + interval '1 hour')`)),
  /permission denied/,
  'ni puede ponerse permisos a sí mismo',
)
ok('desde el navegador: costos solo con alguien autorizado en ese mismo dispositivo; nada para sesiones vencidas, cuentas ajenas o sin sesión; PIN y sesiones ilegibles; ninguna escritura')

// ─── 4. Stock ───────────────────────────────────────────────────────────────────────────────────
const COUNTER = 'dev-mostrador' // nobody signed in: the open counter works as Cajero
needs(await post(COUNTER, '/api/products', { code: 'C3', name: 'Tina', price: 9000, cost: 1 }), 'stock.editar', 'el mostrador no crea productos')
needs(await post(CAJERA, '/api/products/A1/adjust-stock', { delta: 5 }), 'stock.ajustar', 'la cajera no ajusta existencias')
needs(await call(CAJERA, 'DELETE', '/api/products/A1'), 'stock.eliminar', 'ni borra productos')
needs(await post(CAJERA, '/api/entradas', { code: 'A1', qty: 3 }), 'stock.entradas', 'ni registra entradas')
needs(await post(CAJERA, '/api/inventory/import', { parsed: [], dupAction: 'skip' }), 'stock.importar', 'ni importa')
needs(await post(CAJERA, '/api/inventory/cyclic-count', { adjustments: [], user: 'x' }), 'stock.ajustar', 'ni hace conteos')
needs(await post(CAJERA, '/api/inventory/open-package', { code: 'A1', qty: 1 }), 'stock.ajustar', 'ni abre paquetes')
r = await post(COUNTER, '/api/counter/approve', { pin: '4821', need: 'stock.editar' })
assert.equal(r.status, 403, 'la cajera no puede autorizar lo que ella misma no puede hacer')
okStatus(await post(COUNTER, '/api/counter/approve', { pin: '7310', need: 'stock.editar' }), 'la supervisora autoriza crear un producto')
r = await post(COUNTER, '/api/products', { code: 'C3', name: 'Tina', price: 9000, cost: 4000, stock: 2 })
okStatus(r, 'con su autorización, el mostrador crea el producto')
assert.equal('cost' in r.body, false, 'sin el costo: quien trabaja no puede ver ni fijar precios de compra')
assert.equal(await row(`select 1 from "productCosts" where code = 'C3'`), undefined)
needs(await post(CAJERA, '/api/products', { code: 'D4', name: 'Otro', price: 1 }), 'stock.editar', 'la autorización era para el mostrador, no para otro dispositivo')

const BETO = 'dev-beto'
await signIn(BETO, '8142')
r = await put(BETO, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, cost: 1, stock: 999, min: 2, unit: 'unidad', esPaquete: false })
okStatus(r, 'bodega edita el producto')
assert.equal(r.body.stock, 50, 'sin "ajustar existencias", el stock queda como estaba')
assert.equal((await row<{ c: number }>(`select (data ->> 'cost')::int as c from "productCosts" where code = 'A1'`))!.c, 1200, 'y el precio de compra también')
assert.equal((await row<{ p: number }>(`select (data ->> 'price')::int as p from products where code = 'A1'`))!.p, 2500)
r = await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, cost: 1300, stock: 50, min: 2 })
needs(r, 'stock.editar', 'el dueño salió: su dispositivo vuelve a ser el mostrador')
await signIn(OWNER, '3691')
r = await put(OWNER, '/api/products/A1', { code: 'A1', name: 'Balde grande', price: 2500, cost: 1300, stock: 50, min: 2 })
okStatus(r, 'el dueño cambia el precio de compra')
assert.equal(r.body.cost, 1300)
assert.equal((await row<{ c: number }>(`select (data ->> 'cost')::int as c from "productCosts" where code = 'A1'`))!.c, 1300)
ok('Stock: cada acción pide su permiso en el servidor; una autorización vale para un paso en ese dispositivo; sin permiso no se fija el costo ni el stock')

// ─── 5. Sales ───────────────────────────────────────────────────────────────────────────────────
const sale = (items: Array<{ code: string; price: number; qty: number; isFree?: boolean; name?: string }>, extra: Record<string, unknown> = {}) => {
  const lines = items.map((i) => ({ name: i.name ?? i.code, brand: '', unit: 'unidad', isFree: false, ...i }))
  const subtotal = lines.reduce((a, i) => a + i.price * i.qty, 0)
  return { items: lines, subtotal, discount: 0, total: subtotal, payMethod: 'efectivo', ...extra }
}
r = await post(CAJERA, '/api/sales/finalize', { ...sale([{ code: 'A1', price: 2500, qty: 2 }]), sellerId: 'owner', sellerName: 'Propietario' })
okStatus(r, 'la cajera vende')
assert.equal(r.body.sellerName, 'Ana', 'la venta queda a nombre de quien está ingresado, no de lo que diga el navegador')
assert.equal('ganancia' in r.body, false, 'la respuesta no trae la ganancia')
const saleId = r.body.id as number
assert.equal((await row<{ g: number }>(`select (data ->> 'ganancia')::int as g from profits where key = $1`, [`sale:${saleId}`]))!.g, (2500 - 1300) * 2, 'la ganancia se calcula en el servidor con el costo real')
r = await post(CAJERA, '/api/sales/finalize', sale([{ code: 'A1', price: 100, qty: 1 }]))
assert.equal(r.status, 400)
assert.match(String(r.body.error), /precio de "Balde grande" cambió/, 'no se puede vender a un precio inventado')
r = await post(CAJERA, '/api/sales/finalize', { ...sale([{ code: 'A1', price: 2500, qty: 1 }]), subtotal: 100, total: 100 })
assert.equal(r.status, 400, 'ni con totales que no cuadran')
r = await post(CAJERA, '/api/sales/finalize', sale([{ code: 'A1', price: 2500, qty: 1000 }]))
assert.match(String(r.body.error), /Stock insuficiente/)

const PEPE = 'dev-pepe' // a role that may do nothing beyond selling
await signIn(PEPE, '5096')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 }), 'ventas.descuentos', 'descuento')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), total: 4000 }), 'ventas.cambiarTotal', 'cambiar el total')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), payMethod: 'fiado', fiadoName: 'Don José' }), 'ventas.fiar', 'fiar')
needs(await post(PEPE, '/api/sales/finalize', sale([{ code: 'FREE_x1', name: 'Bolsa', price: 300, qty: 1, isFree: true }])), 'ventas.productoLibre', 'producto sin registrar')
okStatus(await post(PEPE, '/api/counter/approve', { pin: '7310', need: 'ventas.descuentos' }), 'la supervisora autoriza el descuento')
okStatus(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 }), 'con la autorización, la venta con descuento pasa')
needs(await post(PEPE, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), discount: 500, total: 4500 }), 'ventas.descuentos', 'la autorización se gastó en esa venta')
ok('Ventas: precio, totales y stock se verifican en el servidor; descuento, cambio de total, fiado y producto libre piden permiso o autorización, que se gasta en una sola venta; la ganancia y el vendedor los pone el servidor')

// Fiados and corrections
r = await post(OWNER, '/api/sales/finalize', { ...sale([{ code: 'B2', price: 5000, qty: 1 }]), payMethod: 'fiado', fiadoName: 'Don José' })
okStatus(r, 'el dueño fía')
const fiadoId = r.body.id as number
needs(await post(CAJERA, `/api/sales/${fiadoId}/pagos`, { amount: 1000, note: '' }), 'fiados.abonar', 'la cajera no recibe abonos')
needs(await post(CAJERA, `/api/sales/${fiadoId}/pagar-completo`, { condone: true }), 'fiados.condonar', 'ni condona')
r = await post(OWNER, `/api/sales/${fiadoId}/pagos`, { amount: 99_999, note: '' })
assert.match(String(r.body.error), /supera la deuda/, 'no se abona más de lo que se debe')
r = await post(OWNER, `/api/sales/${saleId}/pagar-completo`, {})
assert.match(String(r.body.error), /no es un fiado/, 'una venta de contado no se "paga" otra vez')
needs(await put(CAJERA, `/api/sales/${saleId}/correct`, { newItems: [], reason: 'x' }), 'facturas.corregir', 'la cajera no corrige facturas')
ok('Fiados y facturas: abonar, condonar y corregir piden su permiso; no se abona de más ni se cobra dos veces una venta de contado')

// ─── 6. Caja ────────────────────────────────────────────────────────────────────────────────────
needs(await post(PEPE, '/api/cash/open', { countedCash: 50_000, by: 'Pepe' }), 'caja.abrir', 'abrir la caja')
r = await post(CAJERA, '/api/cash/open', { countedCash: 50_000, by: 'Ana', mayorInitial: 100_000 })
needs(r, 'caja.gestionar', 'el saldo inicial de la Caja Mayor es de quien gestiona las cajas')
okStatus(await post(OWNER, '/api/cash/open', { countedCash: 50_000, by: 'x' }), 'el dueño inicia las cajas')
await lite.query(`update "cashSessions" set data = data || '{"status":"cerrada"}'`)
r = await post(CAJERA, '/api/cash/open', { countedCash: 40_000, by: 'Ana' })
okStatus(r, 'la cajera abre la caja contando el efectivo')
assert.equal('systemAtOpen' in r.body || 'openDiff' in r.body, false, 'a ciegas: la respuesta no dice cuánto esperaba el sistema ni la diferencia')
assert.equal(r.body.openedBy, 'Ana')
assert.equal(await browserRows(CAJERA, 'cashMovements'), 0, 'ni puede leer el libro de caja')
assert.equal(await browserRows(CAJERA, 'cashSessions'), 0)
assert.equal(await browserRows(CAJERA, 'cajaState'), 1, 'pero sí sabe que la caja está abierta')
needs(await post(CAJERA, '/api/cash/movement', { caja: 'menor', direction: 'out', amount: 100, concept: 'x' }), 'caja.gestionar', 'gastos de caja')
needs(await post(CAJERA, '/api/cash/transfer', { from: 'menor', to: 'mayor', amount: 100 }), 'caja.gestionar', 'traslados')
needs(await post(CAJERA, '/api/cierres', { dayKey: new Date().toISOString().slice(0, 10), cajero: 'Ana', notas: '', efectivoFisico: 1 }), 'caja.cerrar', 'cierre')
okStatus(await post(CAJERA, '/api/counter/approve', { pin: '7310', need: 'caja.cerrar' }), 'la supervisora autoriza el cierre')
const today = (await row<{ d: string }>(`select data ->> 'dayKey' as d from "cashSessions" order by id desc limit 1`))!.d
r = await post(CAJERA, '/api/cierres', { dayKey: today, cajero: 'Otra', notas: '', efectivoFisico: 45_000 })
okStatus(r, 'la cajera cierra a ciegas')
assert.equal(r.body.cajero, 'Ana', 'firmado por quien está ingresado')
assert.equal('arqueo' in r.body || 'totalGanancia' in r.body || 'dejadoEnCaja' in r.body, false, 'la respuesta no trae el arqueo ni la ganancia')
assert.equal(await browserRows(CAJERA, 'cierres'), 0, 'ni puede leer los cierres')
const SOFIA = 'dev-sofia'
await signIn(SOFIA, '7310')
assert.equal(await browserRows(SOFIA, 'cierres'), 1, 'la supervisora (Reportes) sí')
assert.equal(await browserRows(SOFIA, 'profits'), 0, 'pero no las ganancias')
assert.equal(await browserRows(SOFIA, 'productCosts'), 0, 'ni los costos')
ok('Caja: abrir pide permiso y es a ciegas (ni la respuesta ni la base de datos le dicen lo esperado); gastos, traslados y cierre piden permiso; el cierre autorizado queda firmado por quien trabaja')

// ─── 7. Proveedores, settings, users ────────────────────────────────────────────────────────────
needs(await post(SOFIA, '/api/suppliers', { name: 'X', paymentTerms: { kind: 'contado' } }), 'proveedores.gestionar', 'la supervisora no gestiona proveedores')
const CARLA = 'dev-carla'
await signIn(CARLA, '6203')
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
needs(await put(CAJERA, '/api/settings', { storeName: 'Hackeada' }), 'admin', 'la cajera no cambia los ajustes')
okStatus(await put(CAJERA, '/api/settings', { theme: 'dark' }), 'el tema sí')
needs(await post(SOFIA, '/api/usuarios', { name: 'Intruso', role: 'supervisor', pin: '1357', active: true }), 'admin', 'la supervisora no crea usuarios')
needs(await call(SOFIA, 'GET', '/api/counter/security'), 'admin', 'ni ve la seguridad')
needs(await post(SOFIA, '/api/counter/owner-pin', { pin: '1357', pinLength: 4 }), 'admin', 'ni cambia el PIN maestro')
r = await post(PEPE, '/api/counter/approve', { pin: '3691', need: 'admin' })
assert.equal(r.status, 400, 'lo de administrador no se "autoriza": hay que ingresar como administrador')
r = await call(OWNER, 'GET', '/api/counter/security')
okStatus(r, 'el dueño ve la seguridad')
assert.equal(r.body.ownerPinDefault, false)
assert.equal(r.body.lockedUntil, null, 'el bloqueo ya se levantó')
ok('Proveedores, ajustes y usuarios: cada uno pide su permiso; un error de pago no revela el saldo; lo de administrador exige ingresar como administrador')

// ─── 8. Permissions follow role changes at once ─────────────────────────────────────────────────
assert.equal(await browserRows(CARLA, 'productCosts'), 2, 'Compras recibe los costos (C3 se creó sin costo)')
okStatus(await put(OWNER, '/api/settings', { roles: [...DEFAULT_ROLES, restricted, { ...compras, permissions: [] }, bodega] }), 'el dueño le quita los permisos a Compras')
assert.equal(await browserRows(CARLA, 'productCosts'), 0, 'Carla deja de recibir costos sin tener que salir')
needs(await post(CARLA, '/api/suppliers', { name: 'Y', paymentTerms: { kind: 'contado' } }), 'proveedores.gestionar', 'ni gestiona proveedores')
okStatus(await put(OWNER, `/api/usuarios/${beto.id}`, { name: 'Beto', role: 'bodega', active: false }), 'el dueño desactiva a Beto')
r = await post(BETO, '/api/counter/heartbeat')
assert.equal(r.body.operator, null, 'Beto queda fuera en su dispositivo')
okStatus(await put(OWNER, '/api/settings', { access: { mode: 'abierto', counterRole: 'supervisor', autoLockMinutes: 5 } }), 'el mostrador pasa a trabajar como Supervisor')
assert.equal(await browserRows(COUNTER, 'cashMovements') > 0, true, 'el mostrador abierto ahora ve el libro de caja')
okStatus(await put(OWNER, '/api/settings', { access: { mode: 'pin', counterRole: 'supervisor', autoLockMinutes: 5 } }), 'modo PIN')
assert.equal(await browserRows(COUNTER, 'cashMovements'), 0, 'en modo PIN, sin nadie ingresado, nada secreto')
needs(await post(COUNTER, '/api/cash/open', { countedCash: 1 }), 'caja.abrir', 'y nada que hacer')
await signIn(CAJERA, '4821')
okStatus(await call(OWNER, 'DELETE', `/api/usuarios/${ana.id}`), 'el dueño borra a Ana')
assert.equal((await post(CAJERA, '/api/counter/heartbeat')).body.operator, null, 'y queda fuera en todas partes')
assert.equal((await signIn('dev-z', '4821')).status, 401, 'su PIN ya no existe')
ok('los permisos siguen al instante los cambios de roles, de usuarios y del modo de acceso, también en lo que el navegador puede leer')

server.close()
await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones de seguridad pasaron.`)
