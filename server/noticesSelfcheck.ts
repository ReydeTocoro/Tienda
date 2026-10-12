/** Self-check of the notices — what the bell, the daily "Pendientes de hoy" sheet and the rest screen say is waiting
 * (src/features/notifications/lib/notices.ts): payables by due date, the caja left open, sales made without internet,
 * stock that ran out or reached its minimum, fiados and orders not yet received; each one only when this person may see
 * it, the most serious first. It lives here because this folder is where tsx is set up:  npm run check:notices */
import assert from 'node:assert/strict'
import { buildNotices, countdownParts, duePhrase, MAX_LINES, nextServiceDue, OLD_DEBT_DAYS, SERVICE_PAYMENT_DAY, urgentCount, type NoticeInput } from '../src/features/notifications/lib/notices'
import { addDaysToKey } from '../src/shared/lib/cash'
import type { Payable, PurchaseOrder } from '../src/types/purchaseOrder'
import type { Product } from '../src/types/product'

let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

const TODAY = '2026-10-13'
const day = (d: number) => addDaysToKey(TODAY, d)
const none: NoticeInput = { today: TODAY, outbox: { pending: 0, rejected: 0 } }
const ids = (input: Partial<NoticeInput>) => buildNotices({ ...none, ...input }).map((x) => x.id)
const one = (input: Partial<NoticeInput>, id: string) => buildNotices({ ...none, ...input }).find((x) => x.id === id)

let pid = 0
const payable = (supplierName: string, dueIn: number, amount: number, paid = 0): Payable => ({
  id: ++pid,
  supplierId: supplierName,
  supplierName,
  orderId: pid,
  amount,
  paid,
  issuedAt: `${day(-30)}T15:00:00Z`,
  dueDate: day(dueIn),
  payments: [],
})
const product = (code: string, stock: number, min: number, name = code): Product => ({ code, name, price: 1000, stock, min, cat: '', brand: '', unit: 'unidad', esPaquete: false })

// Nothing to say: no notices at all; and what this person can't see (undefined) gives nothing either.
assert.deepEqual(ids({}), [])
assert.deepEqual(ids({ payables: [], products: [], debtors: [], orders: [], caja: null }), [])
ok('sin pendientes no hay avisos')

// Payables: the phrase of each due date.
assert.equal(duePhrase(-3), 'Venció hace 3 días')
assert.equal(duePhrase(-1), 'Venció ayer')
assert.equal(duePhrase(0), 'Vence hoy')
assert.equal(duePhrase(1), 'Vence mañana')
assert.equal(duePhrase(5), 'Vence en 5 días')
ok('cómo se dice cada vencimiento (hace N días, ayer, hoy, mañana, en N días)')

// Paid ones are left out; with only ones far ahead the notice is blue (informative), within the week orange, overdue red.
assert.equal(one({ payables: [payable('Pagado', -5, 1000, 1000)] }, 'pagos'), undefined)
assert.equal(one({ payables: [payable('Lejos', 20, 1000)] }, 'pagos')?.tone, 'blue')
assert.equal(one({ payables: [payable('Lejos', 20, 1000), payable('Semana', 3, 500)] }, 'pagos')?.tone, 'orange')
assert.equal(one({ payables: [payable('Hoy', 0, 500)] }, 'pagos')?.tone, 'red')
assert.equal(one({ payables: [payable('Vieja', -2, 500, 100)] }, 'pagos')?.tone, 'red')
ok('pagos: las pagadas no cuentan; vencida u hoy = rojo, esta semana = naranja, más adelante = azul')

