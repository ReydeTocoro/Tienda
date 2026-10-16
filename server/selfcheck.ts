/** Self-check for the money logic (cajas, traslados, pedidos, cuentas por pagar, cierre). Runs
 * against a throwaway in-memory Postgres (PGlite) built from the real migrations — never the
 * Supabase data:  npm run check:cash */
import assert from 'node:assert/strict'
import { pgliteDb, type Sql } from './db'
import { testDatabase } from './testDb'
import { costOf } from './domain/secrets'
import * as cash from './domain/cash'
import * as buying from './domain/purchasing'
import { confirmCierre } from './domain/cierre'
import { addFiadoPago, correctSale, finalizeSale, voidSale } from './domain/sales'
import { closingAggregate } from './domain/cierre'
import { shareReceipt } from './domain/receipts'
import { computeDayAggregate } from '../src/shared/lib/aggregation'
import { getSpent } from '../src/shared/lib/customerSpend'
import { lineDiscount, manualDiscountOf } from '../src/shared/lib/discounts'
import { stockEffect } from '../src/shared/lib/saleStock'
import { getRow, insertAutoRow, putRow, listAll } from './routes/generic'
import { addDaysToKey, dueDateFrom } from '../src/shared/lib/cash'
import { todayKey } from '../src/shared/lib/currency'
import { needsOfRole, resolveRoles } from '../src/shared/lib/permissions'
import type { Product } from '../src/types/product'
import type { Sale } from '../src/types/sale'
import type { CashMovement } from '../src/types/cash'
import type { Payable, PurchaseOrder } from '../src/types/purchaseOrder'
import type { StockAuditEntry } from '../src/types/auditLog'

const lite = await testDatabase()
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
assert.equal(await costOf(db, 'A1'), 1100)
assert.equal('cost' in (await getRow<Product>(db, 'products', 'code', 'A1'))!, false, 'el costo nunca queda en la fila pública del producto')
const payables = await listAll<Payable>(db, 'payables')
assert.equal(payables.length, 1)
assert.equal(payables[0].amount, 18800)
assert.equal(payables[0].dueDate, addDaysToKey(todayKey(), 30))
assert.equal(payables[0].dueDate, dueDateFrom(new Date(), 30))
assert.equal(await bal('mayor'), MAYOR_BASE + 40000, 'a crédito no sale dinero')
ok('recibir suma lo recibido al stock, actualiza el costo y crea la cuenta por pagar a 30 días')
const arrivals = (await listAll<StockAuditEntry>(db, 'auditLog')).filter((a) => a.type === 'entrada')
assert.deepEqual(
  arrivals.map((a) => [a.code, a.before, a.after, a.user]),
  [
    ['A1', 10, 18, 'Ana'],
    ['B2', 0, 5, 'Ana'],
  ],
)
assert.match(arrivals[0].reason, /^Pedido #P\d{4} recibido · Plasticos SAS$/)
ok('lo que entra al recibir un pedido queda en la auditoría del stock: antes → después, el pedido, el proveedor y quién lo recibió')
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
const cierre = await run((q) => confirmCierre(q, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: 14000, trasladar: 9000 }))
assert.equal(cierre.arqueo.efectivoSistema, 15000)
assert.equal(cierre.arqueo.diferencia, -1000)
assert.equal(cierre.arqueo.cuadre, 'faltante')
assert.equal(await bal('menor'), 5000, 'queda lo contado menos lo trasladado')
assert.equal(await bal('mayor'), MAYOR_BASE + 21200 + 9000)
assert.equal(cierre.dejadoEnCaja, 5000)
assert.equal(await cash.openSession(db), undefined, 'el cierre cierra la sesión')
assert.equal(cierre.totalVentas, (await listAll<Sale>(db, 'sales')).reduce((a, s) => a + s.total, 0), 'el servidor suma las ventas del día por su cuenta')
assert.equal('totalGanancia' in cierre, false, 'la ganancia del cierre no queda en la fila que lee Reporte')
assert.equal((await lite.query(`select 1 from profits where key = 'cierre:' || $1`, [cierre.id])).rows.length, 1)
assert.equal((await listAll<Sale>(db, 'sales')).every((s) => s.closedInCierreId === cierre.id), true, 'las ventas del día quedan marcadas')
assert.equal((await getRow<{ cajaBase?: number; lastCajero?: string }>(db, 'settings', 'key', 'main'))!.cajaBase, 5000, 'la base queda guardada para el próximo cierre')
ok('cierre: faltante de 1.000 contra el libro, traslado de 9.000 a Mayor, quedan 5.000 y la sesión se cierra')
await fails(() => run((q) => confirmCierre(q, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: 100, trasladar: 200 })), /más efectivo del que contaste/, 'trasladar más de lo contado')
ok('no se puede trasladar más de lo contado')
await fails(() => run((q) => cash.openCaja(q, { countedCash: 5000, by: 'Ana', mayorInitial: 1000 })), /primera apertura/, 'saldo inicial solo la primera vez')
const s2 = await run((q) => cash.openCaja(q, { countedCash: 5000, by: 'Ana' }))
assert.equal(s2.openDiff, 0)
ok('al día siguiente la caja abre con lo que quedó (sin diferencia)')

