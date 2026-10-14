/* Browser check of the client logic of selling without internet (src/offline, src/api/client.ts, the sync's part in it
 * and the charging flow), against the in-memory API of apiServer.ts — never the Supabase data. It runs in a real
 * browser because it needs IndexedDB, fetch with timeouts and real connections that get cut. Prints one JSON line into
 * #out when done. Run it with:  npm run check:offline-browser */
import { ApiError, apiPost, NetworkError, onBeforeBooksWrite } from '../../../src/api/client'
import { db } from '../../../src/db'
import { probeNow } from '../../../src/offline/connection'
import { discardSale, holdBack, outboxCounts, reconcileSales, retrySale, saveSaleOffline, settleSale } from '../../../src/offline/outbox'
import { flushBeforeBooksWrite, processOutbox } from '../../../src/offline/outboxSync'
import { newClientId } from '../../../src/shared/lib/id'
import { useCartStore } from '../../../src/store/useCartStore'
import { useConnectionStore } from '../../../src/store/useConnectionStore'
import { useToastStore } from '../../../src/store/useToastStore'
import { useFinalizeSale } from '../../../src/features/pos/hooks/useFinalizeSale'
import type { Product } from '../../../src/types/product'
import type { Sale } from '../../../src/types/sale'

const API = String(import.meta.env.VITE_API_URL)
const results: Array<{ ok: boolean; label: string; detail?: string }> = []
const check = (label: string, cond: unknown, detail?: unknown) => {
  results.push({ ok: !!cond, label, detail: cond ? undefined : JSON.stringify(detail) })
}
const ctl = async (path: string, body?: unknown) =>
  (await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json()
const mode = (m: Record<string, unknown>) => ctl('/__test/mode', m)
const state = () => ctl('/__test/state') as Promise<{ stocks: Record<string, number>; sales: Array<Record<string, any>>; movements: number; mode: unknown; log: string[] }>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PRODUCTS: Product[] = [
  { code: 'A1', name: 'Balde', price: 2000, price2: 1800, stock: 50, min: 0, cat: '', brand: '', unit: 'unidad', esPaquete: false },
  { code: 'B2', name: 'Ponchera', price: 5000, stock: 3, min: 0, cat: '', brand: '', unit: 'unidad', esPaquete: false },
  { code: 'C3', name: 'Cuerda', price: 4000, stock: 20, min: 0, cat: '', brand: '', unit: 'm', esPaquete: false },
]
async function reset() {
  await ctl('/__test/reset', {})
  await db.outbox.clear()
  await db.sales.clear()
  await db.products.clear()
  await db.products.bulkPut(PRODUCTS.map((p) => ({ ...p })))
  useConnectionStore.getState().setReachable(true)
  useToastStore.getState().hide()
  useCartStore.setState((s) => ({ carts: s.carts.map((c) => ({ ...c, items: [], payMethod: 'efectivo', customerId: null, customerName: null, amountReceived: 10_000_000 })) }))
}
const line = (code: string, price: number, qty = 1) => ({ code, name: code, price, qty, brand: '', unit: code === 'C3' ? 'm' : 'unidad', isFree: false })
const sale = (items: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) => {
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0)
  return { clientId: newClientId(), items, subtotal, discount: 0, total: subtotal, payMethod: 'efectivo' as const, ...extra }
}
const stockOf = async (code: string) => (await db.products.get(code))?.stock

