import type { CartItem } from '../../src/types/cartItem'
import type { Customer } from '../../src/types/customer'
import type { Product } from '../../src/types/product'
import type { PayMethod, Sale } from '../../src/types/sale'
import { dayKeyOf, formatMoney, formatQty } from '../../src/shared/lib/currency'
import { round2 } from '../../src/shared/lib/cash'
import { samePrice, sellingPrices } from '../../src/shared/lib/prices'
import { isTransferAccount, type TransferAccount } from '../../src/shared/lib/transferAccounts'
import type { Sql } from '../db'
import { getRow, getRowsByKey, insertAutoRow, roundQty, setStocks, text } from '../routes/generic'
import { HttpError } from '../routes/http'
import { recordSaleReceipt } from './cash'
import { operatorById, type Actor } from './counter'
import { costsOf } from './secrets'
import { cleanClientId, cleanLineDiscount, FREE_CODE, num, saleByClientId } from './sales'

/** A sale made on a device that had no internet, sent when it came back (src/offline on the app side).
 *
 * It is NOT a request to sell: the goods already left the shop and the customer already paid. So, unlike
 * `finalizeSale`, which refuses what doesn't add up, this always saves the sale — and writes down, in
 * `reviewNotes`, whatever didn't add up (stock that wasn't there, a price that changed meanwhile, a
 * discount nobody could authorize without a connection…) for the owner to read and mark as reviewed.
 * Only a payload that can't be a sale at all (no products, a negative quantity) is refused. */

const PAY_METHODS: PayMethod[] = ['efectivo', 'transferencia', 'fiado']
/** Cents of float noise between the device's sums and ours. */
const EPS = 0.01
const DAY_MS = 86_400_000

export interface OfflineSaleResult {
  sale: Sale & { id: number }
  /** What the stock of each inventory product on the sale is now — the device corrects its own copy with it. */
  stocks: Array<{ code: string; stock: number }>
  /** The server already had this sale (sent before): nothing was saved again. */
  duplicate: boolean
}

async function currentStocks(sql: Sql, items: CartItem[]): Promise<Array<{ code: string; stock: number }>> {
  const products = await getRowsByKey<Product>(sql, 'products', 'code', items.map((i) => i.code))
  return [...products].map(([code, p]) => ({ code, stock: p.stock || 0 }))
}