// --- Corregir una factura: el redondeo del cobro se conserva, y no se vende lo que no hay -------
const admin = { sessionId: 's', operator: { id: 'owner', name: 'Dueño', roleId: 'admin' }, needs: new Set<string>(needsOfRole(resolveRoles(undefined), 'admin')) }
await putRow(db, 'products', 'code', 'R1', product('R1', 5, 5015)) // vende a 10.030
const item = { code: 'R1', name: 'Prod R1', price: 10030, qty: 1, cost: 0, brand: '', unit: 'unidad', isFree: false }
const rounded = await run((q) =>
  finalizeSale(q, admin, { items: [item], subtotal: 10030, discount: 0, total: 10000, roundingAdjustment: -30, amountReceived: 10000, changeGiven: 0, payMethod: 'efectivo' }),
)
const menorAfterSale = await bal('menor')
const untouched = await run((q) => correctSale(q, admin, rounded.id!, [item], 'solo reviso'))
assert.equal(untouched.total, 10000, 'corregir sin cambiar nada deja el total redondeado que se cobró')
assert.equal(await bal('menor'), menorAfterSale, 'y la caja no se mueve')
const two = await run((q) => correctSale(q, admin, rounded.id!, [{ ...item, qty: 2 }], 'eran dos'))
assert.equal(two.total, 20030, 'con un cambio real, el redondeo sigue: 2 × 10.030 − 30')
assert.equal(await bal('menor'), menorAfterSale + 10030, 'la caja sube por la diferencia exacta del total')
assert.equal(await stock('R1'), 3)
await fails(() => run((q) => correctSale(q, admin, rounded.id!, [{ ...item, qty: 9 }], 'demasiados')), /Stock insuficiente de "Prod R1" \(quedan 5\)/, 'una corrección no vende lo que no hay')
assert.equal(await stock('R1'), 3, 'rechazada: el inventario queda como estaba')
assert.equal(await bal('menor'), menorAfterSale + 10030, 'y la caja también')
ok('corregir una factura conserva el redondeo del cobro (la caja solo se mueve por lo que de verdad cambió) y no deja vender más de lo que hay')

// --- Corregir y anular: el inventario y la caja siempre quedan como deben -------------------------
// Lo que se teme de una corrección o una anulación es que el producto no vuelva al inventario o que la caja quede mal:
// cada paso se comprueba contra las cifras reales (stock de cada producto, saldo de cada caja).
await putRow(db, 'products', 'code', 'V1', product('V1', 10, 1000)) // vende a 2.000
await putRow(db, 'products', 'code', 'V2', product('V2', 4, 500)) // vende a 1.000
const line = (code: string, qty: number, price: number) => ({ code, name: `Prod ${code}`, price, qty, cost: 0, brand: '', unit: 'unidad', isFree: false })
const sumOf = (items: Array<{ price: number; qty: number }>) => items.reduce((a, i) => a + i.price * i.qty, 0)
const sellItems = (items: ReturnType<typeof line>[], payMethod: Sale['payMethod'] = 'efectivo', extra: object = {}) =>
  run((q) => finalizeSale(q, admin, { items, subtotal: sumOf(items), discount: 0, total: sumOf(items), payMethod, ...extra }))

// Cambiar lo que se vendió mueve el inventario en los dos sentidos, producto por producto.
const inv = await sellItems([line('V1', 3, 2000)])
assert.equal(await stock('V1'), 7)
let menor = await bal('menor')
await run((q) => correctSale(q, admin, inv.id!, [line('V1', 1, 2000), line('V2', 2, 1000)], 'cambio de productos'))
assert.equal(await stock('V1'), 9, 'bajó de 3 a 1: 2 unidades vuelven al inventario')
assert.equal(await stock('V2'), 2, 'el producto que se agregó sale del inventario')
assert.equal(await bal('menor'), menor + 4000 - 6000, 'y la caja ajusta el total: de 6.000 a 4.000')
await run((q) => correctSale(q, admin, inv.id!, [line('V1', 1, 2000), line('V1', 2, 1800)], 'el mismo producto en dos líneas'))
assert.equal(await stock('V1'), 7, 'dos líneas del mismo producto suman: 1 + 2 = 3 salen')
assert.equal(await stock('V2'), 4, 'quitar una línea devuelve todo lo que había tomado')
await run((q) => correctSale(q, admin, inv.id!, [line('V2', 1, 1000)], 'solo queda uno'))
assert.equal(await stock('V1'), 10, 'quitado del todo: todo vuelve')
assert.equal(await stock('V2'), 3)
ok('corregir una factura (cambiar cantidades, agregar, quitar, repetir un producto) deja el inventario y la caja exactamente donde deben quedar')

