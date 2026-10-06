import type { CartItem } from '../../src/types/cartItem'
import type { CorrectionAuditEntry, SaleSnapshot } from '../../src/types/auditLog'
import type { Customer } from '../../src/types/customer'
import type { Product } from '../../src/types/product'
import type { FiadoPago, PayMethod, Sale } from '../../src/types/sale'
import { dayKeyOf, formatMoney } from '../../src/shared/lib/currency'
import { loyaltyDiscount } from '../../src/shared/lib/loyalty'
import type { Sql } from '../db'
import { getRow, insertAutoRow, putRow, roundQty } from '../routes/generic'
import { HttpError } from '../routes/http'
import { recordFiadoCollection, recordSaleCorrection, recordSaleReceipt, type CollectMethod } from './cash'
import { requireNeed, type Actor } from './counter'
import { costsOf } from './secrets'

/** Sales, corrections and fiado payments. The browser sends what the cashier rang up; the server
 * re-prices it from the inventory and decides what needs a permission — so a sale can't be saved at
 * a made-up price, with a discount, a changed total, on credit or with an unregistered product
 * unless whoever is working may do it (or someone allowed approved it with their PIN). The profit
 * is computed here from the purchase prices, which the browser never sees. */

const TABLE = 'sales'
const PAY_METHODS: PayMethod[] = ['efectivo', 'transferencia', 'fiado']
/** Cents of float noise between the browser's sums and ours. */
const EPS = 0.01