export async function ingestOfflineSale(sql: Sql, actor: Actor, raw: unknown): Promise<OfflineSaleResult> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const clientId = cleanClientId(input.clientId)
  if (!clientId) throw new HttpError(400, 'Falta el identificador de la venta')
  // Sent before — a reply that got lost, two tabs sending the same queue: it is one sale.
  const already = await saleByClientId(sql, clientId)
  if (already) return { sale: already, stocks: await currentStocks(sql, already.items), duplicate: true }

  const payMethod = input.payMethod as PayMethod
  if (!PAY_METHODS.includes(payMethod)) throw new HttpError(400, 'La venta no tiene forma de pago')
  const rawItems = input.items
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 500) throw new HttpError(400, 'La venta no tiene productos válidos')

  const notes: string[] = []

  // ── What was sold. The device's lines are kept as they were charged; what they meant is checked. ──
  const lineOf = (r: Partial<CartItem> | null | undefined) => ({ code: text(r?.code, 60), qty: roundQty(num(r?.qty)), price: num(r?.price) })
  const products = await getRowsByKey<Product>(sql, 'products', 'code', rawItems.map((r) => lineOf(r).code).filter(Boolean))
  const lines: CartItem[] = []
  for (const r of rawItems as Array<Partial<CartItem>>) {
    const { code, qty, price } = lineOf(r)
    if (!code || !(qty > 0) || qty > 1_000_000 || !(price >= 0) || price > 1e9) throw new HttpError(400, 'La venta tiene una línea inválida')
    // A product sin registrar typed at the till: kept as it was charged, with no stock behind it.
    const free = FREE_CODE.test(code)
    const p = free ? undefined : products.get(code)
    const name = text(r?.name, 120) || p?.name || code
    if (!p && !free) notes.push(`"${name}" ya no existe en el inventario: la venta se guardó, pero no hay stock que descontar`)
    else if (p && !sellingPrices(p).some((x) => samePrice(x, price))) notes.push(`"${name}" se vendió a ${formatMoney(price)}, que no es ninguno de sus precios de hoy (Precio 1: ${formatMoney(p.price)})`)
    // A discount typed on the line is kept (cut to what the line is worth): a sale made without internet is never refused.
    const off = (() => {
      try {
        return cleanLineDiscount(r?.discount, price * qty, name, false)
      } catch {
        return 0
      }
    })()
    lines.push({ code, name, price, cost: 0, qty, ...(off > 0 ? { discount: off } : {}), brand: free ? '' : text(r?.brand, 60) || p?.brand || '', unit: free ? 'unidad' : text(r?.unit, 20) || p?.unit || 'unidad', isFree: free })
  }

  // ── When. The device's clock decides, unless it is plainly wrong. ──
  const now = Date.now()
  let soldMs = Date.parse(typeof input.soldAt === 'string' ? input.soldAt : '')
  if (!Number.isFinite(soldMs)) {
    soldMs = now
    notes.push('La venta llegó sin fecha válida: se le puso la de su llegada')
  } else if (soldMs > now + 10 * 60_000) {
    soldMs = now
    notes.push('La fecha de la venta estaba en el futuro (el reloj del equipo estaba adelantado): se le puso la de su llegada')
  } else if (soldMs < now - 90 * DAY_MS) notes.push('La venta se hizo hace más de 90 días y recién llega')
  const date = new Date(soldMs).toISOString()
  // Another device may have closed that day while this one was cut off: the sale is booked anyway, but no cierre
  // will ever include it (a Cierre Z only gathers what is still open on its day).
  if ((await sql.query(`select 1 from cierres where data ->> 'fecha' = $1 limit 1`, [dayKeyOf(date)])).length) {
    notes.push(`La venta es del ${dayKeyOf(date)}, un día cuya caja ya se cerró: no entró en ese cierre`)
  }

  // ── Who. Whoever made it, if they still exist — and what they were allowed to do is what counts, but never more than
  //    whoever sends it may do: the claim is only a name on the sale, or a cashier could send a sale "made by the owner". ──
  let seller = actor.operator
  let needs = actor.needs
  const claimed = text((input.seller as { id?: unknown } | undefined)?.id, 80)
  if (claimed && claimed !== actor.operator.id) {
    const found = await operatorById(sql, claimed)
    if (found) {
      seller = found.operator
      needs = new Set([...found.needs].filter((n) => actor.needs.has(n)))
    } else notes.push('Quien hizo la venta ya no existe o está desactivado: quedó a nombre de quien la envió')
  }

  // ── The customer, as the server knows them now. ──
  let customer: Customer | undefined
  const customerId = text(input.customerId, 80)
  if (customerId) {
    customer = await getRow<Customer>(sql, 'customers', 'id', customerId)
    if (!customer) notes.push('El cliente de la venta ya no existe: quedó sin cliente')
  }
  const customerName = customer?.name ?? (text(input.customerName, 80) || undefined)

  // ── The numbers. The total is what the customer paid; the rest is rebuilt from the lines. ──
  const subtotal = lines.reduce((a, i) => a + i.price * i.qty, 0)
  const claimedSubtotal = num(input.subtotal)
  if (!(Math.abs(claimedSubtotal - subtotal) <= EPS)) notes.push(`El subtotal que mandó el equipo (${formatMoney(claimedSubtotal)}) no coincidía con sus productos (${formatMoney(subtotal)}): se usó el de los productos`)
  let discount = num(input.discount)
  if (!(discount >= 0)) discount = 0
  if (discount > subtotal + EPS) {
    discount = subtotal
    notes.push('El descuento era mayor que la venta: quedó igual a la venta')
  }
  if (lines.reduce((a, l) => a + (l.discount ?? 0), 0) > discount + EPS) notes.push('Los descuentos de los productos sumaban más que el descuento de la venta')
  const base = subtotal - discount
  let total = num(input.total)
  if (!(total >= 0) || total > 1e10) {
    total = base
    notes.push('La venta llegó sin un total válido: se usó el de sus productos')
  }
  const adjusted = Math.abs(total - base) > 0.005

  // ── What nobody could authorize without a connection: the sale stands, the owner is told. ──
  if (discount > EPS && !needs.has('ventas.descuentos')) notes.push(`Descuento de ${formatMoney(discount)} sin autorización de alguien con permiso`)
  if (adjusted && !needs.has('ventas.cambiarTotal')) notes.push(`Total cambiado a ${formatMoney(total)} (los productos suman ${formatMoney(base)}) sin autorización de alguien con permiso`)
  if (lines.some((l) => l.isFree) && !needs.has('ventas.productoLibre')) notes.push('Producto sin registrar vendido sin autorización de alguien con permiso')
  const fiadoName = payMethod === 'fiado' ? text(input.fiadoName, 80) || customerName || '' : ''
  if (payMethod === 'fiado') {
    if (!fiadoName) notes.push('Venta fiada sin el nombre de quien la debe')
    if (!needs.has('ventas.fiar')) notes.push('Venta fiada sin autorización de alguien con permiso')
  }

  let amountReceived: number | undefined
  if (payMethod === 'efectivo') {
    const received = num(input.amountReceived)
    if (received > 0 && received + 0.005 >= total) amountReceived = received
  }

  // A transfer that doesn't say which account it came into is kept all the same, and the owner is told.
  let transferAccount: TransferAccount | undefined
  if (payMethod === 'transferencia') {
    if (isTransferAccount(input.transferAccount)) transferAccount = input.transferAccount
    else notes.push('Transferencia sin la cuenta a la que llegó')
  }

  // ── Stock: it goes down by what was sold, never below zero; a shortfall is written down. ──
  const wanted = new Map<string, number>()
  for (const l of lines) if (!l.isFree && products.has(l.code)) wanted.set(l.code, roundQty((wanted.get(l.code) ?? 0) + l.qty))
  const stocks: Array<{ code: string; stock: number }> = []
  for (const [code, qty] of wanted) {
    const p = products.get(code)!
    const had = p.stock || 0
    if (qty > had + 1e-9) notes.push(`Stock insuficiente de "${p.name}": se vendieron ${formatQty(qty)} y había ${formatQty(had)} (el stock quedó en 0)`)
    stocks.push({ code, stock: roundQty(Math.max(0, had - qty)) })
  }

  // ── Profit from the purchase prices, which the device never sees. ──
  const costs = await costsOf(sql, [...wanted.keys()])
  const items = lines.map((l) => ({ ...l, cost: wanted.has(l.code) ? (costs.get(l.code) ?? 0) : 0 }))
  // What was charged minus what the goods cost: a discount (or the rounding of a cash charge) comes off the profit.
  const ganancia = round2(total - items.reduce((c, i) => c + i.cost * i.qty, 0))

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
    customerId: customer?.id,
    customerName,
    fiadoName: fiadoName || undefined,
    date,
    dayKey: dayKeyOf(date),
    notes: text(input.notes, 300) || undefined,
    sellerId: seller.id,
    sellerName: seller.name,
    clientId,
    offline: true,
    syncedAt: new Date(now).toISOString(),
    ...(seller.id !== actor.operator.id ? { syncedBy: actor.operator.name } : {}),
    refLocal: text(input.localRef, 30) || undefined,
    reviewNotes: notes.length ? notes.slice(0, 20).map((n) => n.slice(0, 300)) : undefined,
  }
  // The table's trigger moves `ganancia` and the item costs out of the row everyone reads.
  const sale = await insertAutoRow(sql, 'sales', saleData)
  await recordSaleReceipt(sql, sale)
  await setStocks(sql, stocks)
  return { sale, stocks, duplicate: false }
}