// Lo que no se puede: vender lo que no hay, productos que no son del inventario, un motivo vacío, dejarla sin productos.
menor = await bal('menor')
await fails(() => run((q) => correctSale(q, admin, inv.id!, [line('V2', 5, 1000)], 'demasiados')), /Stock insuficiente de "Prod V2" \(quedan 4\)/, 'no se vende lo que no hay')
await fails(() => run((q) => correctSale(q, admin, inv.id!, [line('V2', 1, 1000), line('NOPE', 1, 100)], 'x')), /ya no existe/, 'un código que no es del inventario')
await fails(() => run((q) => correctSale(q, admin, inv.id!, [line('V2', 1, 1000), { ...line('CORR', 1, 100), name: 'Algo suelto', isFree: true }], 'x')), /no es un producto del inventario/, 'ni una línea libre nueva')
await fails(() => run((q) => correctSale(q, admin, inv.id!, [line('V2', 1, 1000)], '  ')), /motivo/, 'sin motivo no se corrige')
await fails(() => run((q) => correctSale(q, admin, inv.id!, [], 'x')), /sin productos/, 'ni se deja vacía: para eso está anular')
assert.equal(await stock('V2'), 3, 'nada de eso cambió el inventario')
assert.equal(await bal('menor'), menor, 'ni la caja')
// `isFree` lo dice el navegador: no puede usarse para vender sin que baje el stock.
await run((q) => correctSale(q, admin, inv.id!, [line('V2', 1, 1000), { ...line('V2', 2, 1000), isFree: true }], 'marcado como libre')) // 1 + 2 = 3 unidades
assert.equal(await stock('V2'), 1, 'una línea marcada como libre igual descuenta: 3 salen de las 4 que había')
ok('una corrección no vende lo que no hay, no acepta productos que no son del inventario ni líneas "libres", exige motivo y no se puede usar isFree para saltarse el stock')

// Anular: todo vuelve, el dinero sale de la caja por donde entró, y la factura queda como historial.
menor = await bal('menor')
const total = (await getRow<Sale>(db, 'sales', 'id', inv.id!))!.total
assert.equal(total, 3000)
await fails(() => run((q) => voidSale(q, admin, inv.id!, '')), /motivo/, 'anular también exige motivo')
const voided = await run((q) => voidSale(q, admin, inv.id!, 'el cliente devolvió todo'))
assert.equal(voided.voided, true)
assert.equal(voided.voidReason, 'el cliente devolvió todo')
assert.equal(voided.voidedBy, 'Dueño')
assert.equal(await stock('V2'), 4, 'las 3 unidades vuelven al inventario')
assert.equal(await stock('V1'), 10)
assert.equal(await bal('menor'), menor - 3000, 'el total de la factura (ya corregido) sale de la caja')
assert.equal((voided as Sale & { ganancia?: number }).ganancia, undefined, 'lo que vuelve al navegador no trae la ganancia')
const audit = await listAll<{ type: string; saleId: number; user: string }>(db, 'auditLog')
assert.ok(audit.some((a) => a.type === 'anulacion_venta' && a.saleId === inv.id && a.user === 'Dueño'), 'queda en el historial de auditoría, firmado')
await run((q) => voidSale(q, admin, inv.id!, 'otra vez')) // un segundo clic o una respuesta perdida: no pasa nada
assert.equal(await stock('V2'), 4, 'anular dos veces no devuelve dos veces')
assert.equal(await bal('menor'), menor - 3000, 'ni saca el dinero dos veces')
await fails(() => run((q) => correctSale(q, admin, inv.id!, [line('V2', 1, 1000)], 'x')), /anulada/, 'una factura anulada ya no se corrige')
ok('anular una factura devuelve todo al inventario, saca de la caja lo cobrado una sola vez, la deja marcada con quién y por qué, y ya no se puede corregir')

// Una factura fiada con abonos: lo que el cliente ya pagó se le devuelve, por la caja por donde entró; lo condonado no mueve dinero.
const fiado = await sellItems([line('V1', 2, 2000)], 'fiado', { fiadoName: 'Don Pepe' })
await run((q) => addFiadoPago(q, admin, fiado.id!, { amount: 1500, date: '', note: '', method: 'efectivo' }))
await run((q) => addFiadoPago(q, admin, fiado.id!, { amount: 500, date: '', note: '', method: 'transferencia' }))
await run((q) => addFiadoPago(q, admin, fiado.id!, { amount: 100, date: '', note: 'condonado', condonado: true }))
await fails(() => run((q) => correctSale(q, admin, fiado.id!, [line('V1', 1, 2000)], 'menos')), /ya tiene abonos por \$2\.100/, 'el total de un fiado no baja de lo ya abonado')
assert.equal(await stock('V1'), 8, 'rechazada: el inventario sigue igual')
const menorF = await bal('menor')
const mayorF = await bal('mayor')
await run((q) => voidSale(q, admin, fiado.id!, 'error de digitación'))
assert.equal(await stock('V1'), 10, 'la mercancía de un fiado anulado vuelve')
assert.equal(await bal('menor'), menorF - 1500, 'el abono en efectivo se devuelve por la Caja Menor')
assert.equal(await bal('mayor'), mayorF - 500, 'el de transferencia, por la Caja Mayor')
await fails(() => run((q) => addFiadoPago(q, admin, fiado.id!, { amount: 10, date: '', note: '', method: 'efectivo' })), /anulada/, 'a una factura anulada no se le abona')
ok('anular un fiado con abonos devuelve lo abonado por la caja correcta (lo condonado no mueve dinero) y deja de deber; no admite más abonos')

