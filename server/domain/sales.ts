import type { CartItem } from '../../src/types/cartItem'
import type { CorrectionAuditEntry, SaleSnapshot, VoidAuditEntry } from '../../src/types/auditLog'
import type { Customer } from '../../src/types/customer'
import type { Product } from '../../src/types/product'
import type { FiadoPago, PayMethod, Sale } from '../../src/types/sale'
import { round2 } from '../../src/shared/lib/cash'
import { dayKeyOf, formatMoney } from '../../src/shared/lib/currency'
import { samePrice, sellingPrices } from '../../src/shared/lib/prices'
import { isTransferAccount, type TransferAccount } from '../../src/shared/lib/transferAccounts'
import { isTracked, stockEffect } from '../../src/shared/lib/saleStock'
import type { Sql } from '../db'
import { getRow, getRowsByKey, insertAutoRow, putRow, roundQty, setStocks, text } from '../routes/generic'
import { HttpError } from '../routes/http'
import { recordFiadoCollection, recordFiadoRefund, recordSaleCorrection, recordSaleReceipt, recordSaleVoid, type CollectMethod } from './cash'
import { requireNeed, type Actor } from './counter'
import { dropSharedReceipt, refreshSharedReceipt } from './receipts'
import { costsOf } from './secrets'

/** Sales, corrections and fiado payments. The browser sends what the cashier rang up; the server
 * re-prices it from the inventory and decides what needs a permission — so a sale can't be saved at
 * a made-up price, with a discount, a changed total or on credit unless whoever is working may do
 * it (or someone allowed approved it with their PIN) — and every line must be an inventory product,
 * except a "producto sin registrar" (`ventas.productoLibre`). The profit is computed here from the
 * purchase prices, which the browser never sees. */

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
  /** For a transfer: the account it came into. */
  transferAccount?: TransferAccount | null
  customerId?: string | null
  customerName?: string | null
  fiadoName?: string | null
  notes?: string
  /** The device's code for this sale: a second request with the same code returns the sale already saved
   * instead of making another (see `saleByClientId`). */
  clientId?: string
}

/** The account a transfer came into: none, or one of the store's — anything else is a bad request. */
export function cleanAccount(v: unknown): TransferAccount | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (isTransferAccount(v)) return v
  throw new Error('La cuenta de la transferencia no es válida')
}

/** The money discount a cart line carries: none, or an amount between 0 and what the line is worth. `strict` (a sale
 * being made) refuses anything else; otherwise (a correction) a figure that no longer fits is cut down to the line. */
export function cleanLineDiscount(raw: unknown, gross: number, name: string, strict = true): number {
  if (raw === undefined || raw === null || raw === 0) return 0
  const d = num(raw)
  if (!(d >= 0) || d > gross + EPS) {
    if (strict || !(d >= 0)) throw new Error(`El descuento de "${name}" no es válido`)
  }
  return Math.round(Math.min(d, gross) * 100) / 100
}

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

/** The code a device gave a sale (a UUID): none, or a well-formed one — anything else is a bad request. */
export function cleanClientId(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'string' && /^[0-9a-zA-Z-]{16,64}$/.test(v)) return v
  throw new HttpError(400, 'El identificador de la venta no es válido')
}

/** The sale a device already sent under this code, if any. Writes run one at a time (db.tx), so asking
 * and then inserting can't be raced by the same sale arriving twice at once. */
export async function saleByClientId(sql: Sql, clientId: string): Promise<(Sale & { id: number }) | undefined> {
  const [row] = await sql.query<{ data: Sale & { id: number } }>(`select data from sales where data ->> 'clientId' = $1 limit 1`, [clientId])
  return row?.data
}

/** The code the cart gives a "producto sin registrar": `FREE_` and a random id. It is what makes a line one (`isTracked`). */
export const FREE_CODE = /^FREE_[0-9A-Za-z-]{8,50}$/

/** The cart lines as they'll be saved: inventory products at one of their current prices (Precio 1,
 * 2 or 3), with their current name and unit, and "productos sin registrar" (`FREE_…`) with the name and
 * price typed at the till, which never touch the stock. Any other line that is not an inventory product
 * is refused like a product that no longer exists. */
