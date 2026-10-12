/** Self-check of selling without internet, on an in-memory Postgres (PGlite) built from the real migrations —
 * never the Supabase data:  npm run check:offline
 *
 * A device without internet keeps its sales and sends them when it can. What the server must guarantee:
 * - a sale sent twice (a reply that got lost, two tabs) is saved once — stock and caja included;
 * - a sale from a device that was offline is ALWAYS saved (the goods already left) with what didn't add up
 *   written down for the owner, and it is booked on the day and in the workday it was made;
 * - what can't be a sale at all is refused, and a database that can't be reached answers 503 so the app
 *   knows the server is out of reach instead of treating it as a rule that was broken. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import type pg from 'pg'
import type { RequestHandler } from 'express'
import { createApp } from './app'
import type { AuthInfo } from './auth'
import { pgDb, pgliteDb, type Db } from './db'
import { checkAccount, refreshCounterPerms } from './domain/counter'
import { HttpError, isDatabaseDown } from './routes/http'
import { testDatabase } from './testDb'
import { dayKeyOf } from '../src/shared/lib/currency'
import { DEFAULT_ROLES, type Role } from '../src/shared/lib/permissions'

let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)
console.error = () => {} // the routes log the database errors this test provokes

const lite = await testDatabase()
const db = pgliteDb(lite)
const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

await lite.exec(`
insert into public.staff (email, name) values ('dueno@x.com', 'Propietario');
insert into public.products (code, data) values
  ('A1', '{"code":"A1","name":"Balde","price":2000,"price2":1800,"cost":1200,"stock":50,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}'),
  ('B2', '{"code":"B2","name":"Ponchera","price":5000,"cost":3000,"stock":3,"min":0,"cat":"","brand":"","unit":"unidad","esPaquete":false}'),
  ('C3', '{"code":"C3","name":"Cuerda","price":4000,"cost":2500,"stock":20,"min":0,"cat":"","brand":"","unit":"m","esPaquete":false}');
insert into public.customers (id, data) values ('cli1', '{"id":"cli1","name":"Ana Gómez","createdAt":"2026-01-01T00:00:00Z"}');
`)
// A closed workday three days ago, and one open since an hour ago.
await lite.query(`insert into public."cashSessions" (data) values ($1)`, [JSON.stringify({ status: 'cerrada', dayKey: dayKeyOf(ago(3 * DAY)), openedAt: ago(3 * DAY + 6 * 3_600_000), openedBy: 'Ana', openingCash: 0, systemAtOpen: 0, openDiff: 0, closedAt: ago(3 * DAY) })])
await lite.query(`insert into public."cashSessions" (data) values ($1)`, [JSON.stringify({ status: 'abierta', dayKey: dayKeyOf(new Date()), openedAt: ago(3_600_000), openedBy: 'Ana', openingCash: 0, systemAtOpen: 0, openDiff: 0 })])
const closedSession = Number((await lite.query<{ id: string }>(`select id from public."cashSessions" where data ->> 'status' = 'cerrada'`)).rows[0].id)
const openSession = Number((await lite.query<{ id: string }>(`select id from public."cashSessions" where data ->> 'status' = 'abierta'`)).rows[0].id)

const fakeAuth: RequestHandler = async (req, res, next) => {
  const session = req.header('x-test-session')
  if (!session) return void res.status(401).json({ error: 'Inicia sesión para continuar' })
  const auth: AuthInfo = { sessionId: session, email: req.header('x-test-email') ?? '', passwordAt: null }
  try {
    await checkAccount(db, auth)
  } catch (err) {
    const e = err as HttpError
    return void res.status(e.status).json({ ...e.extra, error: e.message })
  }
  req.auth = auth
  next()
}
await db.tx(refreshCounterPerms)
const server = createApp(db, fakeAuth).listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const OWNER = { 'x-test-session': 'dev-owner', 'x-test-email': 'dueno@x.com' }
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = OWNER, url = base) => {
  const res = await fetch(url + path, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}
const one = async <T,>(sql: string, params: unknown[] = []) => (await lite.query<T>(sql, params)).rows[0]
const stockOf = async (code: string) => Number((await one<{ s: string }>(`select data ->> 'stock' as s from products where code = $1`, [code])).s)
const count = async (table: string) => Number((await one<{ c: string }>(`select count(*) as c from public."${table}"`)).c)
const movementsOf = async (saleId: number) => (await lite.query<{ data: Record<string, any> }>(`select data from "cashMovements" where data ->> 'refId' = $1 order by id`, [String(saleId)])).rows.map((r) => r.data)

// Users: a practicante (a role that can do nothing special) and the rules around him.
const practicante: Role = { id: 'practicante', name: 'Practicante', permissions: [] }
let r = await call('PUT', '/api/settings', { roles: [...DEFAULT_ROLES, practicante] })
assert.equal(r.status, 200)
await lite.query(`insert into public.usuarios (id, data) values ('u-pepe', $1), ('u-ido', $2)`, [
  JSON.stringify({ id: 'u-pepe', name: 'Pepe', role: 'practicante', email: 'pepe@x.com', active: true, createdAt: '2026-01-01T00:00:00Z' }),
  JSON.stringify({ id: 'u-ido', name: 'Ido', role: 'practicante', email: 'ido@x.com', active: false, createdAt: '2026-01-01T00:00:00Z' }),
])
await db.tx(refreshCounterPerms)
const PEPE = { 'x-test-session': 'dev-pepe', 'x-test-email': 'pepe@x.com' }

const line = (code: string, price: number, qty = 1, name = code) => ({ code, name, price, qty, brand: '', unit: code === 'C3' ? 'm' : 'unidad', isFree: false })
const offline = (clientId: string, items: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) => {
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0)
  return { clientId, soldAt: ago(60_000), items, subtotal, discount: 0, total: subtotal, payMethod: 'efectivo', ...extra }
}
const UUID = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`

// ─── 1. A sale sent twice is one sale ─────────────────────────────────────────────────────────────
const strict = { items: [line('A1', 2000, 2)], subtotal: 4000, discount: 0, total: 4000, payMethod: 'efectivo', clientId: UUID(1) }
r = await call('POST', '/api/sales/finalize', strict)
assert.equal(r.status, 201, JSON.stringify(r.body))
const strictId = r.body.id as number
assert.equal(r.body.clientId, UUID(1), 'la venta guarda el código del equipo')
assert.equal(await stockOf('A1'), 48)
r = await call('POST', '/api/sales/finalize', strict)
assert.equal(r.status, 201)
assert.equal(r.body.id, strictId, 'enviarla otra vez devuelve la misma venta')
assert.equal(await stockOf('A1'), 48, 'sin descontar el stock de nuevo')
assert.equal((await movementsOf(strictId)).length, 1, 'ni mover la caja de nuevo')
assert.equal(await count('sales'), 1)
assert.equal((await call('POST', '/api/sales/finalize', { ...strict, clientId: 'corto' })).status, 400, 'un código mal formado no vale')
r = await call('POST', '/api/sales/offline', offline(UUID(1), [line('A1', 2000, 2)]))
assert.equal(r.status, 201)
assert.equal(r.body.duplicate, true, 'la que ya entró por la vía normal tampoco se repite si llega como pendiente (el envío se cortó a medias)')
assert.equal(r.body.sale.id, strictId)
assert.deepEqual(r.body.stocks, [{ code: 'A1', stock: 48 }], 'y le dice al equipo cuánto stock hay ahora')
assert.equal(await stockOf('A1'), 48)
assert.equal(await count('sales'), 1)
ok('una venta enviada dos veces se guarda una sola vez, sin tocar el stock ni la caja de nuevo, por la vía normal o por la de pendientes')

// ─── 2. An offline sale is booked when it was made ───────────────────────────────────────────────
const threeDaysAgo = ago(3 * DAY + 3_600_000) // inside the closed workday
r = await call('POST', '/api/sales/offline', offline(UUID(2), [line('A1', 2000, 3), line('C3', 4000, 1.5, 'Cuerda')], { soldAt: threeDaysAgo, localRef: 'PEND-0007', notes: 'sin bolsa' }))
assert.equal(r.status, 201, JSON.stringify(r.body))
const sale2 = r.body.sale as Record<string, any>
assert.equal(r.body.duplicate, false)
assert.equal(sale2.offline, true)
assert.equal(sale2.date, threeDaysAgo, 'lleva la fecha en que se hizo, no la de su llegada')
assert.equal(sale2.dayKey, dayKeyOf(threeDaysAgo))
assert.equal(sale2.refLocal, 'PEND-0007')
assert.ok(sale2.syncedAt && sale2.syncedAt > sale2.date)
assert.equal(sale2.reviewNotes, undefined, 'sin nada raro, no hay nada que revisar')
assert.equal(sale2.sellerName, 'Propietario')
assert.equal(sale2.ganancia, undefined, 'la ganancia no sale en la fila que lee todo el mundo')
assert.equal(sale2.items[1].cost, undefined, 'ni el costo de cada producto')
assert.equal(Number((await one<{ g: string }>(`select data ->> 'ganancia' as g from profits where key = $1`, [`sale:${sale2.id}`])).g), 3 * 800 + 1.5 * 1500, 'la ganancia se calcula en el servidor')
assert.equal(sale2.total, 3 * 2000 + 1.5 * 4000)
assert.equal(await stockOf('A1'), 45)
assert.equal(await stockOf('C3'), 18.5)
assert.deepEqual(r.body.stocks, [{ code: 'A1', stock: 45 }, { code: 'C3', stock: 18.5 }])
const [mv] = await movementsOf(sale2.id)
assert.equal(mv.type, 'venta')
assert.equal(mv.amount, 12000)
assert.equal(mv.caja, 'menor')
assert.equal(mv.date, threeDaysAgo, 'la caja la anota con la fecha de la venta')
assert.equal(mv.dayKey, dayKeyOf(threeDaysAgo))
assert.equal(mv.sessionId, closedSession, 'y en la jornada que estaba abierta entonces, aunque ya se cerró')
r = await call('POST', '/api/sales/offline', offline(UUID(3), [line('A1', 2000)], { soldAt: ago(2 * DAY) })) // no workday was open then
const [mvOpen] = await movementsOf(r.body.sale.id)
assert.equal(mvOpen.sessionId, openSession, 'si no había jornada abierta, cae en la que está abierta ahora')
r = await call('POST', '/api/sales/offline', offline(UUID(2), [line('A1', 2000, 3), line('C3', 4000, 1.5)], { soldAt: threeDaysAgo }))
assert.equal(r.body.duplicate, true)
assert.equal(r.body.sale.id, sale2.id)
assert.equal(await stockOf('A1'), 44, 'reenviarla no vuelve a descontar (44 = 45 − la venta de la jornada abierta)')
// A day that another device already closed: the late sale is kept, with a note that no cierre includes it.
await lite.query(`insert into public.cierres (data) values ($1)`, [JSON.stringify({ tipo: 'Z', fecha: dayKeyOf(threeDaysAgo), cajero: 'Ana', cerradoEn: ago(3 * DAY), totalVentas: 0, numTx: 0, totalExIn: 0, totalExOut: 0, netDay: 0 })])
r = await call('POST', '/api/sales/offline', offline(UUID(4), [line('A1', 2000)], { soldAt: threeDaysAgo }))
assert.equal(r.status, 201)
assert.match(r.body.sale.reviewNotes.join('|'), /día cuya caja ya se cerró/, 'una venta de un día ya cerrado se guarda, avisando que ningún cierre la incluye')
assert.equal(await stockOf('A1'), 43)
assert.equal((await movementsOf(sale2.id)).length, 1)
ok('una venta hecha sin internet entra con la fecha y la jornada de caja de cuando se hizo, con su ganancia calculada aquí, y reenviarla no cambia nada')

// ─── 3. It is always saved: what didn't add up is written down ──────────────────────────────────
// Stock that wasn't there (B2 has 3).
r = await call('POST', '/api/sales/offline', offline(UUID(10), [line('B2', 5000, 5, 'Ponchera')]))
assert.equal(r.status, 201)
assert.equal(await stockOf('B2'), 0, 'el stock baja hasta cero, no queda negativo')
assert.match(r.body.sale.reviewNotes.join('|'), /Stock insuficiente de "Ponchera": se vendieron 5 y había 3/)
assert.deepEqual(r.body.stocks, [{ code: 'B2', stock: 0 }])
// A price that is none of the product's prices today; a registered second price is fine.
r = await call('POST', '/api/sales/offline', offline(UUID(11), [line('A1', 1500, 1, 'Balde')]))
assert.match(r.body.sale.reviewNotes.join('|'), /"Balde" se vendió a \$1\.500,00, que no es ninguno de sus precios de hoy/)
assert.equal(r.body.sale.items[0].price, 1500, 'queda al precio al que se cobró')
r = await call('POST', '/api/sales/offline', offline(UUID(12), [line('A1', 1800, 1, 'Balde')]))
assert.equal(r.body.sale.reviewNotes, undefined, 'el Precio 2 registrado no es raro')
// A product that no longer exists.
r = await call('POST', '/api/sales/offline', offline(UUID(13), [line('ZZ', 700, 2, 'Producto viejo'), line('A1', 2000)]))
assert.equal(r.status, 201)
assert.match(r.body.sale.reviewNotes.join('|'), /"Producto viejo" ya no existe en el inventario/)
assert.deepEqual(r.body.stocks, [{ code: 'A1', stock: (await stockOf('A1')) }], 'solo se descuenta lo que existe')
assert.equal(r.body.sale.items.length, 2, 'la línea se conserva como se cobró')
// Totals that don't match the lines, a missing total.
r = await call('POST', '/api/sales/offline', offline(UUID(14), [line('A1', 2000, 2)], { subtotal: 9999 }))
assert.equal(r.body.sale.subtotal, 4000, 'el subtotal sale de los productos')
assert.match(r.body.sale.reviewNotes.join('|'), /no coincidía con sus productos/)
r = await call('POST', '/api/sales/offline', offline(UUID(15), [line('A1', 2000, 2)], { total: undefined }))
assert.equal(r.body.sale.total, 4000)
assert.match(r.body.sale.reviewNotes.join('|'), /sin un total válido/)
// A date in the future (the device's clock was ahead) and a very old one.
r = await call('POST', '/api/sales/offline', offline(UUID(16), [line('A1', 2000)], { soldAt: new Date(Date.now() + 3 * DAY).toISOString() }))
assert.ok(Date.parse(r.body.sale.date) <= Date.now() + 1000, 'una fecha del futuro se corrige')
assert.match(r.body.sale.reviewNotes.join('|'), /estaba en el futuro/)
r = await call('POST', '/api/sales/offline', offline(UUID(17), [line('A1', 2000)], { soldAt: 'ayer' }))
assert.match(r.body.sale.reviewNotes.join('|'), /sin fecha válida/)
r = await call('POST', '/api/sales/offline', offline(UUID(18), [line('A1', 2000)], { soldAt: ago(120 * DAY) }))
assert.equal(r.body.sale.date.slice(0, 10), ago(120 * DAY).slice(0, 10), 'una fecha vieja se respeta')
assert.match(r.body.sale.reviewNotes.join('|'), /hace más de 90 días/)
// The customer, as the server knows them; one that was deleted.
r = await call('POST', '/api/sales/offline', offline(UUID(19), [line('A1', 2000)], { customerId: 'cli1', customerName: 'Nombre que mandó el equipo' }))
assert.equal(r.body.sale.customerName, 'Ana Gómez', 'el nombre del cliente sale de la base de datos')
assert.equal(r.body.sale.reviewNotes, undefined)
r = await call('POST', '/api/sales/offline', offline(UUID(20), [line('A1', 2000)], { customerId: 'ya-no-existe', customerName: 'Don Luis' }))
assert.equal(r.body.sale.customerId, undefined)
assert.equal(r.body.sale.customerName, 'Don Luis')
assert.match(r.body.sale.reviewNotes.join('|'), /El cliente de la venta ya no existe/)
ok('una venta sin internet se guarda siempre: el stock baja hasta cero, y lo que no cuadra (precio, producto borrado, totales, fecha, cliente) queda escrito para revisar')

// ─── 4. Who made it, and what they were allowed to do ────────────────────────────────────────────
// The owner's session sends what Pepe (a practicante) sold: his name and his permissions are the ones that count.
r = await call('POST', '/api/sales/offline', offline(UUID(30), [line('A1', 2000, 2)], { seller: { id: 'u-pepe', name: 'Un nombre inventado' }, discount: 400, total: 3600 }))
assert.equal(r.body.sale.sellerId, 'u-pepe')
assert.equal(r.body.sale.sellerName, 'Pepe', 'el nombre sale de la base de datos, no de lo que mande el equipo')
assert.equal(r.body.sale.syncedBy, 'Propietario', 'y queda quién la envió')
assert.match(r.body.sale.reviewNotes.join('|'), /Descuento de \$400,00 sin autorización/)
r = await call('POST', '/api/sales/offline', offline(UUID(31), [line('A1', 2000, 2)], { seller: { id: 'u-pepe' }, total: 4100 }))
assert.match(r.body.sale.reviewNotes.join('|'), /Total cambiado a \$4\.100,00 .* sin autorización/)
assert.equal(r.body.sale.roundingAdjustment, 100, 'el ajuste se calcula aquí')
r = await call('POST', '/api/sales/offline', offline(UUID(32), [line('A1', 2000)], { seller: { id: 'u-pepe' }, payMethod: 'fiado', fiadoName: 'Doña Marta' }))
assert.match(r.body.sale.reviewNotes.join('|'), /Venta fiada sin autorización/)
assert.equal(r.body.sale.fiadoName, 'Doña Marta')
assert.equal((await movementsOf(r.body.sale.id)).length, 0, 'un fiado no mueve la caja')
// The owner can do all that without a note.
r = await call('POST', '/api/sales/offline', offline(UUID(33), [line('A1', 2000, 2)], { seller: { id: 'owner' }, discount: 400, total: 3600, payMethod: 'fiado', fiadoName: 'Doña Marta' }))
assert.equal(r.body.sale.reviewNotes, undefined, 'el propietario puede dar descuentos y fiar sin más')
assert.equal(r.body.sale.syncedBy, undefined, 'quien la envía es quien la hizo')
// A sale can't claim more authority than whoever sends it has: Pepe (who can do nothing special) can't send a sale
// "made by the owner" with a discount and a fiado and have it pass without a note.
r = await call('POST', '/api/sales/offline', offline(UUID(39), [line('A1', 2000, 2)], { seller: { id: 'owner' }, discount: 400, total: 3600, payMethod: 'fiado', fiadoName: 'Doña Marta' }), PEPE)
assert.equal(r.body.sale.sellerName, 'Propietario', 'queda a nombre de quien dicen que la hizo…')
assert.equal(r.body.sale.syncedBy, 'Pepe', '…pero queda escrito quién la mandó')
assert.match(r.body.sale.reviewNotes.join('|'), /Descuento de \$400,00 sin autorización/, 'y sin los permisos de quien la mandó, lo que pedía permiso queda anotado')
assert.match(r.body.sale.reviewNotes.join('|'), /Venta fiada sin autorización/)
// A seller that is gone or deactivated: the sale goes under whoever sent it.
for (const [k, id] of [[34, 'u-ido'], [35, 'u-borrado']] as const) {
  r = await call('POST', '/api/sales/offline', offline(UUID(k), [line('A1', 2000)], { seller: { id } }))
  assert.equal(r.body.sale.sellerName, 'Propietario')
  assert.match(r.body.sale.reviewNotes.join('|'), /Quien hizo la venta ya no existe o está desactivado/)
}
// A cashier can send his own sale, and cash received that doesn't cover the total isn't kept.
r = await call('POST', '/api/sales/offline', offline(UUID(36), [line('A1', 2000, 2)], { amountReceived: 5000 }), PEPE)
assert.equal(r.body.sale.sellerName, 'Pepe')
assert.equal(r.body.sale.amountReceived, 5000)
assert.equal(r.body.sale.changeGiven, 1000)
r = await call('POST', '/api/sales/offline', offline(UUID(37), [line('A1', 2000, 2)], { amountReceived: 100 }), PEPE)
assert.equal(r.body.sale.amountReceived, undefined)
r = await call('POST', '/api/sales/offline', offline(UUID(38), [line('A1', 2000)], { payMethod: 'transferencia' }))
assert.equal((await movementsOf(r.body.sale.id))[0].caja, 'mayor', 'una transferencia entra a la Caja Mayor')
assert.ok((r.body.sale.reviewNotes as string[]).some((n) => /sin la cuenta/.test(n)), 'una transferencia que no dice su cuenta se guarda igual y se anota')
r = await call('POST', '/api/sales/offline', offline(UUID(42), [line('A1', 2000)], { payMethod: 'transferencia', transferAccount: 'nequi' }))
assert.equal(r.body.sale.transferAccount, 'nequi', 'la cuenta de la transferencia se guarda')
assert.equal(r.body.sale.reviewNotes, undefined, 'y con cuenta no hay nada que anotar')
assert.equal((await movementsOf(r.body.sale.id))[0].cuenta, 'nequi', 'el movimiento de la Caja Mayor lleva la cuenta')
r = await call('POST', '/api/sales/offline', offline(UUID(44), [{ ...line('A1', 2000, 2), discount: 300 } as ReturnType<typeof line>], { discount: 300, total: 3700 }))
assert.equal(r.status, 201)
assert.equal(r.body.sale.items[0].discount, 300, 'el descuento de la línea se conserva en una venta hecha sin internet')
assert.equal(r.body.sale.reviewNotes, undefined, 'y si cuadra con el de la venta no hay nada que anotar')
assert.equal(Number((await one<{ g: string }>(`select data ->> 'ganancia' as g from profits where key = $1`, [`sale:${r.body.sale.id}`])).g), 3700 - 2 * 1200, 'la ganancia de una venta con descuento es lo cobrado menos el costo')
r = await call('POST', '/api/sales/offline', offline(UUID(45), [{ ...line('A1', 2000, 2), discount: 900 } as ReturnType<typeof line>], { discount: 0 }))
assert.equal(r.status, 201, 'unos descuentos que no cuadran no rechazan la venta (ya salió la mercancía)')
assert.ok((r.body.sale.reviewNotes as string[]).some((n) => /descuentos de los productos/.test(n)), 'pero se anota para revisar')
r = await call('POST', '/api/sales/offline', offline(UUID(43), [line('A1', 2000)], { payMethod: 'transferencia', transferAccount: 'banco-inventado' }))
assert.equal(r.status, 201, 'una cuenta que no existe no rechaza la venta (ya salió la mercancía)')
assert.equal(r.body.sale.transferAccount, undefined)
ok('el nombre y los permisos son los de quien hizo la venta, sin pasar nunca de lo que puede quien la envía: lo que no pudo autorizar sin conexión queda anotado, y el propietario no deja notas')

// ─── 5. What can't be a sale is refused ──────────────────────────────────────────────────────────
const refused = async (body: unknown, why: string) => {
  const res = await call('POST', '/api/sales/offline', body)
  assert.equal(res.status, 400, `${why}: ${JSON.stringify(res.body)}`)
}
const before = await count('sales')
await refused({ ...offline(UUID(40), [line('A1', 2000)]), clientId: undefined }, 'sin identificador')
await refused({ ...offline(UUID(40), [line('A1', 2000)]), clientId: 'corto' }, 'identificador mal formado')
await refused({ ...offline(UUID(40), [line('A1', 2000)]), payMethod: 'cheque' }, 'forma de pago inventada')
await refused({ ...offline(UUID(40), [line('A1', 2000)]), items: [] }, 'sin productos')
await refused({ ...offline(UUID(40), [line('A1', 2000)]), items: 'x' }, 'productos que no son una lista')
await refused(offline(UUID(40), [line('A1', 2000, 0)]), 'cantidad cero')
await refused(offline(UUID(40), [line('A1', 2000, -1)]), 'cantidad negativa')
await refused(offline(UUID(40), [line('A1', -5)]), 'precio negativo')
await refused(offline(UUID(40), [{ ...line('A1', 2000), code: '' }]), 'sin código')
await refused(offline(UUID(40), Array.from({ length: 501 }, () => line('A1', 1))), 'demasiadas líneas')
assert.equal((await call('POST', '/api/sales/offline', undefined)).status, 400)
assert.equal(await count('sales'), before, 'nada de eso dejó una venta')
assert.equal((await call('POST', '/api/sales/offline', offline(UUID(41), [line('A1', 2000)]), {})).status, 401, 'sin sesión no se guarda nada')
assert.equal((await call('POST', '/api/sales/offline', offline(UUID(41), [line('A1', 2000)]), { 'x-test-session': 'dev-x', 'x-test-email': 'intruso@x.com' })).status, 403, 'ni con la cuenta de un desconocido')
assert.equal(await count('sales'), before)
ok('lo que no puede ser una venta se rechaza (400) sin guardar nada, y sin cuenta de la tienda no entra nada')

// ─── 6. The owner marks what he read ─────────────────────────────────────────────────────────────
const flagged = (await call('POST', '/api/sales/offline', offline(UUID(50), [line('A1', 1234)]))).body.sale.id as number
let rv = await call('POST', `/api/sales/${flagged}/review`, {}, PEPE)
assert.equal(rv.status, 403, 'un practicante no marca revisadas')
assert.equal(rv.body.need, 'facturas.corregir')
rv = await call('POST', `/api/sales/${flagged}/review`)
assert.equal(rv.status, 200)
assert.ok(rv.body.reviewedAt)
assert.equal(rv.body.reviewedBy, 'Propietario')
assert.ok(rv.body.reviewNotes.length, 'las notas se conservan')
const reviewedAt = rv.body.reviewedAt
assert.equal((await call('POST', `/api/sales/${flagged}/review`)).body.reviewedAt, reviewedAt, 'marcarla otra vez no cambia nada')
assert.equal((await call('POST', `/api/sales/${strictId}/review`)).body.reviewedAt, undefined, 'una venta sin notas no se marca')
assert.equal((await call('POST', '/api/sales/999999/review')).status, 404)
ok('el propietario marca como revisada una venta con notas: queda quién y cuándo, y las notas se conservan')

// ─── 7. Sent in order, one sale each ─────────────────────────────────────────────────────────────
const ids: number[] = []
for (const k of [60, 61, 62]) ids.push((await call('POST', '/api/sales/offline', offline(UUID(k), [line('A1', 2000)]))).body.sale.id)
assert.ok(ids[0] < ids[1] && ids[1] < ids[2], 'las ventas pendientes entran en el orden en que se mandan')
// The index under the check: even a request that slipped past it can't make a second sale with the same code.
await assert.rejects(() => lite.query(`insert into public.sales (data) values ($1)`, [JSON.stringify({ clientId: UUID(60), total: 1 })]), /unique|duplicate/i)
ok('las ventas pendientes entran en orden, y la base de datos misma impide dos ventas con el mismo código')

// ─── 8. A database that can't be reached is not "a rule that was broken" ─────────────────────────
for (const err of [
  Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }),
  Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
  Object.assign(new Error('remaining connection slots are reserved'), { code: '53300' }),
  Object.assign(new Error('connection failure'), { code: '08006' }),
  new Error('Connection terminated unexpectedly'),
  new Error('timeout exceeded when trying to connect'),
]) assert.equal(isDatabaseDown(err), true, String(err.message))
for (const err of [
  Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }),
  Object.assign(new Error('invalid input syntax for type bigint'), { code: '22P02' }),
  new Error('Stock insuficiente de "Balde" (quedan 1)'),
  new HttpError(409, 'Ese código ya existe'),
]) assert.equal(isDatabaseDown(err), false, String(err.message))
const broken: Db = { ...db, tx: async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }) } }
const brokenServer = createApp(broken, fakeAuth).listen(0)
const brokenBase = `http://127.0.0.1:${(brokenServer.address() as AddressInfo).port}`
for (const [path, body] of [['/api/sales/finalize', strict], ['/api/sales/offline', offline(UUID(70), [line('A1', 2000)])]] as const) {
  const res = await call('POST', path, body, OWNER, brokenBase)
  assert.equal(res.status, 503, `${path}: la base de datos caída es 503, no 400`)
  assert.equal(JSON.stringify(res.body).includes('10.0.0.1'), false, 'y sin la dirección interna')
  assert.equal(res.body.down, true, 'y lleva la marca que le dice a la app que el servidor no está al alcance (otros 503, como "correo sin configurar", no la llevan)')
}
brokenServer.close()
ok('una base de datos que no responde contesta 503 (sin datos internos) en vez de un error de regla, para que la app sepa que el servidor no está al alcance')

// ─── 9. The installed apps (.exe, .apk) call the API from another origin ──────────────────────────
const preflight = await fetch(base + '/api/sales/offline', {
  method: 'OPTIONS',
  headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
})
assert.equal(preflight.status, 204, 'el permiso previo del navegador se contesta sin haber iniciado sesión')
assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/i)
assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/)
assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://localhost' } })).headers.get('access-control-allow-origin'), '*', 'y las respuestas normales también lo llevan')
assert.equal((await call('POST', '/api/sales/offline', offline(UUID(80), [line('A1', 2000)]), {})).status, 401, 'abrir el origen no abre nada: sin sesión sigue siendo 401')
ok('la API acepta a las apps instaladas (permiso previo y cabeceras) sin dejar pasar a nadie sin sesión')

// ─── 10. A connection that drops in the middle of a transaction must not take the whole API down ──────────
// (it did: with the internet blinking, the pooler's connection died between two queries of a route, nobody was
// listening to it, and Node ended the process.)
const dropped = Object.assign(new EventEmitter(), {
  released: undefined as unknown,
  async query(text: string) {
    if (/select 1/.test(text)) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' })
    return { rows: [] }
  },
  release(err?: unknown) {
    this.released = err
  },
})
const droppingPool = { connect: async () => dropped, on() {}, end: async () => {} } as unknown as pg.Pool
const fragile = pgDb('postgres://sin-red', 1, droppingPool)
await assert.rejects(
  fragile.tx(async (q) => {
    assert.ok(dropped.listenerCount('error') > 0, 'mientras la transacción tiene la conexión, alguien escucha sus errores (si no, un corte mata el proceso)')
    await q.query('select 1') // the drop shows here
  }),
  (err: unknown) => isDatabaseDown(err),
)
assert.equal(dropped.listenerCount('error'), 0, 'y al terminar no deja nada escuchando')
assert.equal(dropped.released, false, 'una conexión sin errores se devuelve al grupo')
dropped.removeAllListeners()
await assert.rejects(
  fragile.tx(async () => {
    dropped.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })) // the drop between two queries
    throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' })
  }),
)
assert.equal(dropped.released, true, 'una conexión que se cortó se descarta en vez de devolverse')
ok('si la conexión con la base se corta en medio de una transacción, la API no se cae: la operación falla (503) y esa conexión se descarta')

server.close()
await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones de ventas sin internet pasaron.`)
