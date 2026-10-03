/** Self-check for the money logic (cajas, traslados, pedidos, cuentas por pagar, cierre). Runs
 * against a throwaway in-memory Postgres (PGlite) built from the real migration — never the
 * Supabase data:  npm run check:cash */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteDb, type Sql } from './db'
import * as cash from './domain/cash'
import * as buying from './domain/purchasing'
import { confirmCierre } from './domain/cierre'
import { getRow, insertAutoRow, putRow, listAll } from './routes/generic'
import { computeDayAggregate } from '../src/shared/lib/aggregation'
import { addDaysToKey, dueDateFrom } from '../src/shared/lib/cash'
import { todayKey } from '../src/shared/lib/currency'
import type { Product } from '../src/types/product'
import type { Sale } from '../src/types/sale'
import type { CashMovement } from '../src/types/cash'
import type { Payable, PurchaseOrder } from '../src/types/purchaseOrder'

const lite = await PGlite.create()
await lite.exec(fs.readFileSync(new URL('../supabase/migrations/20261002000000_tables.sql', import.meta.url), 'utf8'))
const db = pgliteDb(lite)

/** Same shape as the routes: one transaction per operation, all-or-nothing. Rows a test needs
 * are created before `run`, never inside it (PGlite has a single connection). */
const run = <T>(fn: (q: Sql) => Promise<T>): Promise<T> => db.tx(fn)
const fails = (fn: () => Promise<unknown>, pattern: RegExp, label: string) => assert.rejects(fn, pattern, label)
const bal = (caja: 'menor' | 'mayor') => cash.cajaBalance(db, caja)
const stock = async (code: string) => (await getRow<Product>(db, 'products', 'code', code))!.stock
const movements = () => listAll<CashMovement>(db, 'cashMovements')
let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

/** Caja Mayor starts with M0 (saldo inicial) and then gets a 15.000 transfer sale + 2.000 fiado payment by transfer - 1.000 correction. */
const M0 = 20000
const MAYOR_BASE = M0 + 15000 + 2000 - 1000

const product = (code: string, stockQty: number, cost = 1000): Product => ({ code, name: `Prod ${code}`, price: cost * 2, cost, stock: stockQty, min: 0, cat: 'T', brand: '', unit: 'unidad', esPaquete: false })
await putRow(db, 'products', 'code', 'A1', product('A1', 10))
await putRow(db, 'products', 'code', 'B2', product('B2', 0))

// --- Caja Menor: apertura -----------------------------------------------------------------
assert.equal(await bal('menor'), 0)
await fails(() => run((q) => cash.registerMovement(q, { caja: 'menor', direction: 'out', amount: 100, concept: 'x' })), /Saldo insuficiente/, 'no gastar sin fondos')
assert.equal(await cash.isFirstOpening(db), true)
await fails(() => run((q) => cash.openCaja(q, { countedCash: 1, by: 'Ana', mayorInitial: -5 })), /no es válido/, 'saldo inicial negativo')
const s1 = await run((q) => cash.openCaja(q, { countedCash: 50000, by: 'Ana', mayorInitial: M0 }))
assert.equal(s1.status, 'abierta')
assert.equal(await bal('menor'), 50000)
assert.equal(await bal('mayor'), M0)
assert.equal((await movements()).find((m) => m.type === 'ajuste_arqueo')?.concept, 'Base inicial de caja')
assert.equal(await cash.isFirstOpening(db), false)
ok('primera apertura: 50.000 quedan como base inicial de la Menor y 20.000 como saldo inicial de la Mayor')
await fails(() => run((q) => cash.openCaja(q, { countedCash: 1, by: 'Ana' })), /Ya hay una caja abierta/, 'una sola caja abierta')
ok('no se puede abrir una segunda caja')

// --- Ventas, abonos y gastos ---------------------------------------------------------------
const sale = (payMethod: Sale['payMethod'], total: number) =>
  insertAutoRow(db, 'sales', { items: [], subtotal: total, discount: 0, total, ganancia: 0, payMethod, date: new Date().toISOString(), dayKey: todayKey() } as Sale)