export interface FinalizeSaleInput {
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  roundingAdjustment?: number
  amountReceived?: number
  changeGiven?: number
  payMethod: PayMethod
  customerId?: string | null
  customerName?: string | null
  fiadoName?: string | null
  notes?: string
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Lifetime spend of a customer, for the loyalty discount (1 point per $10). */
async function loyaltyPoints(sql: Sql, customerId: string): Promise<number> {
  const [row] = await sql.query<{ spent: number }>(`select coalesce(sum((data ->> 'total')::float8), 0)::float8 as spent from sales where data ->> 'customerId' = $1`, [customerId])
  return Math.floor(Number(row?.spent ?? 0) / 10)
}

/** The cart lines as they'll be saved: inventory products at their current price, name and unit;
 * free-form lines as typed (they need `ventas.productoLibre`). */
async function priceLines(sql: Sql, items: unknown): Promise<{ lines: CartItem[]; products: Map<string, Product>; hasFree: boolean }> {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Carrito vacío')
  if (items.length > 500) throw new Error('Demasiados productos en una sola venta')
  const products = new Map<string, Product>()
  const lines: CartItem[] = []
  let hasFree = false
  for (const raw of items as Array<Partial<CartItem>>) {
    const qty = roundQty(num(raw?.qty))
    if (!(qty > 0) || qty > 1_000_000) throw new Error('Hay una cantidad inválida en el carrito')
    const price = num(raw?.price)
    if (raw?.isFree === true) {
      const code = text(raw.code, 60)
      const name = text(raw.name, 80)
      if (!code.startsWith('FREE_') || !name || !(price >= 0) || price > 1e9) throw new Error('Hay un producto sin registrar inválido')
      hasFree = true
      lines.push({ code, name, price, cost: 0, qty, brand: '', unit: 'unidad', isFree: true })
      continue
    }
    const code = text(raw?.code, 60)
    const p = products.get(code) ?? (await getRow<Product>(sql, 'products', 'code', code))
    if (!p) throw new Error(`"${text(raw?.name, 80) || code}" ya no existe en el inventario: quítalo del carrito`)
    products.set(code, p)
    if (!(Math.abs(price - p.price) < 0.005)) throw new Error(`El precio de "${p.name}" cambió a ${formatMoney(p.price)}: quítalo del carrito y agrégalo de nuevo`)
    lines.push({ code: p.code, name: p.name, price: p.price, cost: 0, qty, brand: p.brand || '', unit: p.unit || 'unidad', isFree: false })
  }
  return { lines, products, hasFree }
}

/** Insert the sale AND decrement stock atomically. Free items never touch stock. */
export async function finalizeSale(sql: Sql, actor: Actor, input: FinalizeSaleInput): Promise<Sale> {
  const payMethod = input?.payMethod
  if (!PAY_METHODS.includes(payMethod)) throw new Error('Elige la forma de pago')
  const { lines, products, hasFree } = await priceLines(sql, input.items)

  // Checked here (not just in the browser) because this is the one place two devices selling the
  // same product at once can't race each other: db.tx serializes writes.
  const wanted = new Map<string, number>()
  for (const l of lines) if (!l.isFree) wanted.set(l.code, roundQty((wanted.get(l.code) ?? 0) + l.qty))
  for (const [code, qty] of wanted) {
    const p = products.get(code)!
    if (qty > (p.stock || 0)) throw new Error(`Stock insuficiente de "${p.name}" (quedan ${p.stock})`)
  }

  const subtotal = lines.reduce((a, i) => a + i.price * i.qty, 0)
  if (!(Math.abs(num(input.subtotal) - subtotal) <= EPS)) throw new Error('Los totales de la venta no cuadran: revisa el carrito e inténtalo de nuevo')

  const customerId = text(input.customerId, 80) || undefined
  const customer = customerId ? await getRow<Customer>(sql, 'customers', 'id', customerId) : undefined
  if (customerId && !customer) throw new Error('Ese cliente ya no existe: elige otro')

  // The loyalty discount is automatic; anything above it is a manual discount.
  const discount = num(input.discount)
  if (!(discount >= 0) || discount > subtotal + EPS) throw new Error('El descuento no es válido')
  const loyalty = customerId ? loyaltyDiscount(subtotal, await loyaltyPoints(sql, customerId)) : 0
  if (discount > loyalty + EPS) await requireNeed(sql, actor, 'ventas.descuentos')

  const base = subtotal - discount
  const total = num(input.total)
  if (!(total >= 0)) throw new Error('El total no es válido')
  const adjusted = Math.abs(total - base) > 0.005
  if (adjusted) await requireNeed(sql, actor, 'ventas.cambiarTotal')

  const fiadoName = payMethod === 'fiado' ? text(input.fiadoName, 80) || customer?.name || '' : ''
  if (payMethod === 'fiado') {
    if (!fiadoName) throw new Error('Escribe el nombre del cliente fiado')
    await requireNeed(sql, actor, 'ventas.fiar')
  }
  if (hasFree) await requireNeed(sql, actor, 'ventas.productoLibre')

  let amountReceived: number | undefined
  if (payMethod === 'efectivo' && input.amountReceived !== undefined && input.amountReceived !== null) {
    amountReceived = num(input.amountReceived)
    if (!(amountReceived >= 0)) throw new Error('El efectivo recibido no es válido')
    if (amountReceived > 0 && amountReceived + 0.005 < total) throw new Error('El efectivo recibido no alcanza el total')
    if (amountReceived === 0) amountReceived = undefined
  }

  // Profit from the purchase prices — the browser never sees them. Free lines count whole, as before.
  const costs = await costsOf(sql, [...wanted.keys()])
  const items = lines.map((l) => ({ ...l, cost: l.isFree ? 0 : (costs.get(l.code) ?? 0) }))
  const ganancia = items.reduce((g, i) => g + (i.price - i.cost) * i.qty, 0)

  const date = new Date().toISOString()
  const saleData: Sale = {
    items,
    subtotal,
    discount,
    total,
    roundingAdjustment: adjusted ? total - base : undefined,
    amountReceived,
    changeGiven: amountReceived !== undefined ? amountReceived - total : undefined,
    ganancia,
    payMethod,
    customerId,
    customerName: customer?.name,
    fiadoName: fiadoName || undefined,
    date,
    dayKey: dayKeyOf(date),
    notes: text(input.notes, 300) || undefined,
    // Who sold it is whoever is signed in on this device — not what the browser says.
    sellerId: actor.operator?.id,
    sellerName: actor.operator?.name,
  }
  // The table's trigger moves `ganancia` and the item costs out of the row everyone reads.
  const sale = await insertAutoRow(sql, TABLE, saleData)
  await recordSaleReceipt(sql, sale)
  for (const [code, qty] of wanted) {
    const p = products.get(code)!
    await putRow(sql, 'products', 'code', code, { ...p, stock: roundQty(Math.max(0, (p.stock || 0) - qty)) })
  }
  return sale
}

function fiadoDebt(sale: Sale): number {
  const paid = (sale.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  return Math.max(0, sale.total - paid)
}

async function fiadoSale(sql: Sql, id: number): Promise<Sale & { id: number }> {
  const s = await getRow<Sale & { id: number }>(sql, TABLE, 'id', id)
  if (!s) throw new Error('Venta no encontrada')
  if (s.payMethod !== 'fiado') throw new Error('Esa venta no es un fiado')
  return s
}

const collectMethod = (v: unknown): CollectMethod => (v === 'transferencia' ? 'transferencia' : 'efectivo')

/** One payment (or a forgiveness) of a fiado. A real payment is money in the caja that matches how
 * it arrived; forgiving moves nothing. */
export async function addFiadoPago(sql: Sql, actor: Actor, saleId: number, input: Partial<FiadoPago>): Promise<Sale> {
  const condonado = input?.condonado === true
  await requireNeed(sql, actor, condonado ? 'fiados.condonar' : 'fiados.abonar')
  const s = await fiadoSale(sql, saleId)
  const debt = fiadoDebt(s)
  const amount = num(input.amount)
  if (!(amount > 0)) throw new Error('El monto debe ser mayor a 0')
  if (amount > debt + 0.005) throw new Error(`El abono supera la deuda (${formatMoney(debt)})`)
  const method = collectMethod(input.method)
  const pago: FiadoPago = { amount, date: new Date().toISOString(), note: text(input.note, 200), ...(condonado ? { condonado: true } : { method }) }
  const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
  await putRow(sql, TABLE, 'id', saleId, u)
  if (!condonado) await recordFiadoCollection(sql, { ...u, id: saleId }, amount, method)
  return u
}

/** Pays (or forgives) the whole remaining debt of each sale. `strict` (one sale picked on purpose):
 * a sale that isn't a fiado is an error instead of being skipped. */
export async function settleFiados(sql: Sql, actor: Actor, saleIds: number[], note: string, condone: boolean, rawMethod: unknown, strict = false): Promise<number> {
  await requireNeed(sql, actor, condone ? 'fiados.condonar' : 'fiados.abonar')
  if (!Array.isArray(saleIds)) throw new Error('No hay fiados para pagar')
  const method = collectMethod(rawMethod)
  let total = 0
  for (const id of saleIds) {
    const s = strict ? await fiadoSale(sql, Number(id)) : await getRow<Sale & { id: number }>(sql, TABLE, 'id', Number(id))
    if (!s || s.payMethod !== 'fiado') continue
    const debt = fiadoDebt(s)
    if (debt <= 0) continue
    total += debt
    const pago: FiadoPago = { amount: debt, date: new Date().toISOString(), note: text(note, 200), ...(condone ? { condonado: true } : { method }) }
    const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
    await putRow(sql, TABLE, 'id', s.id, u)
    if (!condone) await recordFiadoCollection(sql, { ...u, id: s.id }, debt, method)
  }
  return total
}

/** Post-hoc edit of an already-finalized sale — restores the original items' stock, applies the new
 * items' stock, recalculates totals and the profit, and logs a correccion_venta audit entry. */
export async function correctSale(sql: Sql, actor: Actor, saleId: number, newItemsRaw: unknown, reasonRaw: unknown): Promise<Sale> {
  await requireNeed(sql, actor, 'facturas.corregir')
  const s = await getRow<Sale>(sql, TABLE, 'id', saleId)
  if (!s) throw new Error('Venta no encontrada')
  const reason = text(reasonRaw, 300)
  if (!Array.isArray(newItemsRaw) || newItemsRaw.length > 500) throw new Error('Los productos de la corrección no son válidos')
  const newItems: CartItem[] = (newItemsRaw as Array<Partial<CartItem>>).map((i) => {
    const qty = roundQty(num(i?.qty))
    const price = num(i?.price)
    const code = text(i?.code, 60)
    if (!code || !(qty > 0) || !(price >= 0)) throw new Error('Los productos de la corrección no son válidos')
    return { code, name: text(i.name, 120), price, cost: 0, qty, brand: text(i.brand, 60), unit: text(i.unit, 20) || 'unidad', isFree: i.isFree === true }
  })

  const before: SaleSnapshot = { items: s.items, subtotal: s.subtotal, total: s.total, discount: s.discount || 0 }
  const isTracked = (ci: CartItem) => !ci.isFree && ci.code !== 'CORR' && !ci.code.startsWith('FREE_')

  for (const ci of s.items) {
    if (!isTracked(ci)) continue
    const p = await getRow<Product>(sql, 'products', 'code', ci.code)
    if (p) await putRow(sql, 'products', 'code', ci.code, { ...p, stock: roundQty(p.stock + ci.qty) })
  }
  for (const ci of newItems) {
    if (!isTracked(ci)) continue
    const p = await getRow<Product>(sql, 'products', 'code', ci.code)
    if (p) await putRow(sql, 'products', 'code', ci.code, { ...p, stock: roundQty(Math.max(0, p.stock - ci.qty)) })
  }

  const newSub = newItems.reduce((sum, i) => sum + i.price * i.qty, 0)
  const newDisc = s.discount || 0
  const newTotal = Math.max(0, newSub - newDisc)
  const costs = await costsOf(sql, newItems.filter(isTracked).map((i) => i.code))
  const items = newItems.map((ci) => ({ ...ci, cost: isTracked(ci) ? (costs.get(ci.code) ?? 0) : 0 }))
  const newGanancia = items.reduce((g, ci) => g + (ci.price - ci.cost) * ci.qty, 0)

  const after: SaleSnapshot = { items: newItems, subtotal: newSub, total: newTotal, discount: newDisc }
  const auditEntry: Omit<CorrectionAuditEntry, 'id'> = {
    type: 'correccion_venta',
    date: new Date().toISOString(),
    saleId,
    reason,
    before,
    after,
    totalDiff: newTotal - before.total,
  }
  await insertAutoRow(sql, 'auditLog', auditEntry)

  const updatedSale: Sale = {
    ...s,
    items,
    subtotal: newSub,
    total: newTotal,
    ganancia: newGanancia,
    corrected: true,
    correctedAt: new Date().toISOString(),
    correctionReason: reason,
  }
  await putRow(sql, TABLE, 'id', saleId, updatedSale)
  await recordSaleCorrection(sql, { ...updatedSale, id: saleId }, newTotal - before.total)
  // What goes back to the browser is the row as stored — without the profit or the costs.
  return (await getRow<Sale>(sql, TABLE, 'id', saleId))!
}

export function assertSaleId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Venta no encontrada')
  return id
}