// Una factura anulada no cuenta en ningún total: ni en el día, ni en el cierre, ni en lo gastado por el cliente.
const day = todayKey()
const fresh = await sellItems([line('V1', 1, 2000)])
assert.ok((await closingAggregate(db, day)).ventasDay.some((s) => s.id === fresh.id), 'antes de anularla, el cierre del día la cuenta')
await run((q) => voidSale(q, admin, fresh.id!, 'prueba'))
const agg = await closingAggregate(db, day)
assert.ok(!agg.ventasDay.some((s) => s.id === fresh.id), 'anulada, el cierre del día ya no la cuenta')
const mk = (id: number, total: number, extra: Partial<Sale> = {}): Sale => ({ id, items: [], subtotal: total, discount: 0, total, ganancia: 100, payMethod: 'efectivo', date: new Date().toISOString(), dayKey: day, customerId: 'C9', ...extra })
const day2 = computeDayAggregate(day, [mk(1, 5000), mk(2, 3000, { voided: true })], [])
assert.equal(day2.totalVentas, 5000, 'el reporte del día no suma la anulada')
assert.equal(day2.numTx, 1)
assert.equal(day2.totalGanancia, 100)
assert.equal(getSpent([mk(1, 5000), mk(2, 3000, { voided: true })], 'C9'), 5000, 'lo gastado por el cliente tampoco')
ok('una factura anulada no cuenta en el cierre del día, el reporte ni lo gastado por el cliente')

// El inventario puede haber cambiado desde la venta: un producto borrado no impide corregir ni anular lo demás.
await putRow(db, 'products', 'code', 'V3', product('V3', 6, 100))
const old = await sellItems([line('V3', 2, 200), line('V2', 1, 1000)])
await db.query(`delete from products where code = 'V3'`)
const stockV2 = await stock('V2')
await run((q) => correctSale(q, admin, old.id!, [line('V3', 2, 250), line('V2', 1, 1000)], 'el precio estaba mal'))
assert.equal(await stock('V2'), stockV2, 'se corrige el precio de la línea cuyo producto ya no existe, sin tocar lo demás')
await run((q) => voidSale(q, admin, old.id!, 'prueba'))
assert.equal(await stock('V2'), stockV2 + 1, 'y al anular vuelve lo que sí existe')
ok('si un producto de la factura fue borrado del inventario, la factura se corrige y se anula igual con lo demás')

// El enlace de recibo que ya se mandó al cliente: una corrección lo actualiza y una anulación lo retira.
const shared = await sellItems([line('V1', 1, 2000)])
await run((q) => shareReceipt(q, shared.id!))
await run((q) => correctSale(q, admin, shared.id!, [line('V1', 2, 2000)], 'eran dos'))
const linkTotal = async () => (await db.query<{ total: number }>(`select (data ->> 'total')::float8 as total from private.shared_receipts where sale_id = $1`, [shared.id]))[0]?.total
assert.equal(await linkTotal(), 4000, 'el enlace ya enviado muestra la factura corregida')
await run((q) => voidSale(q, admin, shared.id!, 'prueba'))
assert.equal(await linkTotal(), undefined, 'anulada, el enlace se retira')
await fails(() => run((q) => shareReceipt(q, shared.id!)), /anulada/, 'y no se puede volver a compartir')
ok('el enlace de recibo enviado se actualiza al corregir la factura y se retira al anularla')

// Una sola regla para la pantalla y el servidor: qué le pasa al inventario.
assert.deepEqual(
  stockEffect([line('A', 3, 1), line('B', 1, 1)], [line('A', 1, 1), line('A', 2, 1), line('C', 4, 1)]).map((e) => [e.code, e.delta]),
  [['B', 1], ['C', -4]],
  'lo que no cambia no aparece; el mismo producto en dos líneas se suma',
)
assert.deepEqual(stockEffect([line('A', 2, 1), { ...line('CORR', 1, 1), isFree: true }], []).map((e) => [e.code, e.delta]), [['A', 2]], 'las líneas libres no tienen estante')
ok('stockEffect: la lista de cambios al inventario suma por producto y deja fuera lo que no cambia y las líneas libres')

