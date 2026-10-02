/** Self-check for the money logic (cajas, traslados, pedidos, cuentas por pagar, cierre). Runs
 * against a throwaway in-memory SQLite — never the real tienda.db:  npm run check:cash */
import assert from 'node:assert/strict'

process.env.TIENDA_DB_PATH = ':memory:'
const { db } = await import('./db')
const cash = await import('./domain/cash')
const buying = await import('./domain/purchasing')
const { confirmCierre } = await import('./domain/cierre')
const { getRow, insertAutoRow, putRow, listAll } = await import('./routes/generic')
const { computeDayAggregate } = await import('../src/shared/lib/aggregation')
const { addDaysToKey, dueDateFrom } = await import('../src/shared/lib/cash')
const { todayKey } = await import('../src/shared/lib/currency')
import type { Out } from './domain/cash'
import type { Product } from '../src/types/product'
import type { Sale } from '../src/types/sale'
import type { CashMovement } from '../src/types/cash'
import type { Payable, PurchaseOrder } from '../src/types/purchaseOrder'

/** Same shape as the routes: one transaction per operation, all-or-nothing. */
const run = <T>(fn: (out: Out) => T): T => db.transaction(() => fn([]))()
const fails = (fn: () => unknown, pattern: RegExp, label: string) => {
  assert.throws(fn, pattern, label)
}
const bal = (caja: 'menor' | 'mayor') => cash.cajaBalance(db, caja)
const stock = (code: string) => getRow<Product>(db, 'products', 'code', code)!.stock
let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

/** Caja Mayor starts with M0 (saldo inicial) and then gets a 15.000 transfer sale + 2.000 fiado payment by transfer - 1.000 correction. */
const M0 = 20000
const MAYOR_BASE = M0 + 15000 + 2000 - 1000

const product = (code: string, stockQty: number, cost = 1000): Product => ({ code, name: `Prod ${code}`, price: cost * 2, cost, stock: stockQty, min: 0, cat: 'T', brand: '', unit: 'unidad', esPaquete: false })
putRow(db, 'products', 'code', 'A1', {}, product('A1', 10))
putRow(db, 'products', 'code', 'B2', {}, product('B2', 0))

// --- Caja Menor: apertura -----------------------------------------------------------------
assert.equal(bal('menor'), 0)
fails(() => run((out) => cash.registerMovement(db, out, { caja: 'menor', direction: 'out', amount: 100, concept: 'x' })), /Saldo insuficiente/, 'no gastar sin fondos')
assert.equal(cash.isFirstOpening(db), true)
fails(() => run((out) => cash.openCaja(db, out, { countedCash: 1, by: 'Ana', mayorInitial: -5 })), /no es válido/, 'saldo inicial negativo')
const s1 = run((out) => cash.openCaja(db, out, { countedCash: 50000, by: 'Ana', mayorInitial: M0 }))
assert.equal(s1.status, 'abierta')
assert.equal(bal('menor'), 50000)
assert.equal(bal('mayor'), M0)
assert.equal(listAll<CashMovement>(db, 'cashMovements').find((m) => m.type === 'ajuste_arqueo')?.concept, 'Base inicial de caja')
assert.equal(cash.isFirstOpening(db), false)
ok('primera apertura: 50.000 quedan como base inicial de la Menor y 20.000 como saldo inicial de la Mayor')
fails(() => run((out) => cash.openCaja(db, out, { countedCash: 1, by: 'Ana' })), /Ya hay una caja abierta/, 'una sola caja abierta')
ok('no se puede abrir una segunda caja')

// --- Ventas, abonos y gastos ---------------------------------------------------------------
const sale = (payMethod: Sale['payMethod'], total: number) =>
  insertAutoRow(db, 'sales', { items: [], subtotal: total, discount: 0, total, ganancia: 0, payMethod, date: new Date().toISOString(), dayKey: todayKey() } as Sale)