async function priceLines(sql: Sql, items: unknown): Promise<{ lines: CartItem[]; products: Map<string, Product>; hasFree: boolean }> {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Carrito vacío')
  if (items.length > 500) throw new Error('Demasiados productos en una sola venta')
  const raws = items as Array<Partial<CartItem>>
  // Every product on the ticket in one trip, not one per line.
  const products = await getRowsByKey<Product>(sql, 'products', 'code', raws.map((r) => text(r?.code, 60)))
  const lines: CartItem[] = []
  let hasFree = false
  for (const raw of raws) {
    const qty = roundQty(num(raw?.qty))
    if (!(qty > 0) || qty > 1_000_000) throw new Error('Hay una cantidad inválida en el carrito')
    const price = num(raw?.price)
    const code = text(raw?.code, 60)
    if (code.startsWith('FREE_')) {
      const name = text(raw?.name, 120)
      if (!FREE_CODE.test(code) || !name || !(price > 0) || price > 1e9) throw new Error('Hay un producto sin registrar sin nombre o sin precio: quítalo del carrito y agrégalo de nuevo')
      const off = cleanLineDiscount(raw?.discount, price * qty, name)
      lines.push({ code, name, price, cost: 0, qty, ...(off > 0 ? { discount: off } : {}), brand: '', unit: 'unidad', isFree: true })
      hasFree = true
      continue
    }
    const p = products.get(code)
    if (!p) throw new Error(`"${text(raw?.name, 80) || code}" ya no existe en el inventario: quítalo del carrito`)
    // The line may be charged at any of the product's registered prices (Precio 1, 2 or 3): the
    // cashier chooses on the cart line, and none of them needs a permission because the Administrador
    // set them all. Anything else is a price the browser made up (or one that changed since).
    const charged = sellingPrices(p).find((x) => samePrice(price, x))
    if (charged === undefined) throw new Error(`El precio de "${p.name}" cambió a ${formatMoney(p.price)}: quítalo del carrito y agrégalo de nuevo`)
    const off = cleanLineDiscount(raw?.discount, charged * qty, p.name)
    lines.push({ code: p.code, name: p.name, price: charged, cost: 0, qty, ...(off > 0 ? { discount: off } : {}), brand: p.brand || '', unit: p.unit || 'unidad', isFree: false })
  }
  return { lines, products, hasFree }
}

/** Insert the sale AND decrement stock atomically. */
export async function finalizeSale(sql: Sql, actor: Actor, input: FinalizeSaleInput): Promise<Sale> {
  const payMethod = input?.payMethod
  if (!PAY_METHODS.includes(payMethod)) throw new Error('Elige la forma de pago')
  // The same sale arriving twice (a reply that got lost and was sent again) is one sale.
  const clientId = cleanClientId(input.clientId)
  if (clientId) {
    const already = await saleByClientId(sql, clientId)
    if (already) return already
  }
  const transferAccount = payMethod === 'transferencia' ? cleanAccount(input.transferAccount) : undefined
  const { lines, products, hasFree } = await priceLines(sql, input.items)

  // Checked here (not just in the browser) because this is the one place two devices selling the
  // same product at once can't race each other: db.tx serializes writes. A product sin registrar has no stock.
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

  // Every discount is a manual one: it needs the permission (or someone allowed approving it).
  const discount = num(input.discount)
  if (!(discount >= 0) || discount > subtotal + EPS) throw new Error('El descuento no es válido')
  // What the lines say was taken off them is part of the sale's discount (a discount an older screen sent for the whole sale is what can be left over).
  if (lines.reduce((a, l) => a + (l.discount ?? 0), 0) > discount + EPS) throw new Error('Los descuentos de los productos no cuadran con el descuento de la venta: revisa el carrito e inténtalo de nuevo')
  if (discount > EPS) await requireNeed(sql, actor, 'ventas.descuentos')
  if (hasFree) await requireNeed(sql, actor, 'ventas.productoLibre')

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

  let amountReceived: number | undefined
  if (payMethod === 'efectivo' && input.amountReceived !== undefined && input.amountReceived !== null) {
    amountReceived = num(input.amountReceived)
    if (!(amountReceived >= 0)) throw new Error('El efectivo recibido no es válido')
    if (amountReceived > 0 && amountReceived + 0.005 < total) throw new Error('El efectivo recibido no alcanza el total')
    if (amountReceived === 0) amountReceived = undefined
  }

  // Profit from the purchase prices — the browser never sees them. A product sin registrar has no cost: it counts whole.
  const costs = await costsOf(sql, [...wanted.keys()])
  const items = lines.map((l) => ({ ...l, cost: costs.get(l.code) ?? 0 }))
  // What was charged minus what the goods cost: a discount (or the rounding of a cash charge) comes off the profit.
  const ganancia = round2(total - items.reduce((c, i) => c + i.cost * i.qty, 0))

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
    transferAccount,
    customerId,
    customerName: customer?.name,
    fiadoName: fiadoName || undefined,
    date,
    dayKey: dayKeyOf(date),
    notes: text(input.notes, 300) || undefined,
    // Who sold it is whoever is signed in on this device — not what the browser says.
    sellerId: actor.operator.id,
    sellerName: actor.operator.name,
    clientId,
  }
  // The table's trigger moves `ganancia` and the item costs out of the row everyone reads.
  const sale = await insertAutoRow(sql, TABLE, saleData)
  await recordSaleReceipt(sql, sale)
  // The stock of every product sold, in one statement.
  await setStocks(sql, [...wanted].map(([code, qty]) => ({ code, stock: roundQty(Math.max(0, (products.get(code)!.stock || 0) - qty)) })))
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
  if (s.voided) throw new Error('Esa factura está anulada: ya no tiene deuda')
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
  const account = !condonado && method === 'transferencia' ? cleanAccount(input.account) : undefined
  const pago: FiadoPago = { amount, date: new Date().toISOString(), note: text(input.note, 200), ...(condonado ? { condonado: true } : { method, ...(account ? { account } : {}) }) }
  const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
  await putRow(sql, TABLE, 'id', saleId, u)
  if (!condonado) await recordFiadoCollection(sql, { ...u, id: saleId }, amount, method, account)
  return u
}