// --- Transferencias: la cuenta (Nequi / Bancolombia) viaja con el dinero y el cierre la tiene en cuenta -------
await putRow(db, 'products', 'code', 'T1', product('T1', 20, 1000))
const tline = line('T1', 2, 2000)
const movementsOfSale = (id: number) => movements().then((all) => all.filter((m) => m.refId === id))
await fails(() => sellItems([line('T1', 1, 2000)], 'transferencia', { transferAccount: 'banco-inventado' }), /cuenta de la transferencia no es válida/, 'una cuenta que no existe se rechaza')
const viaNequi = await sellItems([line('T1', 1, 2000)], 'transferencia', { transferAccount: 'nequi' })
const viaBanco = await sellItems([tline], 'transferencia', { transferAccount: 'bancolombia' })
const viaNada = await sellItems([line('T1', 1, 2000)], 'transferencia') // una pantalla vieja no la pregunta
assert.equal(viaNequi.transferAccount, 'nequi')
assert.equal(viaNada.transferAccount, undefined, 'sin cuenta se acepta (pantallas viejas), y queda sin cuenta')
const cash1 = await sellItems([line('T1', 1, 2000)], 'efectivo', { transferAccount: 'nequi' })
assert.equal(cash1.transferAccount, undefined, 'la cuenta solo cuenta en una transferencia')
const [mNequi] = await movementsOfSale(viaNequi.id!)
assert.deepEqual([mNequi.caja, mNequi.medio, mNequi.cuenta, mNequi.amount], ['mayor', 'transferencia', 'nequi', 2000], 'el dinero entra a la Caja Mayor, a la cuenta elegida')
// corregir y anular conservan la cuenta en el libro
await run((q) => correctSale(q, admin, viaBanco.id!, [line('T1', 1, 2000)], 'era una sola'))
await run((q) => voidSale(q, admin, viaNada.id!, 'prueba'))
const movs = await movements()
assert.equal(movs.find((m) => m.refId === viaBanco.id && m.type === 'ajuste_venta')?.cuenta, 'bancolombia', 'la corrección ajusta la misma cuenta')
assert.equal(movs.find((m) => m.refId === viaNada.id && m.type === 'ajuste_venta')?.cuenta, undefined, 'y una venta sin cuenta sigue sin cuenta')
// un abono por transferencia dice su cuenta, y si la factura se anula se devuelve por esa misma cuenta
const fiadoT = await sellItems([line('T1', 2, 2000)], 'fiado', { fiadoName: 'Doña Ana' })
await run((q) => addFiadoPago(q, admin, fiadoT.id!, { amount: 1000, date: '', note: '', method: 'transferencia', account: 'nequi' }))
await fails(() => run((q) => addFiadoPago(q, admin, fiadoT.id!, { amount: 100, date: '', note: '', method: 'transferencia', account: 'otra' as never })), /cuenta de la transferencia no es válida/, 'el abono tampoco admite una cuenta inventada')
await run((q) => addFiadoPago(q, admin, fiadoT.id!, { amount: 500, date: '', note: '', method: 'transferencia', account: 'bancolombia' }))
await run((q) => addFiadoPago(q, admin, fiadoT.id!, { amount: 200, date: '', note: '', method: 'efectivo', account: 'nequi' }))
const abonos = (await movements()).filter((m) => m.refId === fiadoT.id && m.type === 'abono_fiado')
assert.deepEqual(abonos.map((m) => [m.medio, m.cuenta]), [['transferencia', 'nequi'], ['transferencia', 'bancolombia'], ['efectivo', undefined]], 'cada abono lleva su cuenta; el de efectivo no')
await run((q) => voidSale(q, admin, fiadoT.id!, 'error'))
const devueltos = (await movements()).filter((m) => m.refId === fiadoT.id && m.type === 'egreso')
assert.deepEqual(devueltos.map((m) => [m.medio, m.cuenta, m.amount]).sort(), [['efectivo', undefined, 200], ['transferencia', 'bancolombia', 500], ['transferencia', 'nequi', 1000]].sort(), 'anulada, cada abono vuelve por su caja y su cuenta')
ok('una transferencia lleva su cuenta (Nequi/Bancolombia) al libro de la Caja Mayor; corregir y anular la conservan, un abono por transferencia dice la suya y se devuelve por ella, y una cuenta inventada se rechaza')

// El cierre de caja las tiene en cuenta: lo que entró por cada cuenta (ventas y abonos, ya con lo corregido y lo devuelto).
const dayT = todayKey()
const fiadoU = await sellItems([line('T1', 1, 2000)], 'fiado', { fiadoName: 'Don Luis' })
await run((q) => addFiadoPago(q, admin, fiadoU.id!, { amount: 700, date: '', note: '', method: 'transferencia', account: 'nequi' })) // este abono no se devuelve
const aggT = await closingAggregate(db, dayT)
assert.equal(aggT.transferBreak.nequi, 2000 + 1000 - 1000 + 700, 'Nequi: la venta de 2.000 + el abono de 1.000 − lo devuelto de ese abono + otro abono de 700')
assert.equal(aggT.transferBreak.bancolombia, 2000 + 500 - 500, 'Bancolombia: la venta corregida a 2.000 + el abono de 500 − lo devuelto')
const anuladaAgg = computeDayAggregate(dayT, [{ ...viaNequi, voided: true, dayKey: dayT } as Sale], [], {})
assert.equal(anuladaAgg.transferBreak.nequi, 0, 'una venta anulada no cuenta en ninguna cuenta')
const fisicoT = await bal('menor')
const cierreT = await run((q) => confirmCierre(q, { dayKey: dayT, cajero: 'Ana', notas: '', efectivoFisico: fisicoT, trasladar: 0 }))
assert.deepEqual([cierreT.transferBreak?.nequi, cierreT.transferBreak?.bancolombia], [2700, 2000], 'el cierre archivado guarda lo que entró por cada cuenta')
const afterT = await closingAggregate(db, dayT)
assert.equal(afterT.transferBreak.nequi, 0, 'y lo ya cerrado no se cuenta otra vez (los movimientos de la Caja Mayor también quedan marcados)')
ok('el cierre del día suma lo que entró por cada cuenta, con lo corregido y lo devuelto, y no cuenta lo anulado')

// --- Descuento en dinero sobre un producto de la venta -----------------------------------------------
await putRow(db, 'products', 'code', 'D1', product('D1', 20, 500)) // vende a 1.000
const dLine = (code: string, qty: number, price: number, discount?: number) => ({ ...line(code, qty, price), ...(discount !== undefined ? { discount } : {}) })
const sellOff = (items: ReturnType<typeof dLine>[], discount: number, actor = admin) =>
  run((q) => finalizeSale(q, actor, { items, subtotal: sumOf(items), discount, total: sumOf(items) - discount, payMethod: 'efectivo' }))