async function main() {
  // ── T1: a sale kept on the device ───────────────────────────────────────────────────────────────
  await reset()
  const in1 = sale([line('A1', 2000, 2)])
  const s1 = await saveSaleOffline(in1)
  check('T1 la venta provisional tiene id negativo y su número PEND', (s1.id ?? 0) < 0 && s1.refLocal === `PEND-${String(-(s1.id ?? 0)).padStart(4, '0')}` && s1.pendingSync === true, s1)
  const a1 = await db.products.get('A1')
  check('T1 el stock local baja (48) y se guarda el del servidor (50)', a1?.stock === 48 && a1?.serverStock === 50, a1)
  check('T1 queda en la cola y en las ventas locales', (await db.outbox.count()) === 1 && !!(await db.sales.get(s1.id!)))
  const again = await saveSaleOffline(in1)
  check('T1 guardar dos veces el mismo código devuelve la misma venta y no descuenta de nuevo', again.id === s1.id && (await stockOf('A1')) === 48 && (await db.outbox.count()) === 1, { again, stock: await stockOf('A1') })

  // ── T2: the server is down: nothing is lost ─────────────────────────────────────────────────────
  await mode({ kind: 'down' })
  const r2 = await processOutbox({ force: true })
  const e2 = (await db.outbox.toArray())[0]
  check('T2 sin servidor: se detiene "offline" y la venta sigue esperando', r2.stoppedBy === 'offline' && r2.sent === 0 && r2.left === 1, r2)
  check('T2 se anota el intento', e2.attempts === 1 && !!e2.lastError && e2.status === 'pending', e2)
  check('T2 la app sabe que no hay servidor', useConnectionStore.getState().reachable === false)
  check('T2 el servidor no recibió nada', (await state()).stocks.A1 === 50)

  // ── T3: it comes back: sent, settled ────────────────────────────────────────────────────────────
  await mode({ kind: 'ok' })
  const r3 = await processOutbox({ force: true })
  const st3 = await state()
  check('T3 se envía 1 y no queda ninguna', r3.sent === 1 && r3.left === 0, r3)
  check('T3 el servidor tiene 1 venta con el mismo código, marcada sin internet, y el stock 48', st3.sales.length === 1 && st3.sales[0].clientId === in1.clientId && st3.sales[0].offline === true && st3.stocks.A1 === 48, st3)
  check('T3 la caja se movió una sola vez', st3.movements === 1, st3.movements)
  check('T3 la cola y la venta provisional se van; entra la venta real', (await db.outbox.count()) === 0 && !(await db.sales.get(s1.id!)) && !!(await db.sales.get(st3.sales[0].id)) && !(await db.sales.get(st3.sales[0].id))?.pendingSync)
  const a3 = await db.products.get('A1')
  check('T3 el stock local queda en 48 sin la marca del servidor', a3?.stock === 48 && a3?.serverStock === undefined, a3)
  check('T3 la app vuelve a ver el servidor', useConnectionStore.getState().reachable === true)

  // ── T4: the answer gets lost, the sale does not duplicate ───────────────────────────────────────
  // (Chrome retries a POST by itself when a reused connection dies before any answer, so two answers are lost.)
  await reset()
  const in4 = sale([line('B2', 5000, 1)])
  await saveSaleOffline(in4)
  await mode({ kind: 'lostAnswer', times: 2, path: '/api/sales/offline' })
  const r4 = await processOutbox({ force: true })
  const st4a = await state()
  check('T4 la respuesta se pierde: la app cree que falló y la venta sigue en la cola', r4.stoppedBy === 'offline' && r4.left === 1, r4)
  check('T4 pero el servidor sí la guardó (una vez)', st4a.sales.length === 1 && st4a.stocks.B2 === 2, st4a)
  const r4b = await processOutbox({ force: true })
  const st4b = await state()
  check('T4 al reenviar, el servidor reconoce el código: sigue siendo UNA venta, un movimiento de caja', r4b.sent === 1 && r4b.left === 0 && st4b.sales.length === 1 && st4b.stocks.B2 === 2 && st4b.movements === 1, { r4b, st4b })
  check('T4 el stock local queda en 2', (await stockOf('B2')) === 2 && (await db.products.get('B2'))?.serverStock === undefined)

  // ── T5: several sales, one fails with a 500: the rest still go ──────────────────────────────────
  await reset()
  const ins = [1, 2, 3].map((q) => sale([line('A1', 2000, q)]))
  for (const i of ins) await saveSaleOffline(i)
  check('T5 con tres ventas pendientes el stock local es 44', (await stockOf('A1')) === 44, await stockOf('A1'))
  await mode({ kind: 'status', status: 500, times: 1, path: '/api/sales/offline' })
  const r5 = await processOutbox({ force: true })
  const left5 = await db.outbox.toArray()
  check('T5 un 500 en la primera la deja esperando y las otras dos se envían', r5.sent === 2 && r5.left === 1 && !r5.stoppedBy && left5.length === 1 && left5[0].clientId === ins[0].clientId && left5[0].attempts === 1, { r5, left5 })
  check('T5 mientras tanto el stock local sigue siendo 44', (await stockOf('A1')) === 44, await stockOf('A1'))
  const r5b = await processOutbox({ force: true })
  const st5 = await state()
  check('T5 en la siguiente vuelta sale la que faltaba', r5b.sent === 1 && r5b.left === 0 && st5.sales.length === 3 && st5.stocks.A1 === 44, { r5b, st5 })
  check('T5 y el stock local sigue en 44 sin marcas', (await stockOf('A1')) === 44 && (await db.products.get('A1'))?.serverStock === undefined)
  const order = st5.sales.map((s) => s.clientId)
  check('T5 el servidor las tiene con el orden de llegada (2.ª, 3.ª y luego la 1.ª)', order[0] === ins[1].clientId && order[1] === ins[2].clientId && order[2] === ins[0].clientId, order)

  // ── T6: the server refuses a sale: rejected, stock back, retry, discard ─────────────────────────
  await reset()
  const in6 = sale([line('A1', 2000, 1)], { payMethod: 'bitcoin' })
  await saveSaleOffline(in6 as never)
  check('T6 antes de enviar, el stock local es 49', (await stockOf('A1')) === 49)
  const r6 = await processOutbox({ force: true })
  const e6 = (await db.outbox.toArray())[0]
  check('T6 el servidor la rechaza (400): queda "rechazada", no se reintenta sola', r6.sent === 0 && r6.left === 0 && e6.status === 'rejected' && !!e6.lastError && !r6.stoppedBy, { r6, e6 })
  check('T6 una rechazada ya no retiene stock', (await stockOf('A1')) === 50, await stockOf('A1'))
  const r6b = await processOutbox({ force: true })
  check('T6 y no se vuelve a enviar', r6b.sent === 0 && (await state()).log.length === 0, r6b)
  await retrySale(in6.clientId)
  check('T6 "Reintentar" la vuelve a poner en espera y vuelve a retener el stock', (await db.outbox.toArray())[0].status === 'pending' && (await stockOf('A1')) === 49)
  await processOutbox({ force: true })
  check('T6 el servidor la rechaza otra vez', (await db.outbox.toArray())[0].status === 'rejected')
  await discardSale(in6.clientId)
  check('T6 "Descartar" la borra del equipo y devuelve el stock', (await db.outbox.count()) === 0 && (await db.sales.count()) === 0 && (await stockOf('A1')) === 50)
  const counts6 = await outboxCounts()
  check('T6 contadores en cero', counts6.pending === 0 && counts6.rejected === 0)

  // ── T7: how the sync writes interact with a pending sale ────────────────────────────────────────
  await reset()
  const in7 = sale([line('B2', 5000, 1)])
  const s7 = await saveSaleOffline(in7)
  const entry7 = (await db.outbox.toArray())[0]
  // The server takes the sale (here, directly: the answer is "lost" on purpose).
  const direct = await apiPost<{ sale: Sale }>('/api/sales/offline', entry7.payload)
  // (a) the PRODUCT arrives first (server stock 2): a sale still waiting holds it back again — for a moment.
  await db.transaction('rw', db.products, db.outbox, async () => {
    const rows = await holdBack([{ ...PRODUCTS[1], stock: 2 }])
    await db.products.bulkPut(rows)
  })
  const mid = await db.products.get('B2')
  check('T7a llega el producto antes que la venta: retiene de nuevo (1) y recuerda el del servidor (2)', mid?.stock === 1 && mid?.serverStock === 2, mid)
  // (b) then the SALE arrives through the sync.
  await db.transaction('rw', db.sales, db.outbox, db.products, async () => {
    await db.sales.put(direct.sale)
    await reconcileSales([direct.sale])
  })
  const fin = await db.products.get('B2')
  check('T7b llega la venta: la cola y la provisional se van y el stock queda en 2', (await db.outbox.count()) === 0 && !(await db.sales.get(s7.id!)) && fin?.stock === 2 && fin?.serverStock === undefined, { fin })
  // the other way round
  await reset()
  const in7b = sale([line('B2', 5000, 1)])
  await saveSaleOffline(in7b)
  const entry7b = (await db.outbox.toArray())[0]
  const direct2 = await apiPost<{ sale: Sale }>('/api/sales/offline', entry7b.payload)
  await db.transaction('rw', db.sales, db.outbox, db.products, async () => {
    await db.sales.put(direct2.sale)
    await reconcileSales([direct2.sale])
  })
  const mid2 = await db.products.get('B2')
  check('T7c llega la venta antes que el producto: el stock vuelve al último del servidor (3) un instante', mid2?.stock === 3 && (await db.outbox.count()) === 0, mid2)
  await db.transaction('rw', db.products, db.outbox, async () => {
    await db.products.bulkPut(await holdBack([{ ...PRODUCTS[1], stock: 2 }]))
  })
  check('T7d …y al llegar el producto queda en 2', (await stockOf('B2')) === 2 && (await db.products.get('B2'))?.serverStock === undefined)
  // a full download empties `sales` first: the sales that only exist here must survive it
  await reset()
  await saveSaleOffline(sale([line('A1', 2000, 1)]))
  await saveSaleOffline(sale([line('C3', 4000, 2)]))
  await db.transaction('rw', db.sales, db.outbox, db.products, async () => {
    await db.sales.clear()
    await reconcileSales([])
  })
  const kept = await db.sales.toArray()
  check('T7e tras una descarga completa las ventas provisionales siguen ahí', kept.length === 2 && kept.every((k) => (k.id ?? 0) < 0 && k.pendingSync), kept)
  // settleSale without being on the outbox any more is a no-op
  check('T7f cerrar dos veces la misma venta no hace nada la segunda', (await settleSale('no-existe')) === false)

  // ── T8: before stock/caja writes the pending sales go first ─────────────────────────────────────
  await reset()
  onBeforeBooksWrite(flushBeforeBooksWrite)
  await saveSaleOffline(sale([line('A1', 2000, 2)]))
  const ent = await apiPost<{ stock: number }>('/api/entradas', { code: 'C3', qty: 5, source: 'prueba' })
  const st8 = await state()
  check('T8 antes de una entrada de mercancía se envían las ventas pendientes', (await db.outbox.count()) === 0 && st8.sales.length === 1 && st8.stocks.A1 === 48 && st8.stocks.C3 === 25 && !!ent, st8)
  await saveSaleOffline(sale([line('A1', 2000, 1)]))
  await mode({ kind: 'status', status: 500, times: 3, path: '/api/sales/offline' })
  let blocked = ''
  try {
    await apiPost('/api/entradas', { code: 'C3', qty: 1, source: 'prueba' })
  } catch (e) {
    blocked = e instanceof Error ? e.message : String(e)
  }
  const st8b = await state()
  check('T8b si las pendientes no se pueden enviar, la entrada NO se hace y se explica por qué', blocked.includes('ventas hechas sin internet') && st8b.stocks.C3 === 25, { blocked, st8b })
  await mode({ kind: 'ok' })
  await processOutbox({ force: true })

  // ── T9: timeouts turn a hanging server into an error ────────────────────────────────────────────
  await reset()
  await mode({ kind: 'hang', path: '/api/entradas', times: 1 })
  const t0 = Date.now()
  let err9: unknown
  try {
    await apiPost('/api/entradas', { code: 'C3', qty: 1, source: 'prueba' }, { timeoutMs: 1500 })
  } catch (e) {
    err9 = e
  }
  const took = Date.now() - t0
  check('T9 un servidor que no contesta termina en el tiempo dado con un error de red', err9 instanceof NetworkError && (err9 as NetworkError).timedOut && took >= 1400 && took < 3500, { err9: String(err9), took })
  check('T9 y la app lo anota como sin servidor', useConnectionStore.getState().reachable === false)

  // ── T10: the connection probe ───────────────────────────────────────────────────────────────────
  await mode({ kind: 'down', path: '/api/health' })
  const p1 = await probeNow()
  check('T10 con el servidor caído la sonda dice que no', p1 === false && useConnectionStore.getState().reachable === false)
  await mode({ kind: 'ok' })
  const p2 = await probeNow()
  check('T10 al volver dice que sí', p2 === true && useConnectionStore.getState().reachable === true)

  // ── T11: charging a cart ────────────────────────────────────────────────────────────────────────
  // It is a plain function that happens to be named like a hook: nothing in it needs a component.
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  const finalize = useFinalizeSale()
  const cartItem = (code: string, qty: number) => {
    const p = PRODUCTS.find((x) => x.code === code)!
    useCartStore.getState().addUnitItem({ code, name: p.name, price: p.price, brand: '', unit: p.unit, stock: 1000 }, qty)
  }
  // (a) online: strict
  await reset()
  cartItem('A1', 2)
  const sA = await finalize()
  const stA = await state()
  check('T11a con servidor: se cobra normal (id positivo), sin cola', !!sA && (sA.id ?? 0) > 0 && (await db.outbox.count()) === 0 && stA.stocks.A1 === 48, { sA, stA })
  check('T11a la venta lleva su código', !!sA?.clientId && stA.sales[0].clientId === sA.clientId)
  check('T11a el carrito se cerró', useCartStore.getState().carts[0].items.length === 0)
  // (b) known to be offline: instant, no waiting
  await reset()
  useConnectionStore.getState().setReachable(false)
  cartItem('A1', 3)
  const tb = Date.now()
  const sB = await finalize()
  const tookB = Date.now() - tb
  check('T11b sin servidor conocido: se guarda en el equipo al instante (id negativo)', !!sB && (sB.id ?? 0) < 0 && tookB < 1500 && (await db.outbox.count()) === 1 && (await stockOf('A1')) === 47, { sB, tookB })
  check('T11b avisa que quedó guardada sin conexión', useToastStore.getState().message?.includes('guardada sin internet') === true, useToastStore.getState().message)
  check('T11b el servidor no supo nada', (await state()).sales.length === 0)
  // (c) the server hangs: after the patience it is kept here
  await reset()
  cartItem('A1', 1)
  await mode({ kind: 'hang', path: '/api/sales/finalize', times: 1 })
  const tc = Date.now()
  const sC = await finalize()
  const tookC = Date.now() - tc
  check('T11c un servidor que no contesta: tras ~10 s la venta se guarda en el equipo', !!sC && (sC.id ?? 0) < 0 && tookC >= 9500 && tookC < 14000 && (await db.outbox.count()) === 1, { sC, tookC })
  // …and the original request may well have been served meanwhile (it was only slow): sending it again must not duplicate it
  await mode({ kind: 'ok' })
  useConnectionStore.getState().setReachable(true)
  const r11c = await processOutbox({ force: true })
  check('T11c al enviarla después queda una sola venta', r11c.sent === 1 && (await state()).sales.length === 1 && (await state()).stocks.A1 === 49, await state())
  // (d) the server fails (500): kept here too
  await reset()
  cartItem('A1', 1)
  await mode({ kind: 'status', status: 500, times: 1, path: '/api/sales/finalize' })
  const sD = await finalize()
  check('T11d un 500 del servidor: la venta no se pierde, queda en el equipo', !!sD && (sD.id ?? 0) < 0 && (await db.outbox.count()) === 1, sD)
  // (e) the server REFUSES the sale (no stock there): not kept — the cashier must know
  await reset()
  await apiPost('/api/products/B2/adjust-stock', { delta: -2, reason: 'prueba' }) // the server has 1; this device still believes 3
  cartItem('B2', 2)
  useToastStore.getState().hide()
  const sE = await finalize()
  check('T11e si el servidor la RECHAZA (sin stock allá) no se guarda: se avisa al cajero', sE === null && (await db.outbox.count()) === 0 && /stock/i.test(useToastStore.getState().message ?? ''), { sE, toast: useToastStore.getState().message })
  check('T11e el carrito sigue con sus productos', useCartStore.getState().carts[0].items.length === 1)
  // (f) double click: the second charge of the same cart is ignored while the first is in flight
  await reset()
  cartItem('A1', 1)
  await mode({ kind: 'hang', path: '/api/sales/finalize', times: 1 })
  const first = finalize()
  await sleep(200)
  const second = await finalize()
  check('T11f un segundo cobro del mismo carrito mientras se guarda el primero se ignora', second === null)
  await first
  check('T11f y solo queda una venta', (await db.outbox.count()) === 1)

  // ── T12: two sends at the same moment are one ───────────────────────────────────────────────────
  await reset()
  await saveSaleOffline(sale([line('A1', 2000, 1)]))
  await saveSaleOffline(sale([line('A1', 2000, 2)]))
  const [x, y] = await Promise.all([processOutbox({ force: true }), processOutbox({ force: true })])
  const st12 = await state()
  check('T12 dos envíos a la vez comparten la misma tarea y cada venta llega una vez', x.sent === 2 && y.sent === 2 && st12.sales.length === 2 && st12.stocks.A1 === 47, { x, y, st12 })

  // ── T13: quantities by weight, with float noise, and more than the stock ─────────────────────────
  await reset()
  await saveSaleOffline(sale([line('C3', 4000, 1.25)]))
  await saveSaleOffline(sale([line('C3', 4000, 0.1)]))
  await saveSaleOffline(sale([line('C3', 4000, 0.2)]))
  check('T13 los decimales no dejan ruido: 20 − 1,25 − 0,1 − 0,2 = 18,45', (await stockOf('C3')) === 18.45, await stockOf('C3'))
  await processOutbox({ force: true })
  const st13 = await state()
  check('T13 el servidor llega a lo mismo (18,45)', st13.stocks.C3 === 18.45 && (await stockOf('C3')) === 18.45, { st13, local: await stockOf('C3') })
  await reset()
  await saveSaleOffline(sale([line('B2', 5000, 5)])) // the device believed there were 5; the server has 3
  const over = await db.products.get('B2')
  check('T13 más de lo que hay: el stock local no baja de 0 (pero recuerda el 3 del servidor)', over?.stock === 0 && over?.serverStock === 3, over)
  await processOutbox({ force: true })
  const st13b = await state()
  check('T13 el servidor guarda la venta igual, deja el stock en 0 y anota "stock insuficiente" para revisar', st13b.sales.length === 1 && st13b.stocks.B2 === 0 && /insuficiente/i.test(String(st13b.sales[0].reviewNotes?.[0])), st13b)

  // ── T14: the whole machine: monitor + automatic sending when the connection returns ─────────────
  await reset()
  const { startOffline } = await import('../../../src/offline')
  await mode({ kind: 'down' })
  await saveSaleOffline(sale([line('A1', 2000, 1)]))
  const stop = startOffline()
  await sleep(2500) // first probe (and its second look) find the server down
  check('T14 con el servidor caído el monitor lo anota', useConnectionStore.getState().reachable === false)
  await mode({ kind: 'ok' })
  window.dispatchEvent(new Event('online'))
  let waited = 0
  while ((await db.outbox.count()) > 0 && waited < 8000) {
    await sleep(250)
    waited += 250
  }
  const st14 = await state()
  check('T14 al volver la conexión la venta se envía sola en pocos segundos', (await db.outbox.count()) === 0 && st14.sales.length === 1 && waited < 5000, { waited, st14 })
  check('T14 y la app vuelve a estar "en línea"', useConnectionStore.getState().reachable === true)
  stop()

  // ── T18: a blip of a few seconds heals on its own, soon ─────────────────────────────────────────────
  await reset()
  const stop18 = startOffline() // its monitor is already waiting a minute for its next look (the server is up)
  await sleep(1500)
  // (Chrome sends a POST again by itself when its connection dies before any answer: both tries must fail.)
  await mode({ kind: 'down', times: 2, path: '/api/entradas' })
  await apiPost('/api/entradas', { code: 'C3', qty: 1, source: 'prueba' }).catch(() => undefined)
  check('T18 una llamada que falla marca el servidor como no alcanzable', useConnectionStore.getState().reachable === false)
  let healed18 = 0
  while (!useConnectionStore.getState().reachable && healed18 < 9000) {
    await sleep(250)
    healed18 += 250
  }
  check('T18 …y como el servidor ya está de vuelta, la app lo da por alcanzable en pocos segundos (no en un minuto)', useConnectionStore.getState().reachable === true && healed18 < 6000, { healed18 })
  stop18()

  // ── T15: a server that doesn't know the route yet (older than the screens) is "not ready": the sale waits ──
  await reset()
  await saveSaleOffline(sale([line('A1', 2000, 1)]))
  await mode({ kind: 'status', status: 404, times: 1, path: '/api/sales/offline' })
  const r15 = await processOutbox({ force: true })
  const e15 = (await db.outbox.toArray())[0]
  check('T15 un servidor que aún no conoce la ruta (404) no rechaza la venta: la deja esperando', r15.stoppedBy === 'offline' && r15.left === 1 && e15?.status === 'pending', { r15, e15 })
  const r15b = await processOutbox({ force: true })
  check('T15 y cuando el servidor ya la conoce, se envía', r15b.sent === 1 && r15b.left === 0 && (await state()).sales.length === 1, r15b)

  // ── T16: which answers mean "the server is down" ────────────────────────────────────────────────
  await reset()
  const entrada = () => apiPost('/api/entradas', { code: 'C3', qty: 1, source: 'prueba' }).catch((e: unknown) => e)
  const reachable = () => useConnectionStore.getState().reachable
  // A 503 of our own API that has nothing to do with the connection (no mail account set up, Supabase refusing an
  // account…): the server is there and the till can sell.
  await mode({ kind: 'status', status: 503, times: 1, path: '/api/entradas' })
  const e16 = await entrada()
  check('T16 un 503 de la propia API que no es una caída (correo sin configurar…) no marca el servidor como caído', e16 instanceof ApiError && e16.status === 503 && reachable() === true, { e16: String(e16), reachable: reachable() })
  await mode({ kind: 'status', status: 503, down: true, times: 1, path: '/api/entradas' })
  await entrada()
  check('T16 el 503 que dice "no llego a mi base de datos" sí', reachable() === false)
  check('T16 y la sonda lo recupera en cuanto contesta', (await probeNow()) === true && reachable() === true)
  await mode({ kind: 'status', status: 502, html: true, times: 1, path: '/api/entradas' })
  await entrada()
  check('T16 la página de un portal (502 que no es JSON) sí es una caída', reachable() === false)
  await mode({ kind: 'status', status: 400, times: 1, path: '/api/entradas' })
  await entrada()
  check('T16 cualquier respuesta propia del servidor, aunque sea un rechazo, lo da por presente', reachable() === true)

  // ── T17: a connection that dies in the middle of an answer ends at the time limit too ───────────────
  await mode({ kind: 'status', status: 200, slow: 6000, times: 1, path: '/api/entradas' })
  const t17 = Date.now()
  const e17 = await apiPost('/api/entradas', { code: 'C3', qty: 1, source: 'prueba' }, { timeoutMs: 1500 }).catch((e: unknown) => e)
  const took17 = Date.now() - t17
  check('T17 un cuerpo que no termina de llegar también se corta a tiempo (no deja el botón girando)', e17 instanceof NetworkError && e17.timedOut && took17 < 3500, { e17: String(e17), took17 })

  await mode({ kind: 'ok' })
}

main()
  .catch((e) => results.push({ ok: false, label: 'EXCEPCIÓN', detail: String(e?.stack ?? e) }))
  .finally(() => {
    const failed = results.filter((r) => !r.ok)
    ;(document.getElementById('out') as HTMLElement).textContent = JSON.stringify({ total: results.length, failed: failed.length, failures: failed, passed: results.filter((r) => r.ok).map((r) => r.label) })
  })