/** Pays (or forgives) the whole remaining debt of each sale. `strict` (one sale picked on purpose):
 * a sale that isn't a fiado is an error instead of being skipped. */
export async function settleFiados(sql: Sql, actor: Actor, saleIds: number[], note: string, condone: boolean, rawMethod: unknown, strict = false, rawAccount?: unknown): Promise<number> {
  await requireNeed(sql, actor, condone ? 'fiados.condonar' : 'fiados.abonar')
  if (!Array.isArray(saleIds)) throw new Error('No hay fiados para pagar')
  const method = collectMethod(rawMethod)
  const account = !condone && method === 'transferencia' ? cleanAccount(rawAccount) : undefined
  let total = 0
  for (const id of saleIds) {
    const s = strict ? await fiadoSale(sql, Number(id)) : await getRow<Sale & { id: number }>(sql, TABLE, 'id', Number(id))
    if (!s || s.payMethod !== 'fiado' || s.voided) continue
    const debt = fiadoDebt(s)
    if (debt <= 0) continue
    total += debt
    const pago: FiadoPago = { amount: debt, date: new Date().toISOString(), note: text(note, 200), ...(condone ? { condonado: true } : { method, ...(account ? { account } : {}) }) }
    const u: Sale = { ...s, fiadoPagos: [...(s.fiadoPagos || []), pago] }
    await putRow(sql, TABLE, 'id', s.id, u)
    if (!condone) await recordFiadoCollection(sql, { ...u, id: s.id }, debt, method, account)
  }
  return total
}

/** Post-hoc edit of an already-finalized sale. Whatever the lines become, the inventory follows: the old lines give
 * their units back and the new ones take theirs, per product, in one statement (`stockEffect`); the caja moves by
 * the difference of the total; and the profit, the audit log and a receipt link already sent are brought up to date.
 * Every line must be an inventory product — chosen from the list, never typed free — except the free-form lines an
 * old sale already had, which can stay as they are. */