run((out) => cash.recordSaleReceipt(db, out, sale('efectivo', 20000)))
const transferSale = sale('transferencia', 15000) as Sale & { id: number }
run((out) => cash.recordSaleReceipt(db, out, transferSale))
run((out) => cash.recordSaleReceipt(db, out, sale('fiado', 12345)))
assert.equal(bal('menor'), 70000)
assert.equal(bal('mayor'), M0 + 15000)
assert.equal(listAll<CashMovement>(db, 'cashMovements').filter((m) => m.refId === transferSale.id)[0].medio, 'transferencia')
ok('efectivo entra a la Caja Menor, transferencia a la Caja Mayor (marcada como transferencia) y el fiado a ninguna')
const fiadoSale = sale('fiado', 8000)
run((out) => cash.recordFiadoCollection(db, out, fiadoSale as Sale & { id: number }, 3000))
assert.equal(bal('menor'), 73000)
run((out) => cash.recordFiadoCollection(db, out, fiadoSale as Sale & { id: number }, 2000, 'transferencia'))
assert.equal(bal('menor'), 73000)
assert.equal(bal('mayor'), M0 + 17000)
fails(() => run((out) => cash.recordFiadoCollection(db, out, fiadoSale as Sale & { id: number }, 1, 'cheque' as never)), /Medio de pago/, 'medio inválido')
ok('un abono de fiado en efectivo entra a la Menor y por transferencia a la Mayor')
run((out) => cash.recordSaleCorrection(db, out, sale('efectivo', 10000) as Sale & { id: number }, -2500))
assert.equal(bal('menor'), 70500)
run((out) => cash.recordSaleCorrection(db, out, transferSale, -1000))
assert.equal(bal('mayor'), MAYOR_BASE)
ok('corregir una factura ajusta la caja donde entró el cobro (efectivo → Menor, transferencia → Mayor)')
run((out) => cash.registerMovement(db, out, { caja: 'menor', direction: 'out', amount: 5500, concept: 'Hielo', category: 'otro' }))
assert.equal(bal('menor'), 65000)
fails(() => run((out) => cash.registerMovement(db, out, { caja: 'menor', direction: 'out', amount: 0, concept: 'x' })), /mayor a 0/, 'monto 0')
fails(() => run((out) => cash.registerMovement(db, out, { caja: 'menor', direction: 'out', amount: 10, concept: '  ' })), /concepto/, 'sin concepto')
ok('egresos validan monto y concepto')

// --- Traslado ------------------------------------------------------------------------------
run((out) => cash.transferFunds(db, out, { from: 'menor', to: 'mayor', amount: 40000, by: 'Ana' }))
assert.equal(bal('menor'), 25000)
assert.equal(bal('mayor'), MAYOR_BASE + 40000)
const transfers = listAll<CashMovement>(db, 'cashMovements').filter((m) => m.transferId)
assert.equal(transfers.length, 2)
assert.equal(transfers[0].transferId, transfers[1].transferId)
ok('trasladar descuenta de Menor y suma a Mayor con las dos puntas enlazadas')
fails(() => run((out) => cash.transferFunds(db, out, { from: 'menor', to: 'mayor', amount: 25001 })), /Saldo insuficiente/, 'traslado sin fondos')
fails(() => run((out) => cash.transferFunds(db, out, { from: 'mayor', to: 'mayor', amount: 1 })), /dos cajas distintas/, 'misma caja')
assert.equal(bal('menor'), 25000)
assert.equal(bal('mayor'), MAYOR_BASE + 40000)
ok('un traslado rechazado no mueve nada')

// --- Proveedores ---------------------------------------------------------------------------
const contado = run((out) => buying.createSupplier(db, out, { name: 'Distri Contado', paymentTerms: { kind: 'contado' } }))
const credito = run((out) => buying.createSupplier(db, out, { name: 'Plasticos SAS', paymentTerms: { kind: 'credito', days: 30 } }))
fails(() => run((out) => buying.createSupplier(db, out, { name: 'plasticos sas', paymentTerms: { kind: 'contado' } })), /Ya existe/, 'nombre repetido')
fails(() => run((out) => buying.createSupplier(db, out, { name: 'Malo', paymentTerms: { kind: 'credito', days: 0 } })), /días de crédito/, 'días inválidos')
ok('proveedores: contado / crédito con días, sin nombres repetidos')

// --- Pedido a crédito: recepción suma stock y crea la cuenta por pagar ---------------------
const order = run((out) => buying.createOrder(db, out, { supplierId: credito.id, send: true, lines: [{ code: 'A1', qty: 10, unitCost: 1000 }, { code: 'B2', qty: 5, unitCost: 2000 }] })) as PurchaseOrder & { id: number }
assert.equal(order.status, 'pedido')
assert.equal(order.total, 20000)
assert.equal(stock('A1'), 10, 'pedir no toca el stock')
ok('un pedido enviado no suma stock todavía')
const big = run((out) => buying.createOrder(db, out, { supplierId: contado.id, send: true, lines: [{ code: 'A1', qty: 10, unitCost: 10000 }] })) as PurchaseOrder & { id: number }
fails(() => run((out) => buying.receiveOrder(db, out, big.id, { payment: { mode: 'contado', caja: 'mayor' } })), /Saldo insuficiente/, 'recibir de contado sin fondos')
assert.equal(stock('A1'), 10)
assert.equal(getRow<PurchaseOrder>(db, 'purchaseOrders', 'id', big.id)!.status, 'pedido')
assert.equal(bal('mayor'), MAYOR_BASE + 40000)
ok('si el pago falla, la recepción se revierte completa (stock, estado y caja intactos)')
run((out) => buying.cancelOrder(db, out, big.id))
fails(() => run((out) => buying.receiveOrder(db, out, big.id, { payment: { mode: 'credito' } })), /ya fue enviado|Solo se puede recibir/, 'recibir cancelado')
ok('un pedido cancelado no se puede recibir')
const received = run((out) => buying.receiveOrder(db, out, order.id, { lines: [{ code: 'A1', qtyReceived: 8, unitCost: 1100 }], payment: { mode: 'credito' }, by: 'Ana' }))
assert.equal(received.status, 'recibido')
assert.equal(stock('A1'), 18)
assert.equal(stock('B2'), 5)
assert.equal(received.receivedTotal, 8 * 1100 + 5 * 2000)
assert.equal(getRow<Product>(db, 'products', 'code', 'A1')!.cost, 1100)
const payables = listAll<Payable>(db, 'payables')
assert.equal(payables.length, 1)
assert.equal(payables[0].amount, 18800)
assert.equal(payables[0].dueDate, addDaysToKey(todayKey(), 30))
assert.equal(payables[0].dueDate, dueDateFrom(new Date(), 30))
assert.equal(bal('mayor'), MAYOR_BASE + 40000, 'a crédito no sale dinero')
ok('recibir suma lo recibido al stock, actualiza el costo y crea la cuenta por pagar a 30 días')
fails(() => run((out) => buying.receiveOrder(db, out, order.id, { payment: { mode: 'credito' } })), /ya fue recibido/, 'doble recepción')
assert.equal(stock('A1'), 18)
ok('un pedido no se puede recibir dos veces')