const cashSale = await sale('efectivo', 20000)
await run((q) => cash.recordSaleReceipt(q, cashSale))
const transferSale = await sale('transferencia', 15000)
await run((q) => cash.recordSaleReceipt(q, transferSale))
const fiadoOnly = await sale('fiado', 12345)
await run((q) => cash.recordSaleReceipt(q, fiadoOnly))
assert.equal(await bal('menor'), 70000)
assert.equal(await bal('mayor'), M0 + 15000)
assert.equal((await movements()).filter((m) => m.refId === transferSale.id)[0].medio, 'transferencia')
ok('efectivo entra a la Caja Menor, transferencia a la Caja Mayor (marcada como transferencia) y el fiado a ninguna')
const fiadoSale = await sale('fiado', 8000)
await run((q) => cash.recordFiadoCollection(q, fiadoSale, 3000))
assert.equal(await bal('menor'), 73000)
await run((q) => cash.recordFiadoCollection(q, fiadoSale, 2000, 'transferencia'))
assert.equal(await bal('menor'), 73000)
assert.equal(await bal('mayor'), M0 + 17000)
await fails(() => run((q) => cash.recordFiadoCollection(q, fiadoSale, 1, 'cheque' as never)), /Medio de pago/, 'medio inválido')
ok('un abono de fiado en efectivo entra a la Menor y por transferencia a la Mayor')
const corrected = await sale('efectivo', 10000)
await run((q) => cash.recordSaleCorrection(q, corrected, -2500))
assert.equal(await bal('menor'), 70500)
await run((q) => cash.recordSaleCorrection(q, transferSale, -1000))
assert.equal(await bal('mayor'), MAYOR_BASE)
ok('corregir una factura ajusta la caja donde entró el cobro (efectivo → Menor, transferencia → Mayor)')
await run((q) => cash.registerMovement(q, { caja: 'menor', direction: 'out', amount: 5500, concept: 'Hielo', category: 'otro' }))
assert.equal(await bal('menor'), 65000)
await fails(() => run((q) => cash.registerMovement(q, { caja: 'menor', direction: 'out', amount: 0, concept: 'x' })), /mayor a 0/, 'monto 0')
await fails(() => run((q) => cash.registerMovement(q, { caja: 'menor', direction: 'out', amount: 10, concept: '  ' })), /concepto/, 'sin concepto')
ok('egresos validan monto y concepto')

// --- Traslado ------------------------------------------------------------------------------
await run((q) => cash.transferFunds(q, { from: 'menor', to: 'mayor', amount: 40000, by: 'Ana' }))
assert.equal(await bal('menor'), 25000)
assert.equal(await bal('mayor'), MAYOR_BASE + 40000)
const transfers = (await movements()).filter((m) => m.transferId)
assert.equal(transfers.length, 2)
assert.equal(transfers[0].transferId, transfers[1].transferId)
ok('trasladar descuenta de Menor y suma a Mayor con las dos puntas enlazadas')
await fails(() => run((q) => cash.transferFunds(q, { from: 'menor', to: 'mayor', amount: 25001 })), /Saldo insuficiente/, 'traslado sin fondos')
await fails(() => run((q) => cash.transferFunds(q, { from: 'mayor', to: 'mayor', amount: 1 })), /dos cajas distintas/, 'misma caja')
assert.equal(await bal('menor'), 25000)
assert.equal(await bal('mayor'), MAYOR_BASE + 40000)
ok('un traslado rechazado no mueve nada')

// --- Proveedores ---------------------------------------------------------------------------
const contado = await run((q) => buying.createSupplier(q, { name: 'Distri Contado', paymentTerms: { kind: 'contado' } }))
const credito = await run((q) => buying.createSupplier(q, { name: 'Plasticos SAS', paymentTerms: { kind: 'credito', days: 30 } }))
await fails(() => run((q) => buying.createSupplier(q, { name: 'plasticos sas', paymentTerms: { kind: 'contado' } })), /Ya existe/, 'nombre repetido')
await fails(() => run((q) => buying.createSupplier(q, { name: 'Malo', paymentTerms: { kind: 'credito', days: 0 } })), /días de crédito/, 'días inválidos')
ok('proveedores: contado / crédito con días, sin nombres repetidos')

// --- Pedido a crédito: recepción suma stock y crea la cuenta por pagar ---------------------
const order = (await run((q) => buying.createOrder(q, { supplierId: credito.id, send: true, lines: [{ code: 'A1', qty: 10, unitCost: 1000 }, { code: 'B2', qty: 5, unitCost: 2000 }] }))) as PurchaseOrder & { id: number }
assert.equal(order.status, 'pedido')
assert.equal(order.total, 20000)
assert.equal(await stock('A1'), 10, 'pedir no toca el stock')
ok('un pedido enviado no suma stock todavía')
const big = (await run((q) => buying.createOrder(q, { supplierId: contado.id, send: true, lines: [{ code: 'A1', qty: 10, unitCost: 10000 }] }))) as PurchaseOrder & { id: number }
await fails(() => run((q) => buying.receiveOrder(q, big.id, { payment: { mode: 'contado', caja: 'mayor' } })), /Saldo insuficiente/, 'recibir de contado sin fondos')
assert.equal(await stock('A1'), 10)
assert.equal((await getRow<PurchaseOrder>(db, 'purchaseOrders', 'id', big.id))!.status, 'pedido')
assert.equal(await bal('mayor'), MAYOR_BASE + 40000)
ok('si el pago falla, la recepción se revierte completa (stock, estado y caja intactos)')
await run((q) => buying.cancelOrder(q, big.id))
await fails(() => run((q) => buying.receiveOrder(q, big.id, { payment: { mode: 'credito' } })), /ya fue enviado|Solo se puede recibir/, 'recibir cancelado')
ok('un pedido cancelado no se puede recibir')
const received = await run((q) => buying.receiveOrder(q, order.id, { lines: [{ code: 'A1', qtyReceived: 8, unitCost: 1100 }], payment: { mode: 'credito' }, by: 'Ana' }))
assert.equal(received.status, 'recibido')
assert.equal(await stock('A1'), 18)
assert.equal(await stock('B2'), 5)
assert.equal(received.receivedTotal, 8 * 1100 + 5 * 2000)
assert.equal((await getRow<Product>(db, 'products', 'code', 'A1'))!.cost, 1100)
const payables = await listAll<Payable>(db, 'payables')
assert.equal(payables.length, 1)
assert.equal(payables[0].amount, 18800)
assert.equal(payables[0].dueDate, addDaysToKey(todayKey(), 30))
assert.equal(payables[0].dueDate, dueDateFrom(new Date(), 30))
assert.equal(await bal('mayor'), MAYOR_BASE + 40000, 'a crédito no sale dinero')
ok('recibir suma lo recibido al stock, actualiza el costo y crea la cuenta por pagar a 30 días')
await fails(() => run((q) => buying.receiveOrder(q, order.id, { payment: { mode: 'credito' } })), /ya fue recibido/, 'doble recepción')
assert.equal(await stock('A1'), 18)
ok('un pedido no se puede recibir dos veces')

