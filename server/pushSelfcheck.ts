/** Self-check of the Administrador's phone notifications ("Pendientes de hoy" at fixed hours), on an in-memory Postgres
 * (PGlite) built from the real migrations — never the Supabase data, and nothing is sent: a fake sender keeps what it
 * was asked to send:  npm run check:push
 *
 * - What the notification says, read from the database: the caja left open, payables, stock, orders, the system's
 *   monthly payment (and "Ya pagué", which only the Administrador can mark); nothing when nothing asks for action.
 * - Who gets it: only the devices of whoever is an active Administrador now; anyone else's token is forgotten, and so
 *   is a token Firebase says no longer exists.
 * - Over the real API: only an Administrador turns them on (and gets a test one at once), anyone may turn a device off,
 *   and no browser can read the tokens. */
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { RequestHandler } from 'express'
import { createApp } from './app'
import type { AuthInfo } from './auth'
import { pgliteDb } from './db'
import { checkAccount, refreshCounterPerms } from './domain/counter'
import { pendingPush, sendPendingPush, type PushMessage } from './domain/push'
import { HttpError } from './routes/http'
import { asBrowser, testDatabase } from './testDb'

let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

const lite = await testDatabase()
const db = pgliteDb(lite)
const user = (id: string, email: string, role: string, active = true) => JSON.stringify({ id, name: id, email, role, active, createdAt: '2026-01-01T00:00:00Z' })
await lite.query(`insert into public.staff (email, name) values ('dueno@x.com', 'Propietario')`)
await lite.query(`insert into public.usuarios (id, data) values ('u-ana', $1), ('u-caja', $2), ('u-ex', $3)`, [
  user('u-ana', 'ana@x.com', 'admin'),
  user('u-caja', 'caja@x.com', 'cajero'),
  user('u-ex', 'ex@x.com', 'admin', false),
])
await db.tx(refreshCounterPerms)

const TODAY = '2026-10-20'
const msg = () => db.tx((q) => pendingPush(q, TODAY))

// ─── 1. What it says ─────────────────────────────────────────────────────────────────────────────
assert.equal(await msg(), null, 'sin pendientes no hay aviso')
await lite.query(`insert into public.products (code, data) values
  ('A1', '{"code":"A1","name":"Balde","price":2000,"stock":50,"min":5,"cat":"","brand":"","unit":"unidad","esPaquete":false}'),
  ('B2', '{"code":"B2","name":"Vaso","price":1000,"stock":0,"min":4,"cat":"","brand":"","unit":"unidad","esPaquete":false}'),
  ('C3', '{"code":"C3","name":"Jarra","price":3000,"stock":2,"min":5,"cat":"","brand":"","unit":"unidad","esPaquete":false}')`)
await lite.query(`insert into public.payables (data) values ($1), ($2)`, [
  JSON.stringify({ supplierId: 's1', supplierName: 'Distribuidora Andina', orderId: 1, amount: 25000, paid: 0, issuedAt: '2026-10-01T15:00:00Z', dueDate: '2026-10-21', payments: [] }),
  JSON.stringify({ supplierId: 's2', supplierName: 'Pagada SAS', orderId: 2, amount: 9000, paid: 9000, issuedAt: '2026-10-01T15:00:00Z', dueDate: '2026-10-10', payments: [] }),
])
await lite.query(`insert into public."purchaseOrders" (data) values ($1)`, [
  JSON.stringify({ supplierId: 's3', supplierName: 'Hogar y Más', status: 'pedido', lines: [], total: 15000, paymentTerms: { kind: 'contado' }, createdAt: '2026-10-18T15:00:00Z', orderedAt: '2026-10-18T15:00:00Z' }),
])
await lite.query(`insert into public."cajaState" (key, data) values ('menor', $1) on conflict (key) do update set data = excluded.data`, [
  JSON.stringify({ key: 'menor', started: true, open: true, dayKey: '2026-10-19', openedAt: '2026-10-19T12:00:00Z', openedBy: 'Ana' }),
])
const m1 = (await msg())!
assert.equal(m1.title, 'Pendientes: 4 asuntos por atender')
const lines = m1.body.split('\n')
assert.match(lines[0], /^Caja sin cerrar: La Caja Menor sigue abierta desde el 19/)
assert.equal(lines[1], 'Productos agotados: 1 producto sin unidades')
assert.equal(lines[2], 'Pagos a proveedores ($25.000,00): 1 cuenta por pagar · vence en los próximos 7 días $25.000,00')
assert.equal(lines[3], 'Stock bajo: 1 producto llegó a su mínimo')
assert.equal(lines[4], '…y 1 más', 'el pedido por recibir se cuenta')
ok('el aviso sale de la base: caja sin cerrar, agotados, pagos a proveedores (sin los pagados), stock bajo; lo más urgente primero')

// The system's monthly payment, from the 11th to the 13th, first — until the Administrador says "Ya pagué".
const reminder = (await db.tx((q) => pendingPush(q, '2026-11-12')))!
assert.equal(reminder.title, 'Recordatorio: pago mensual del sistema')
assert.match(reminder.body, /^Pago mensual del sistema: Vence mañana \(el .*13 de noviembre\)\. Si ya pagaste, omite este mensaje\./)