menor = await bal('menor')
const conDesc = await sellOff([dLine('D1', 2, 1000, 500), dLine('T1', 1, 2000)], 500)
assert.equal(conDesc.total, 3500, 'el total es lo de los productos menos el descuento')
assert.equal(conDesc.discount, 500)
assert.equal(conDesc.items.find((i) => i.code === 'D1')?.discount, 500, 'la venta guarda a qué producto se le descontó')
assert.equal(conDesc.items.find((i) => i.code === 'T1')?.discount, undefined, 'y los demás quedan sin descuento')
assert.equal(await bal('menor'), menor + 3500, 'la caja recibe lo cobrado, ya sin el descuento')
const profitOf = async (id: number) => Number((await db.query<{ g: string }>(`select data ->> 'ganancia' as g from profits where key = $1`, [`sale:${id}`]))[0].g)
assert.equal(await profitOf(conDesc.id!), 3500 - (2 * 500 + 1000), 'la ganancia es lo cobrado menos lo que costó la mercancía: el descuento sale de ella')
await fails(() => sellOff([dLine('D1', 1, 1000, 1500)], 1500), /descuento de "Prod D1" no es válido/, 'no se descuenta más de lo que vale la línea')
await fails(() => sellOff([dLine('D1', 1, 1000, -5)], 0), /no es válido/, 'ni un descuento negativo')
await fails(() => sellOff([dLine('D1', 2, 1000, 600), dLine('T1', 1, 2000, 300)], 700), /no cuadran con el descuento de la venta/, 'los descuentos de las líneas no pueden sumar más que el de la venta')
const sinPermiso = { ...admin, needs: new Set<string>() }
const stockD1 = await stock('D1')
await assert.rejects(() => sellOff([dLine('D1', 1, 1000, 200)], 200, sinPermiso), 'sin permiso para descontar no se descuenta')
assert.equal(await stock('D1'), stockD1, 'y no se vendió nada')
// corregir deja a cada línea lo que se le descontó, sin pasar de lo que la línea vale ahora
await run((q) => correctSale(q, admin, conDesc.id!, [dLine('D1', 1, 1000, 500), line('T1', 1, 2000)], 'una sola'))
assert.equal((await getRow<Sale>(db, 'sales', 'id', conDesc.id!))!.items.find((i) => i.code === 'D1')?.discount, 500, 'la corrección conserva el descuento de la línea')
assert.equal(await profitOf(conDesc.id!), 2500 - (500 + 1000), 'y la ganancia de la factura corregida también descuenta lo que se rebajó')
// El costo de una factura es el de cuando se vendió: corregirla no lo reescribe aunque el producto haya cambiado de costo, y sin cambios la ganancia queda exacta.
await putRow(db, 'products', 'code', 'H1', product('H1', 10, 1000)) // vende a 2.000 y cuesta 1.000
const hist = await sellItems([line('H1', 1, 2000)])
const gHist = await profitOf(hist.id!)
await run((q) => correctSale(q, admin, hist.id!, [line('H1', 1, 2000)], 'solo reviso'))
assert.equal(await profitOf(hist.id!), gHist, 'corregir sin cambiar nada deja la ganancia exactamente como estaba')
await lite.query(`update public."productCosts" set data = jsonb_set(data, '{cost}', '1500') where code = 'H1'`)
await run((q) => correctSale(q, admin, hist.id!, [line('H1', 2, 2000)], 'eran dos'))
assert.equal(await profitOf(hist.id!), 4000 - 2 * 1000, 'el costo de la línea es el de cuando se vendió (1.000), no el de hoy (1.500)')
await run((q) => correctSale(q, admin, conDesc.id!, [dLine('D1', 1, 300, 500), line('T1', 1, 2000)], 'precio más bajo'))
assert.equal((await getRow<Sale>(db, 'sales', 'id', conDesc.id!))!.items.find((i) => i.code === 'D1')?.discount, 300, 'y si la línea ya vale menos, se corta a lo que vale')
// las cuentas del carrito: el descuento de una línea nunca pasa de lo que vale la línea
assert.equal(manualDiscountOf([{ price: 1000, qty: 2, discount: 3000 }, { price: 500, qty: 1, discount: 100 }]), 2100, 'cada línea cuenta, como mucho, lo que vale')
assert.equal(lineDiscount({ price: 1000, qty: 1 }), 0)
ok('un descuento en dinero se aplica a un producto de la venta: se guarda en su línea y en el total, no puede pasar de lo que vale la línea ni sumar más que el de la venta, pide el permiso de descontar, y corregir lo conserva')

// --- Egresos: la categoría tiene que ser una de las conocidas ------------------------------------
await fails(() => run((q) => cash.registerMovement(q, { caja: 'menor', direction: 'out', amount: 10, concept: 'x', category: 'inventada' as never })), /categoría/i, 'categoría desconocida')
await run((q) => cash.registerMovement(q, { caja: 'menor', direction: 'out', amount: 10, concept: 'x', category: 'mantenimiento' }))
ok('un egreso solo acepta categorías conocidas')