// --- Pagar la cuenta -----------------------------------------------------------------------
const payableId = payables[0].id!
await run((q) => buying.payPayable(q, payableId, { amount: 10000, caja: 'mayor', by: 'Ana' }))
assert.equal(await bal('mayor'), MAYOR_BASE + 30000)
await fails(() => run((q) => buying.payPayable(q, payableId, { amount: 9000, caja: 'mayor' })), /supera el saldo/, 'pago mayor al saldo')
await fails(
  async () => {
    await run((q) => buying.payPayable(q, payableId, { amount: 8800, caja: 'mayor' }))
    await run((q) => buying.payPayable(q, payableId, { amount: 1, caja: 'mayor' }))
  },
  /ya está pagada/,
  'pagar de más',
)
assert.equal((await getRow<Payable>(db, 'payables', 'id', payableId))!.paid, 18800)
assert.equal(await bal('mayor'), MAYOR_BASE + 21200)
ok('pago parcial y total de la cuenta por pagar descuentan de Caja Mayor; no se paga de más')

// --- Pedido de contado -----------------------------------------------------------------------
const order2 = (await run((q) => buying.createOrder(q, { supplierId: contado.id, send: true, lines: [{ code: 'A1', qty: 2, unitCost: 5000 }] }))) as PurchaseOrder & { id: number }
await fails(() => run((q) => buying.receiveOrder(q, order2.id, { payment: { mode: 'credito' } })), /de contado/, 'contado no puede quedar a crédito')
const rec2 = await run((q) => buying.receiveOrder(q, order2.id, { payment: { mode: 'contado', caja: 'menor' } }))
assert.equal(await bal('menor'), 15000)
assert.equal(rec2.payment?.mode, 'contado')
assert.equal(await stock('A1'), 20)
ok('proveedor de contado: se elige la caja y se descuenta al recibir')

// --- Cierre Z: arqueo contra el libro, traslado y cierre de sesión ---------------------------
const agg = computeDayAggregate(todayKey(), await listAll<Sale>(db, 'sales'), await movements(), { onlyOpen: true })
const cierre = await run((q) => confirmCierre(q, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: 14000, trasladar: 9000, aggregate: agg }))
assert.equal(cierre.arqueo.efectivoSistema, 15000)
assert.equal(cierre.arqueo.diferencia, -1000)
assert.equal(cierre.arqueo.cuadre, 'faltante')
assert.equal(await bal('menor'), 5000, 'queda lo contado menos lo trasladado')
assert.equal(await bal('mayor'), MAYOR_BASE + 21200 + 9000)
assert.equal(cierre.dejadoEnCaja, 5000)
assert.equal(await cash.openSession(db), undefined, 'el cierre cierra la sesión')
ok('cierre: faltante de 1.000 contra el libro, traslado de 9.000 a Mayor, quedan 5.000 y la sesión se cierra')
await fails(() => run((q) => confirmCierre(q, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: 100, trasladar: 200, aggregate: agg })), /más efectivo del que contaste/, 'trasladar más de lo contado')
ok('no se puede trasladar más de lo contado')
await fails(() => run((q) => cash.openCaja(q, { countedCash: 5000, by: 'Ana', mayorInitial: 1000 })), /primera apertura/, 'saldo inicial solo la primera vez')
const s2 = await run((q) => cash.openCaja(q, { countedCash: 5000, by: 'Ana' }))
assert.equal(s2.openDiff, 0)
ok('al día siguiente la caja abre con lo que quedó (sin diferencia)')

await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones del dinero pasaron.`)