const pagos = one({ payables: [payable('Lejos', 20, 1000), payable('Semana', 3, 500), payable('Vieja', -2, 800, 300), payable('Hoy', 0, 200), payable('Pagado', -9, 50, 50)] }, 'pagos')!
assert.equal(pagos.amount, 2200) // 1000 + 500 + 500 + 200
assert.deepEqual(pagos.figures, [
  { label: 'Vencido', amount: 500, tone: 'red' },
  { label: 'Vence en los próximos 7 días', amount: 700, tone: 'orange' },
])
assert.deepEqual(
  pagos.lines.map((l) => [l.label, l.detail?.replace(/^#P\d+ · /, ''), l.amount, l.tone]),
  [
    ['Vieja', 'Venció hace 2 días', 500, 'red'],
    ['Hoy', 'Vence hoy', 200, 'red'],
    ['Semana', 'Vence en 3 días', 500, 'orange'],
    ['Lejos', 'Vence en 20 días', 1000, undefined],
  ],
)
assert.ok(pagos.detail.startsWith('4 cuentas por pagar'), pagos.detail)
assert.equal(pagos.to, '/proveedores?tab=porpagar')
ok('pagos: total que se debe, lo vencido y lo de la semana aparte, y las cuentas de la más urgente a la más lejana')

// The caja: open since an earlier day = the Cierre Z is missing; open today or closed = nothing.
assert.equal(one({ caja: { key: 'menor', started: true, open: true, dayKey: TODAY } }, 'caja'), undefined)
assert.equal(one({ caja: { key: 'menor', started: true, open: false, dayKey: day(-3) } }, 'caja'), undefined)
const caja = one({ caja: { key: 'menor', started: true, open: true, dayKey: day(-1) } }, 'caja')
assert.equal(caja?.tone, 'red')
assert.match(caja!.detail, /desde el 12 .*oct/)
ok('caja: abierta desde un día anterior avisa que falta el Cierre Z; abierta hoy o cerrada no')

// Sales made without internet: rejected ones are red (and say how many more wait), waiting ones orange.
assert.equal(one({ outbox: { pending: 2, rejected: 0 } }, 'sinInternet')?.tone, 'orange')
const rejected = one({ outbox: { pending: 2, rejected: 1 } }, 'sinInternet')!
assert.equal(rejected.tone, 'red')
assert.match(rejected.detail, /1 venta hecha .* 2 más por enviar/)
ok('ventas sin internet: rechazadas en rojo, por enviar en naranja')

// Stock: out = stock 0 or less (whatever its minimum); low = still some, at or under a minimum that was set.
const products = [product('OK', 10, 5), product('AT_MIN', 5, 5, 'Justo en el mínimo'), product('UNDER', 1, 4, 'Casi nada'), product('ZERO_NOMIN', 0, 0, 'Sin mínimo'), product('ZERO_MIN', 0, 3, 'Con mínimo'), product('NO_MIN', 1, 0)]
const out = one({ products }, 'agotados')!
assert.deepEqual(
  out.lines.map((l) => l.label),
  ['Con mínimo', 'Sin mínimo'],
)
assert.equal(out.tone, 'red')
const low = one({ products }, 'stockBajo')!
assert.deepEqual(
  low.lines.map((l) => [l.label, l.detail]),
  [
    ['Casi nada', 'Quedan 1 · mínimo 4'],
    ['Justo en el mínimo', 'Quedan 5 · mínimo 5'],
  ],
)
assert.equal(low.tone, 'orange')
ok('stock: agotado = sin unidades (los que tienen mínimo primero); bajo = llegó a su mínimo o por debajo; sin mínimo no es bajo')

// Fiados: blue while recent, orange once one debt is OLD_DEBT_DAYS old; the biggest debt first.
const fiados = one({ debtors: [{ name: 'Ana', debt: 5000, since: day(-2) }, { name: 'Luis', debt: 9000, since: TODAY }, { name: 'Paga', debt: 0, since: day(-90) }] }, 'fiados')!
assert.equal(fiados.tone, 'blue')
assert.equal(fiados.amount, 14000)
assert.deepEqual(
  fiados.lines.map((l) => [l.label, l.detail]),
  [
    ['Luis', 'Debe desde hoy'],
    ['Ana', 'Debe desde hace 2 días'],
  ],
)
const oldFiado = one({ debtors: [{ name: 'Ana', debt: 5000, since: day(-OLD_DEBT_DAYS) }] }, 'fiados')!
assert.equal(oldFiado.tone, 'orange')
assert.match(oldFiado.detail, /hace 30 días/)
ok('fiados: quién debe, de mayor a menor; naranja cuando una deuda pasa de 30 días')

// Orders sent and not received, the oldest first; drafts and received ones are not pending.
const order = (id: number, status: PurchaseOrder['status'], orderedDay: number): PurchaseOrder => ({
  id,
  supplierId: 's',
  supplierName: `Prov ${id}`,
  status,
  lines: [],
  total: 1000 * id,
  paymentTerms: { kind: 'contado' },
  createdAt: `${day(orderedDay)}T15:00:00Z`,
  orderedAt: `${day(orderedDay)}T15:00:00Z`,
})
const pedidos = one({ orders: [order(1, 'pedido', -1), order(2, 'borrador', -9), order(3, 'pedido', -6), order(4, 'recibido', -9)] }, 'pedidos')!
assert.deepEqual(
  pedidos.lines.map((l) => [l.label, l.detail]),
  [
    ['Prov 3', '#P0003 · pedido hace 6 días'],
    ['Prov 1', '#P0001 · pedido ayer'],
  ],
)
assert.equal(pedidos.amount, 4000)
ok('pedidos por recibir: solo los enviados, el más viejo primero')

// The most serious first; the payables lead among equals. The bell counts what asks for action (red/orange).
const all = buildNotices({
  today: TODAY,
  payables: [payable('Lejos', 20, 1000)],
  products,
  debtors: [{ name: 'Ana', debt: 5000, since: day(-2) }],
  orders: [order(1, 'pedido', -1)],
  caja: { key: 'menor', started: true, open: true, dayKey: day(-1) },
  outbox: { pending: 1, rejected: 0 },
})
assert.deepEqual(
  all.map((x) => x.id),
  ['caja', 'agotados', 'sinInternet', 'stockBajo', 'pagos', 'fiados', 'pedidos'],
)
assert.equal(urgentCount(all), 4)
const overdue = buildNotices({ ...none, payables: [payable('Vieja', -1, 10)], caja: { key: 'menor', started: true, open: true, dayKey: day(-1) } })
assert.deepEqual(
  overdue.map((x) => x.id),
  ['pagos', 'caja'],
)
ok('orden: rojo, naranja, azul — los pagos primero entre iguales; la campana cuenta los rojos y naranjas')

// The system's monthly payment (day 13): reminded from 2 days before, the day itself included; only to whoever gets it
// (the Administrador); hidden with "Ya pagué" until the next month's; always first.
assert.equal(SERVICE_PAYMENT_DAY, 13)
assert.equal(nextServiceDue('2026-10-01'), '2026-10-13')
assert.equal(nextServiceDue('2026-10-13'), '2026-10-13')
assert.equal(nextServiceDue('2026-10-14'), '2026-11-13')
assert.equal(nextServiceDue('2026-12-20'), '2027-01-13')
const admin = (today: string, dismissed: string[] = []) => buildNotices({ ...none, today, servicePayment: { dismissed } }).find((x) => x.id === 'mensualidad')
assert.equal(admin('2026-10-10'), undefined)
assert.match(admin('2026-10-11')!.detail, /^Vence en 2 días \(el .*13 de octubre\)\. Si ya pagaste, omite este mensaje\.$/)
assert.match(admin('2026-10-12')!.detail, /^Vence mañana/)
assert.match(admin('2026-10-13')!.detail, /^Vence hoy/)
assert.equal(admin('2026-10-14'), undefined)
assert.equal(admin('2026-10-13')!.tone, 'red')
assert.equal(buildNotices({ ...none, today: '2026-10-12' }).length, 0) // without servicePayment: not for this person
assert.equal(admin('2026-10-12', ['mensualidad:2026-10-13']), undefined)
assert.ok(admin('2026-11-11', ['mensualidad:2026-10-13']), 'hiding October does not hide November')
assert.equal(admin('2026-10-12')!.dismissKey, 'mensualidad:2026-10-13')
// It counts down to the end of the 13th in Bogotá (UTC-5).
const deadline = admin('2026-10-11')!.deadline!
assert.equal(deadline, Date.parse('2026-10-14T05:00:00Z'))
assert.deepEqual(countdownParts(deadline, Date.parse('2026-10-11T10:00:00-05:00')), { days: 2, hours: 14, minutes: 0, seconds: 0 })
assert.deepEqual(countdownParts(deadline, Date.parse('2026-10-13T23:58:30-05:00')), { days: 0, hours: 0, minutes: 1, seconds: 30 })
assert.deepEqual(countdownParts(deadline, deadline + 5000), { days: 0, hours: 0, minutes: 0, seconds: 0 })
const first = buildNotices({ ...none, today: '2026-10-12', servicePayment: { dismissed: [] }, payables: [payable('Vieja', -1, 10)], caja: { key: 'menor', started: true, open: true, dayKey: day(-3) } })
assert.deepEqual(
  first.map((x) => x.id),
  ['mensualidad', 'pagos', 'caja'],
)
ok('pago mensual del sistema: del 11 al 13, primero y en rojo, cuenta regresiva hasta el fin del 13, "Ya pagué" lo oculta hasta el mes siguiente')

// Long lists are cut, saying how many were left out.
const many = one({ products: Array.from({ length: MAX_LINES + 3 }, (_, i) => product(`P${i}`, 0, 0, `Producto ${String(i).padStart(2, '0')}`)) }, 'agotados')!
assert.equal(many.lines.length, MAX_LINES)
assert.equal(many.more, 3)
assert.match(many.detail, /^11 productos/)
ok(`las listas largas muestran ${MAX_LINES} y dicen cuántas faltan`)

console.log(`\n${n} comprobaciones de los avisos correctas`)