// --- Precio de venta desde el pedido: cambia el producto al recibir, nunca las ventas ya hechas ---------------------
const salesBefore = JSON.stringify(await listAll<Sale>(db, 'sales'))
await putRow(db, 'products', 'code', 'P1', { ...product('P1', 4, 1000), price2: 2500 }) // vende a 2.000 (Precio 2: 2.500)
const planned = (await run((q) =>
  buying.createOrder(q, {
    supplierId: credito.id,
    send: true,
    lines: [
      { code: 'P1', qty: 6, unitCost: 1200, salePrice: 2600 },
      { code: 'R1', qty: 1, unitCost: 5015, salePrice: 10030 }, // el que ya tiene: no es un cambio
      { code: 'V2', qty: 2, unitCost: 500 },
    ],
  }),
)) as PurchaseOrder & { id: number }
assert.deepEqual(
  planned.lines.map((l) => l.salePrice),
  [2600, undefined, undefined],
)
await fails(() => run((q) => buying.createOrder(q, { supplierId: credito.id, lines: [{ code: 'P1', qty: 1, unitCost: 1, salePrice: -5 }] })), /precio de venta de "Prod P1" no es válido/, 'precio de venta inválido')
assert.equal((await getRow<Product>(db, 'products', 'code', 'P1'))!.price, 2000, 'pedir no cambia el precio todavía')
ok('el pedido guarda el precio de venta nuevo de cada producto (el que ya tiene no cuenta como cambio) y todavía no lo aplica')

let priceAsks = 0
const countAsk = { onPriceChange: async () => void priceAsks++ }
// V2 no llegó (0): aunque la recepción traiga un precio, no cambia.
const got = await run((q) => buying.receiveOrder(q, planned.id, { lines: [{ code: 'V2', qtyReceived: 0, unitCost: 500, salePrice: 1500 }], payment: { mode: 'credito' } }, countAsk))
const p1 = (await getRow<Product>(db, 'products', 'code', 'P1'))!
assert.equal(p1.price, 2600)
assert.equal(p1.price2, 2500, 'el Precio 2 se conserva')
assert.equal(p1.stock, 10)
assert.equal(await costOf(db, 'P1'), 1200)
assert.equal((await getRow<Product>(db, 'products', 'code', 'V2'))!.price, 1000, 'lo que no llegó no cambia de precio')
assert.equal(priceAsks, 1, 'el permiso de cambiar precios se pide una vez')
assert.deepEqual(
  got.lines.map((l) => [l.code, l.salePrice, l.priceBefore]),
  [
    ['P1', 2600, 2000],
    ['R1', undefined, undefined],
    ['V2', undefined, undefined],
  ],
)
assert.equal(JSON.stringify(await listAll<Sale>(db, 'sales')), salesBefore, 'las ventas ya hechas no cambian (ni sus precios)')

const second = (await run((q) => buying.createOrder(q, { supplierId: credito.id, send: true, lines: [{ code: 'P1', qty: 1, unitCost: 1200, salePrice: 2800 }] }))) as PurchaseOrder & { id: number }
const refuse = { onPriceChange: async () => Promise.reject(new Error('sin permiso para cambiar precios')) }
await fails(() => run((q) => buying.receiveOrder(q, second.id, { payment: { mode: 'credito' } }, refuse)), /sin permiso para cambiar precios/, 'sin permiso no se cambian precios')
assert.equal((await getRow<Product>(db, 'products', 'code', 'P1'))!.stock, 10, 'rechazado: no se escribe nada (ni el stock)')
const backToSame = await run((q) => buying.receiveOrder(q, second.id, { lines: [{ code: 'P1', qtyReceived: 1, unitCost: 1200, salePrice: 2600 }], payment: { mode: 'credito' } }, countAsk))
assert.equal(priceAsks, 1, 'si la recepción deja el precio que ya tiene, no hay cambio que autorizar')
assert.equal(backToSame.lines[0].salePrice, undefined)
assert.equal((await getRow<Product>(db, 'products', 'code', 'P1'))!.price, 2600)
assert.equal((await getRow<Product>(db, 'products', 'code', 'P1'))!.stock, 11)
ok('al recibir, el precio de venta pasa al producto junto con el stock y el costo (pide permiso de editar productos), Precio 2 se conserva, lo que no llegó no cambia, el pedido guarda el precio anterior y las ventas hechas quedan igual')

// --- Apertura: lo que sobra o falta frente al libro puede ser plata que salió de la Caja Mayor o que fue hacia ella ---------
// Quien se lleva todo al cerrar y cada mañana pone una base: sin decir de dónde sale, esa base quedaba como "sobrante" (y la
// Mayor seguía contando una plata que ya no está ahí), y el efectivo llevado sin anotar quedaba como "faltante". Al abrir se
// puede decir que fue la Caja Mayor, y entonces se anota el traslado que faltó.
const closeDay = async (leave = 0) => {
  const m = await bal('menor')
  await run((q) => confirmCierre(q, { dayKey: todayKey(), cajero: 'Ana', notas: '', efectivoFisico: m, trasladar: m - leave }))
}
await closeDay() // todo a la Mayor: la Menor queda en 0
assert.equal(await bal('menor'), 0)
const mayorA = await bal('mayor')
assert.ok(mayorA >= 20000, 'la Mayor tiene con qué poner una base')
let seen = (await movements()).length