// --- Pagar la cuenta -----------------------------------------------------------------------
const payableId = payables[0].id!
run((out) => buying.payPayable(db, out, payableId, { amount: 10000, caja: 'mayor', by: 'Ana' }))
assert.equal(bal('mayor'), MAYOR_BASE + 30000)
fails(() => run((out) => buying.payPayable(db, out, payableId, { amount: 9000, caja: 'mayor' })), /supera el saldo/, 'pago mayor al saldo')
fails(() => run((out) => buying.payPayable(db, out, payableId, { amount: 8800, caja: 'mayor' })) && run((out) => buying.payPayable(db, out, payableId, { amount: 1, caja: 'mayor' })), /ya está pagada/, 'pagar de más')
assert.equal(getRow<Payable>(db, 'payables', 'id', payableId)!.paid, 18800)
assert.equal(bal('mayor'), MAYOR_BASE + 21200)
ok('pago parcial y total de la cuenta por pagar descuentan de Caja Mayor; no se paga de más')

// --- Pedido de contado -----------------------------------------------------------------------
const order2 = run((out) => buying.createOrder(db, out, { supplierId: contado.id, send: true, lines: [{ code: 'A1', qty: 2, unitCost: 5000 }] })) as PurchaseOrder & { id: number }
fails(() => run((out) => buying.receiveOrder(db, out, order2.id, { payment: { mode: 'credito' } })), /de contado/, 'contado no puede quedar a crédito')
const rec2 = run((out) => buying.receiveOrder(db, out, order2.id, { payment: { mode: 'contado', caja: 'menor' } }))
assert.equal(bal('menor'), 15000)
assert.equal(rec2.payment?.mode, 'contado')
assert.equal(stock('A1'), 20)
ok('proveedor de contado: se elige la caja y se descuenta al recibir')

// --- Cierre Z: arqueo contra el libro, traslado y cierre de sesión ---------------------------
const agg = computeDayAggregate(todayKey(), listAll<Sale>(db, 'sales'), listAll<CashMovement>(db, 'cashMovements'), { onlyOpen: true })
const cierre = run((out) => confirmCierre(db, out, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: 14000, trasladar: 9000, aggregate: agg }))
assert.equal(cierre.arqueo.efectivoSistema, 15000)
assert.equal(cierre.arqueo.diferencia, -1000)
assert.equal(cierre.arqueo.cuadre, 'faltante')
assert.equal(bal('menor'), 5000, 'queda lo contado menos lo trasladado')
assert.equal(bal('mayor'), MAYOR_BASE + 21200 + 9000)
assert.equal(cierre.dejadoEnCaja, 5000)
assert.equal(cash.openSession(db), undefined, 'el cierre cierra la sesión')
ok('cierre: faltante de 1.000 contra el libro, traslado de 9.000 a Mayor, quedan 5.000 y la sesión se cierra')
fails(() => run((out) => confirmCierre(db, out, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: 100, trasladar: 200, aggregate: agg })), /más efectivo del que contaste/, 'trasladar más de lo contado')
ok('no se puede trasladar más de lo contado')
fails(() => run((out) => cash.openCaja(db, out, { countedCash: 5000, by: 'Ana', mayorInitial: 1000 })), /primera apertura/, 'saldo inicial solo la primera vez')
const s2 = run((out) => cash.openCaja(db, out, { countedCash: 5000, by: 'Ana' }))
assert.equal(s2.openDiff, 0)
ok('al día siguiente la caja abre con lo que quedó (sin diferencia)')

console.log(`\nTodo en orden: ${n} comprobaciones del dinero pasaron.`)