export async function correctSale(sql: Sql, actor: Actor, saleId: number, newItemsRaw: unknown, reasonRaw: unknown): Promise<Sale> {
  const by = await requireNeed(sql, actor, 'facturas.corregir')
  const s = await getRow<Sale>(sql, TABLE, 'id', saleId)
  if (!s) throw new Error('Venta no encontrada')
  if (s.voided) throw new Error('Esa factura está anulada: ya no se puede corregir')
  const reason = text(reasonRaw, 300)
  if (!reason) throw new Error('Escribe el motivo de la corrección')
  if (!Array.isArray(newItemsRaw) || newItemsRaw.length > 500) throw new Error('Los productos de la corrección no son válidos')
  if (newItemsRaw.length === 0) throw new Error('La factura no puede quedar sin productos: para cancelarla usa Anular')
  const newItems: CartItem[] = (newItemsRaw as Array<Partial<CartItem>>).map((i) => {
    const qty = roundQty(num(i?.qty))
    const price = num(i?.price)
    const code = text(i?.code, 60)
    if (!code || !(qty > 0) || qty > 1_000_000 || !(price >= 0)) throw new Error('Los productos de la corrección no son válidos')
    // What a line had taken off stays on it (cut to what it is worth now); the sale's own discount is not recalculated.
    const off = cleanLineDiscount(i?.discount, price * qty, text(i.name, 120) || code, false)
    // `isFree` is never taken from the browser: whether a line has a product behind it follows from its code.
    return { code, name: text(i.name, 120), price, cost: 0, qty, ...(off > 0 ? { discount: off } : {}), brand: text(i.brand, 60), unit: text(i.unit, 20) || 'unidad', isFree: false }
  })

  const had = new Map(s.items.filter(isTracked).map((i) => [i.code, i]))
  const products = await getRowsByKey<Product>(sql, 'products', 'code', [...s.items, ...newItems].filter(isTracked).map((i) => i.code))
  for (const l of newItems) {
    if (!isTracked(l)) {
      // Only a free-form line the sale already had (same code and name) may stay.
      if (!s.items.some((o) => !isTracked(o) && o.code === l.code && o.name === l.name)) throw new Error(`"${l.name || l.code}" no es un producto del inventario: búscalo y elígelo de la lista`)
      l.isFree = true
      continue
    }
    const onInvoice = had.get(l.code)
    const p = products.get(l.code)
    if (!p && !onInvoice) throw new Error(`"${l.name || l.code}" ya no existe en el inventario`)
    // A line the invoice already had keeps its name; a product added now takes the inventory's.
    l.name = onInvoice?.name ?? p!.name
    l.brand = onInvoice?.brand ?? p!.brand ?? ''
    l.unit = onInvoice?.unit ?? p!.unit ?? 'unidad'
  }

  const stocks: Array<{ code: string; stock: number }> = []
  for (const e of stockEffect(s.items, newItems)) {
    const p = products.get(e.code)
    if (!p) continue // its product was deleted: nothing to put back, and the line may stay as it was
    const left = roundQty((p.stock || 0) + e.delta)
    // Same rule as a sale: no selling what isn't there. What the invoice already took counts as available.
    if (left < 0) throw new Error(`Stock insuficiente de "${p.name}" (quedan ${roundQty((p.stock || 0) + s.items.filter((i) => isTracked(i) && i.code === e.code).reduce((a, i) => a + i.qty, 0))})`)
    stocks.push({ code: e.code, stock: left })
  }

  const before: SaleSnapshot = { items: s.items, subtotal: s.subtotal, total: s.total, discount: s.discount || 0 }
  const newSub = newItems.reduce((sum, i) => sum + i.price * i.qty, 0)
  const newDisc = s.discount || 0
  // The rounding the cashier gave at checkout stays: dropping it would change the total (and the caja)
  // by that amount even when nothing about the items changed.
  const newTotal = Math.max(0, newSub - newDisc + (s.roundingAdjustment ?? 0))
  // What a customer already paid towards a fiado can't be more than the invoice now says (annul it to give it all back).
  const paid = (s.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  if (s.payMethod === 'fiado' && newTotal + EPS < paid) throw new Error(`Esa factura fiada ya tiene abonos por ${formatMoney(paid)}: el nuevo total no puede ser menor (si hace falta, anúlala)`)

  // What the goods cost is what they cost WHEN THEY WERE SOLD (kept in the sale's profit row): a product whose price
  // from the supplier has changed since must not rewrite the profit of an old invoice. Only a product that was not on
  // the invoice takes today's cost.
  const [profitRow] = await sql.query<{ g: number | null; c: unknown }>(`select (data ->> 'ganancia')::float8 as g, data -> 'itemCosts' as c from profits where key = $1`, [`sale:${saleId}`])
  const costThen = new Map<string, number>()
  const storedCosts = Array.isArray(profitRow?.c) ? (profitRow.c as unknown[]) : []
  s.items.forEach((i, k) => {
    const c = Number(storedCosts[k])
    if (isTracked(i) && storedCosts[k] !== null && Number.isFinite(c) && !costThen.has(i.code)) costThen.set(i.code, c)
  })
  const costsNow = await costsOf(sql, newItems.filter((i) => isTracked(i) && !costThen.has(i.code)).map((i) => i.code))
  const items = newItems.map((ci) => ({ ...ci, cost: isTracked(ci) ? (costThen.get(ci.code) ?? costsNow.get(ci.code) ?? 0) : 0 }))
  // Nothing changed in the lines: the profit stays exactly as it was stored.
  const unchanged = newItems.length === s.items.length && newItems.every((n, k) => n.code === s.items[k].code && n.qty === s.items[k].qty && n.price === s.items[k].price)
  const newGanancia = unchanged && profitRow?.g != null ? profitRow.g : round2(newTotal - items.reduce((c, ci) => c + ci.cost * ci.qty, 0))

  const after: SaleSnapshot = { items: newItems, subtotal: newSub, total: newTotal, discount: newDisc }
  const auditEntry: Omit<CorrectionAuditEntry, 'id'> = {
    type: 'correccion_venta',
    date: new Date().toISOString(),
    saleId,
    reason,
    before,
    after,
    totalDiff: newTotal - before.total,
    user: by,
  }
  await insertAutoRow(sql, 'auditLog', auditEntry)
  await setStocks(sql, stocks)

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
  await refreshSharedReceipt(sql, saleId)
  // What goes back to the browser is the row as stored — without the profit or the costs.
  return (await getRow<Sale>(sql, TABLE, 'id', saleId))!
}

/** Annuls an invoice as a whole. Everything it did is undone and nothing is deleted: the units go back to the
 * inventory, the money it collected goes back out of the caja it came into (and what a customer had paid towards a
 * fiado is given back), and the row stays — marked, with who, when and why — so it can still be looked up. Reports,
 * fiados and customer figures leave it out. Annulling twice is harmless (the second asks nothing and changes nothing). */
export async function voidSale(sql: Sql, actor: Actor, saleId: number, reasonRaw: unknown): Promise<Sale> {
  const by = await requireNeed(sql, actor, 'facturas.corregir')
  const s = await getRow<Sale>(sql, TABLE, 'id', saleId)
  if (!s) throw new Error('Venta no encontrada')
  if (s.voided) return s
  const reason = text(reasonRaw, 300)
  if (!reason) throw new Error('Escribe el motivo de la anulación')

  const effect = stockEffect(s.items, [])
  const products = await getRowsByKey<Product>(sql, 'products', 'code', effect.map((e) => e.code))
  // A product that was deleted since has no shelf to go back to.
  await setStocks(sql, effect.filter((e) => products.has(e.code)).map((e) => ({ code: e.code, stock: roundQty((products.get(e.code)!.stock || 0) + e.delta) })))

  const sold = { ...s, id: saleId }
  await recordSaleVoid(sql, sold)
  // What the customer had paid towards a fiado goes back out of the caja — and the account — each payment came into;
  // forgiven ones moved no money.
  const given = new Map<string, { method: CollectMethod; account?: TransferAccount; amount: number }>()
  for (const p of s.fiadoPagos || []) {
    if (p.condonado) continue
    const method: CollectMethod = p.method ?? 'efectivo'
    const key = `${method}|${p.account ?? ''}`
    const g = given.get(key) ?? { method, account: p.account, amount: 0 }
    g.amount += p.amount
    given.set(key, g)
  }
  for (const g of given.values()) await recordFiadoRefund(sql, sold, g.amount, g.method, g.account)

  const now = new Date().toISOString()
  const auditEntry: Omit<VoidAuditEntry, 'id'> = {
    type: 'anulacion_venta',
    date: now,
    saleId,
    reason,
    before: { items: s.items, subtotal: s.subtotal, total: s.total, discount: s.discount || 0 },
    user: by,
  }
  await insertAutoRow(sql, 'auditLog', auditEntry)
  await putRow(sql, TABLE, 'id', saleId, { ...s, voided: true, voidedAt: now, voidedBy: by, voidReason: reason })
  await dropSharedReceipt(sql, saleId)
  return (await getRow<Sale>(sql, TABLE, 'id', saleId))!
}

/** The owner read what did not add up in a sale that came from a device without internet (its
 * `reviewNotes`) and marks it as reviewed — the notes stay, with who read them and when. */
export async function markReviewed(sql: Sql, actor: Actor, saleId: number): Promise<Sale> {
  await requireNeed(sql, actor, 'facturas.corregir')
  const s = await getRow<Sale>(sql, TABLE, 'id', saleId)
  if (!s) throw new HttpError(404, 'Venta no encontrada')
  if (!s.reviewNotes?.length || s.reviewedAt) return s
  const updated: Sale = { ...s, reviewedAt: new Date().toISOString(), reviewedBy: actor.operator.name }
  await putRow(sql, TABLE, 'id', saleId, updated)
  return updated
}

export function assertSaleId(raw: unknown): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Venta no encontrada')
  return id
}