const baseOpen = await run((q) => cash.openCaja(q, { countedCash: 7500, by: 'Ana', settleWith: 'mayor', settledBy: 'Ana (autorizó Sofía)' }))
assert.equal(baseOpen.openDiff, 7500)
assert.equal(baseOpen.openSettledWith, 'mayor')
assert.equal(await bal('menor'), 7500)
assert.equal(await bal('mayor'), mayorA - 7500)
const baseMoves = (await movements()).slice(seen)
assert.deepEqual(baseMoves.map((m) => `${m.caja}:${m.type}`).sort(), ['mayor:traslado_salida', 'menor:traslado_entrada'], 'solo el traslado: ningún ajuste de arqueo')
const [fromMayor, toMenor] = [baseMoves.find((m) => m.caja === 'mayor')!, baseMoves.find((m) => m.caja === 'menor')!]
assert.equal(fromMayor.transferId, toMenor.transferId, 'las dos puntas van enlazadas')
assert.equal(toMenor.sessionId, baseOpen.id, 'entra al día que se abre')
assert.match(toMenor.concept, /Traslado desde Caja Mayor · base al abrir caja/)
assert.equal(toMenor.by, 'Ana (autorizó Sofía)', 'firmado por quien lo autorizó')
ok('abrir con una base que salió de la Caja Mayor: se traslada de la Mayor a la Menor (con su motivo y su firma), sin sobrante, y las dos cajas cuadran')

await closeDay()
const mayorB = await bal('mayor')
const sessionsBefore = (await listAll(db, 'cashSessions')).length
await fails(() => run((q) => cash.openCaja(q, { countedCash: mayorB + 1, by: 'Ana', settleWith: 'mayor' })), /Saldo insuficiente en Caja Mayor/, 'la Mayor no tiene tanto')
assert.equal((await listAll(db, 'cashSessions')).length, sessionsBefore, 'rechazada: ni siquiera queda la sesión')
assert.equal(await cash.openSession(db), undefined)
assert.equal(await bal('mayor'), mayorB)
assert.equal(await bal('menor'), 0)
ok('si la Caja Mayor no tiene lo que se dice que salió de ella, la apertura se rechaza completa (sin sesión ni movimientos)')

// Efectivo que se llevó sin anotar: el libro tenía 9.000 y al abrir solo hay 3.000 → los 6.000 fueron a la Mayor.
await run((q) => cash.openCaja(q, { countedCash: 9000, by: 'Ana', settleWith: 'mayor' }))
await closeDay(9000) // cierra sin trasladar nada: los 9.000 siguen en el libro
const mayorC = await bal('mayor')
seen = (await movements()).length
const lessOpen = await run((q) => cash.openCaja(q, { countedCash: 3000, by: 'Ana', settleWith: 'mayor' }))
assert.equal(lessOpen.openDiff, -6000)
assert.equal(lessOpen.openSettledWith, 'mayor')
assert.equal(await bal('menor'), 3000)
assert.equal(await bal('mayor'), mayorC + 6000)
const lessMoves = (await movements()).slice(seen)
assert.deepEqual(lessMoves.map((m) => `${m.caja}:${m.type}`).sort(), ['mayor:traslado_entrada', 'menor:traslado_salida'], 'ningún faltante: el traslado que faltó anotar')
assert.match(lessMoves[0].concept, /efectivo llevado antes de abrir caja/)
ok('abrir con menos de lo que dice el libro y decir que se llevó a la Caja Mayor: se anota el traslado que faltó (sin faltante)')

await closeDay(3000)
seen = (await movements()).length
const exactOpen = await run((q) => cash.openCaja(q, { countedCash: 3000, by: 'Ana', settleWith: 'mayor' }))
assert.equal(exactOpen.openDiff, 0)
assert.equal(exactOpen.openSettledWith, undefined)
assert.equal((await movements()).length, seen, 'no se movió nada')
ok('sin diferencia no hay nada que cuadrar con la Caja Mayor, aunque se pida')

await closeDay()
seen = (await movements()).length
const plainOpen = await run((q) => cash.openCaja(q, { countedCash: 2500, by: 'Ana' }))
assert.equal(plainOpen.openSettledWith, undefined)
assert.deepEqual((await movements()).slice(seen).map((m) => `${m.type}:${m.concept}`), ['ajuste_arqueo:Sobrante al abrir caja'])
ok('sin elegir la Caja Mayor, la diferencia se anota como sobrante al abrir caja, como siempre')

// Lo que no se admite: una forma que no existe, y la primera apertura (su efectivo es la base inicial: no sale de ninguna Mayor).
await closeDay()
await fails(() => run((q) => cash.openCaja(q, { countedCash: 1, by: 'Ana', settleWith: 'banco' as never })), /no existe/, 'forma desconocida')
const newStore = pgliteDb(await testDatabase())
await fails(() => newStore.tx((q) => cash.openCaja(q, { countedCash: 5000, by: 'Ana', settleWith: 'mayor' })), /primera apertura/, 'la primera apertura no sale de la Mayor')
assert.equal(await cash.isFirstOpening(newStore), true, 'rechazada: sigue sin haber ninguna apertura')
await newStore.end()
ok('cuadrar la apertura con la Caja Mayor no admite una forma desconocida ni la primera apertura')

await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones del dinero pasaron.`)