const fakeAuth: RequestHandler = async (req, res, next) => {
  const auth: AuthInfo = { sessionId: `s-${req.header('x-test-email')}`, email: req.header('x-test-email') ?? '', passwordAt: null }
  try {
    await checkAccount(db, auth)
  } catch (err) {
    const e = err as HttpError
    return void res.status(e.status).json({ ...e.extra, error: e.message })
  }
  req.auth = auth
  next()
}
const sent: Array<{ tokens: string[]; message: PushMessage }> = []
let gone: string[] = []
const fakePush = async (tokens: string[], message: PushMessage) => {
  sent.push({ tokens, message })
  return tokens.filter((t) => gone.includes(t))
}
const server = createApp(db, fakeAuth, undefined, undefined, fakePush).listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const as = (email: string) => async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'x-test-email': email, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}
const owner = as('dueno@x.com')
const ana = as('ana@x.com')
const caja = as('caja@x.com')

let r = await caja('PUT', '/api/settings', { servicePaid: '2026-11-13' })
assert.equal(r.status, 403, 'un cajero no marca el pago del sistema')
r = await owner('PUT', '/api/settings', { servicePaid: 'mañana' })
assert.equal(r.status, 400)
r = await owner('PUT', '/api/settings', { servicePaid: '2026-11-13' })
assert.equal(r.status, 200)
assert.notEqual((await db.tx((q) => pendingPush(q, '2026-11-12')))?.title, 'Recordatorio: pago mensual del sistema', '"Ya pagué" lo quita del aviso')
assert.equal((await db.tx((q) => pendingPush(q, '2026-12-12')))?.title, 'Recordatorio: pago mensual del sistema', 'y el mes siguiente vuelve')
ok('pago mensual del sistema: del 11 al 13 encabeza el aviso; "Ya pagué" (solo el Administrador) lo quita hasta el mes siguiente')

// ─── 2. Turning them on and off ──────────────────────────────────────────────────────────────────
const T = (name: string) => `${name}:APA91b${'x'.repeat(40)}`
r = await caja('POST', '/api/push/token', { token: T('caja') })
assert.equal(r.status, 403, 'un cajero no recibe los avisos del Administrador')
r = await owner('POST', '/api/push/token', { token: 'no es un token' })
assert.equal(r.status, 400)
r = await owner('POST', '/api/push/token', { token: T('dueno') })
assert.equal(r.status, 200)
assert.equal(r.body.tested, true)
assert.equal(sent.length, 1)
assert.deepEqual(sent[0].tokens, [T('dueno')])
assert.match(sent[0].message.body, /7:00 a\. m\., 12:20 p\. m\., 5:00 p\. m\., 6:00 p\. m\. y 8:00 p\. m\./)
assert.equal((await ana('POST', '/api/push/token', { token: T('ana') })).status, 200, 'una usuaria con rol Administrador también')
assert.equal((await owner('POST', '/api/push/token', { token: T('dueno') })).status, 200, 'activarlos dos veces no duplica el equipo')
const tokens = async () => (await lite.query<{ token: string; email: string }>(`select token, email from private.push_tokens order by token`)).rows
assert.deepEqual(
  (await tokens()).map((t) => t.email),
  ['ana@x.com', 'dueno@x.com'],
)
r = await caja('DELETE', `/api/push/token/${encodeURIComponent(T('ana'))}`)
assert.equal(r.status, 204, 'apagar un equipo lo puede hacer quien esté en él (el token es la llave)')
assert.deepEqual(
  (await tokens()).map((t) => t.email),
  ['dueno@x.com'],
)
await assert.rejects(() => asBrowser(lite, { email: 'dueno@x.com', session_id: 's', role: 'authenticated' }, async () => lite.query(`select * from private.push_tokens`)), /permission denied/i)
ok('solo un Administrador activa los avisos en su equipo (y le llega uno de prueba); apagarlos borra el equipo; ningún navegador lee los tokens')

// ─── 3. The scheduled send ───────────────────────────────────────────────────────────────────────
await ana('POST', '/api/push/token', { token: T('ana') })
// Tokens of people who are no Administrador now: a cashier's (saved before a role change) and a deactivated one's.
await lite.query(`insert into private.push_tokens (token, email) values ($1, 'caja@x.com'), ($2, 'ex@x.com')`, [T('caja'), T('ex')])
sent.length = 0
gone = [T('ana')]
const result = await sendPendingPush(db, fakePush, TODAY)
assert.equal(sent.length, 1, 'un solo envío a todos los equipos')
assert.deepEqual([...sent[0].tokens].sort(), [T('ana'), T('dueno')], 'solo a los Administradores activos')
assert.equal(sent[0].message.title, 'Pendientes: 4 asuntos por atender')
assert.deepEqual(result, { sent: 1, removed: 3 })
assert.deepEqual(
  (await tokens()).map((t) => t.token),
  [T('dueno')],
  'se olvidan el del cajero, el del desactivado y el que Firebase dice que ya no existe',
)
// Nothing asks for action: nothing is sent.
await lite.exec(`delete from public.products; delete from public.payables; delete from public."purchaseOrders"; update public."cajaState" set data = data || '{"open":false}'`)
sent.length = 0
assert.deepEqual(await sendPendingPush(db, fakePush, TODAY), { sent: 0, removed: 0 })
assert.equal(sent.length, 0)
ok('el envío programado va solo a los Administradores activos, olvida los demás equipos y no manda nada si no hay pendientes')

server.close()
console.log(`\nTodo en orden: ${n} comprobaciones de los avisos al celular pasaron.`)
