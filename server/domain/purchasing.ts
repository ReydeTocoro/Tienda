import { randomUUID } from 'node:crypto'
import type { Product } from '../../src/types/product'
import type { EntradaRecord } from '../../src/types/entrada'
import type { CajaId } from '../../src/types/cash'
import type { PaymentTerms, Supplier } from '../../src/types/supplier'
import type { OrderLine, OrderPayment, Payable, PurchaseOrder } from '../../src/types/purchaseOrder'
import { dueDateFrom, payableBalance, round2 } from '../../src/shared/lib/cash'
import { formatMoney } from '../../src/shared/lib/currency'
import { formatOrderId } from '../../src/shared/lib/id'
import type { Sql } from '../db'
import { deleteRow, getRow, insertAutoRow, listAll, putRow, roundQty } from '../routes/generic'
import { insertMovement, isCaja, requireFunds } from './cash'

/** Suppliers, purchase orders and accounts payable. Same contract as `./cash`: runs inside the
 * caller's transaction. Stock only ever changes in `receiveOrder`, in the same transaction that
 * books the payment or the debt — so "received" can never exist without its money trail. */

const SUPPLIERS = 'suppliers'
const ORDERS = 'purchaseOrders'
const PAYABLES = 'payables'

function cleanText(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || undefined
}

// ---------------------------------------------------------------- suppliers

export interface SupplierInput {
  name: string
  nit?: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  paymentTerms: PaymentTerms
  active?: boolean
}

function normalizeTerms(t: unknown): PaymentTerms {
  const terms = t as { kind?: string; days?: unknown } | undefined
  if (terms?.kind === 'contado') return { kind: 'contado' }
  if (terms?.kind === 'credito') {
    const days = Number(terms.days)
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Los días de crédito deben ser un número entero entre 1 y 365')
    return { kind: 'credito', days }
  }
  throw new Error('Elige si el pago es de contado o a crédito')
}

async function nameTaken(sql: Sql, name: string, exceptId?: string): Promise<boolean> {
  const lower = name.toLowerCase()
  return (await listAll<Supplier>(sql, SUPPLIERS)).some((s) => s.id !== exceptId && s.name.toLowerCase() === lower)
}

export async function createSupplier(sql: Sql, input: SupplierInput): Promise<Supplier> {
  const name = cleanText(input.name)
  if (!name) throw new Error('Escribe el nombre del proveedor')
  if (await nameTaken(sql, name)) throw new Error('Ya existe un proveedor con ese nombre')
  const supplier: Supplier = {
    id: randomUUID(),
    name,
    nit: cleanText(input.nit),
    contact: cleanText(input.contact),
    phone: cleanText(input.phone),
    email: cleanText(input.email),
    address: cleanText(input.address),
    notes: cleanText(input.notes),
    paymentTerms: normalizeTerms(input.paymentTerms),
    active: true,
    createdAt: new Date().toISOString(),
  }
  await putRow(sql, SUPPLIERS, 'id', supplier.id, supplier)
  return supplier
}

export async function updateSupplier(sql: Sql, id: string, input: SupplierInput): Promise<Supplier> {
  const current = await getRow<Supplier>(sql, SUPPLIERS, 'id', id)
  if (!current) throw new Error('Proveedor no encontrado')
  const name = cleanText(input.name)
  if (!name) throw new Error('Escribe el nombre del proveedor')
  if (await nameTaken(sql, name, id)) throw new Error('Ya existe un proveedor con ese nombre')
  const updated: Supplier = {
    ...current,
    name,
    nit: cleanText(input.nit),
    contact: cleanText(input.contact),
    phone: cleanText(input.phone),
    email: cleanText(input.email),
    address: cleanText(input.address),
    notes: cleanText(input.notes),
    paymentTerms: normalizeTerms(input.paymentTerms),
    active: input.active ?? current.active,
  }
  await putRow(sql, SUPPLIERS, 'id', id, updated)
  return updated
}

export async function deleteSupplier(sql: Sql, id: string): Promise<void> {
  if (!(await getRow<Supplier>(sql, SUPPLIERS, 'id', id))) throw new Error('Proveedor no encontrado')
  const used = await sql.query(`select 1 from "${ORDERS}" where data ->> 'supplierId' = $1 limit 1`, [id])
  if (used.length) throw new Error('Este proveedor tiene pedidos registrados: desactívalo en vez de eliminarlo')
  await deleteRow(sql, SUPPLIERS, 'id', id)
}

// ------------------------------------------------------------------- orders

export interface OrderLineInput {
  code: string
  qty: number
  unitCost: number
}

export interface OrderInput {
  supplierId: string
  lines: OrderLineInput[]
  notes?: string
  /** true = create already sent to the supplier ("pedido"); false = keep as a draft. */
  send?: boolean
}

async function buildLines(sql: Sql, lines: OrderLineInput[]): Promise<OrderLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Agrega al menos un producto al pedido')
  const seen = new Set<string>()
  const out: OrderLine[] = []
  for (const l of lines) {
    const p = await getRow<Product>(sql, 'products', 'code', l.code)
    if (!p) throw new Error(`El producto ${l.code} no existe en el inventario`)
    if (seen.has(p.code)) throw new Error(`"${p.name}" está repetido en el pedido`)
    seen.add(p.code)
    const qty = roundQty(Number(l.qty))
    const unitCost = round2(Number(l.unitCost))
    if (!(qty > 0)) throw new Error(`Indica la cantidad de "${p.name}"`)
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`El costo de "${p.name}" no es válido`)
    out.push({ code: p.code, name: p.name, qty, unitCost })
  }
  return out
}

const orderTotal = (lines: OrderLine[]) => round2(lines.reduce((t, l) => t + l.qty * l.unitCost, 0))

async function activeSupplier(sql: Sql, id: string): Promise<Supplier> {
  const s = await getRow<Supplier>(sql, SUPPLIERS, 'id', id)
  if (!s) throw new Error('Elige un proveedor')
  if (!s.active) throw new Error(`El proveedor "${s.name}" está inactivo`)
  return s
}

async function getOrder(sql: Sql, id: number): Promise<PurchaseOrder & { id: number }> {
  const o = await getRow<PurchaseOrder & { id: number }>(sql, ORDERS, 'id', id)
  if (!o) throw new Error('Pedido no encontrado')
  return o
}

async function saveOrder(sql: Sql, o: PurchaseOrder & { id: number }): Promise<PurchaseOrder> {
  await putRow(sql, ORDERS, 'id', o.id, o)
  return o
}

export async function createOrder(sql: Sql, input: OrderInput): Promise<PurchaseOrder> {
  const supplier = await activeSupplier(sql, input.supplierId)
  const lines = await buildLines(sql, input.lines)
  const now = new Date().toISOString()
  const base: Omit<PurchaseOrder, 'id'> = {
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: input.send ? 'pedido' : 'borrador',
    lines,
    total: orderTotal(lines),
    paymentTerms: supplier.paymentTerms,
    notes: cleanText(input.notes),
    createdAt: now,
    orderedAt: input.send ? now : undefined,
  }
  return insertAutoRow(sql, ORDERS, base)
}

/** Drafts can be edited freely; once sent, an order is only received or cancelled. */
export async function updateOrder(sql: Sql, id: number, input: OrderInput): Promise<PurchaseOrder> {
  const o = await getOrder(sql, id)
  if (o.status !== 'borrador') throw new Error('Solo se pueden editar los pedidos en borrador')
  const supplier = await activeSupplier(sql, input.supplierId)
  const lines = await buildLines(sql, input.lines)
  const now = new Date().toISOString()
  return saveOrder(sql, {
    ...o,
    supplierId: supplier.id,
    supplierName: supplier.name,
    lines,
    total: orderTotal(lines),
    paymentTerms: supplier.paymentTerms,
    notes: cleanText(input.notes),
    status: input.send ? 'pedido' : 'borrador',
    orderedAt: input.send ? now : undefined,
  })
}

export async function sendOrder(sql: Sql, id: number): Promise<PurchaseOrder> {
  const o = await getOrder(sql, id)
  if (o.status !== 'borrador') throw new Error('Solo se puede enviar un pedido en borrador')
  await activeSupplier(sql, o.supplierId)
  return saveOrder(sql, { ...o, status: 'pedido', orderedAt: new Date().toISOString() })
}

export async function cancelOrder(sql: Sql, id: number): Promise<PurchaseOrder> {
  const o = await getOrder(sql, id)
  if (o.status !== 'borrador' && o.status !== 'pedido') throw new Error(o.status === 'recibido' ? 'Un pedido recibido no se puede cancelar' : 'El pedido ya está cancelado')
  return saveOrder(sql, { ...o, status: 'cancelado', cancelledAt: new Date().toISOString() })
}

export interface ReceiveInput {
  /** What actually arrived and at what unit cost; lines left out are taken as ordered. */
  lines?: Array<{ code: string; qtyReceived: number; unitCost: number }>
  payment: { mode: 'contado'; caja: CajaId } | { mode: 'credito' }
  by?: string
}

/** `revealBalance`: whether a "not enough money" refusal may say how much the caja holds. */
export interface PayOptions {
  revealBalance?: boolean
}

/** The only place stock grows from a purchase. One transaction: stock + entrada records + the
 * payment (cash out of the chosen caja) or the account payable — if any step fails, nothing
 * happens, and a second attempt on the same order is rejected. */
export async function receiveOrder(sql: Sql, id: number, input: ReceiveInput, opts: PayOptions = {}): Promise<PurchaseOrder> {
  const o = await getOrder(sql, id)
  if (o.status !== 'pedido') throw new Error(o.status === 'recibido' ? 'Este pedido ya fue recibido' : 'Solo se puede recibir un pedido que ya fue enviado')

  const overrides = new Map((input.lines ?? []).map((l) => [l.code, l]))
  for (const code of overrides.keys()) {
    if (!o.lines.some((l) => l.code === code)) throw new Error(`El producto ${code} no es parte de este pedido`)
  }
  const lines: OrderLine[] = o.lines.map((l) => {
    const r = overrides.get(l.code)
    const qtyReceived = r ? roundQty(Number(r.qtyReceived)) : l.qty
    const unitCost = r ? round2(Number(r.unitCost)) : l.unitCost
    if (!Number.isFinite(qtyReceived) || qtyReceived < 0) throw new Error(`La cantidad recibida de "${l.name}" no es válida`)
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`El costo de "${l.name}" no es válido`)
    return { ...l, qtyReceived, unitCost }
  })
  if (!lines.some((l) => (l.qtyReceived ?? 0) > 0)) throw new Error('No hay nada que recibir (todas las cantidades están en 0). Si no llegó, cancela el pedido.')
  const receivedTotal = round2(lines.reduce((t, l) => t + (l.qtyReceived ?? 0) * l.unitCost, 0))

  const source = `Pedido ${formatOrderId(id)}`
  for (const l of lines) {
    const qty = l.qtyReceived ?? 0
    if (qty <= 0) continue
    const p = await getRow<Product>(sql, 'products', 'code', l.code)
    if (!p) throw new Error(`El producto "${l.name}" ya no existe en el inventario`)
    const stockAntes = p.stock || 0
    const stockDespues = roundQty(stockAntes + qty)
    // A new purchase price replaces the old one (the products table's trigger files it in "productCosts").
    const updated: Product = l.unitCost > 0 ? { ...p, stock: stockDespues, cost: l.unitCost } : { ...p, stock: stockDespues }
    await putRow(sql, 'products', 'code', p.code, updated)
    const record: Omit<EntradaRecord, 'id'> = { code: p.code, name: p.name, qty, stockAntes, stockDespues, date: new Date().toISOString(), source }
    await insertAutoRow(sql, 'entradas', record)
  }

  let payment: OrderPayment = { mode: 'ninguno' }
  const by = input.by?.trim() || undefined
  if (receivedTotal > 0) {
    const pay = input.payment as { mode?: string; caja?: unknown } | undefined
    if (pay?.mode === 'contado') {
      if (!isCaja(pay.caja)) throw new Error('Elige de qué caja sale el dinero')
      await requireFunds(sql, pay.caja, receivedTotal, opts.revealBalance)
      const mv = await insertMovement(sql, {
        caja: pay.caja,
        direction: 'out',
        type: 'pago_proveedor',
        amount: receivedTotal,
        concept: `${source} · ${o.supplierName}`,
        category: 'proveedores',
        refType: 'purchaseOrder',
        refId: id,
        by,
      })
      payment = { mode: 'contado', caja: pay.caja, movementId: mv.id }
    } else if (pay?.mode === 'credito') {
      if (o.paymentTerms.kind !== 'credito') throw new Error('Este proveedor es de contado: no se puede dejar a crédito')
      const now = new Date()
      const base: Omit<Payable, 'id'> = {
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        orderId: id,
        amount: receivedTotal,
        paid: 0,
        issuedAt: now.toISOString(),
        dueDate: dueDateFrom(now, o.paymentTerms.days),
        payments: [],
      }
      const payable = await insertAutoRow(sql, PAYABLES, base)
      payment = { mode: 'credito', payableId: payable.id }
    } else {
      throw new Error('Indica cómo se paga el pedido: de contado o a crédito')
    }
  }

  return saveOrder(sql, { ...o, status: 'recibido', lines, receivedTotal, receivedAt: new Date().toISOString(), receivedBy: by, payment })
}

// ----------------------------------------------------------------- payables

export interface PayInput {
  amount: number
  caja: CajaId
  by?: string
}

/** A (partial or full) payment of a supplier debt, taken out of a caja — usually the Mayor. */
export async function payPayable(sql: Sql, id: number, input: PayInput, opts: PayOptions = {}): Promise<Payable> {
  const p = await getRow<Payable & { id: number }>(sql, PAYABLES, 'id', id)
  if (!p) throw new Error('Cuenta por pagar no encontrada')
  const balance = payableBalance(p)
  if (balance <= 0) throw new Error('Esta cuenta ya está pagada')
  if (!isCaja(input.caja)) throw new Error('Elige de qué caja sale el dinero')
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('El monto del pago debe ser mayor a 0')
  if (amount > balance + 0.001) throw new Error(`El pago supera el saldo pendiente (${formatMoney(balance)})`)
  await requireFunds(sql, input.caja, amount, opts.revealBalance)
  const by = input.by?.trim() || undefined
  const mv = await insertMovement(sql, {
    caja: input.caja,
    direction: 'out',
    type: 'pago_proveedor',
    amount,
    concept: `Pago ${formatOrderId(p.orderId)} · ${p.supplierName}`,
    category: 'proveedores',
    refType: 'payable',
    refId: id,
    by,
  })
  const updated: Payable = { ...p, paid: round2(p.paid + amount), payments: [...p.payments, { date: new Date().toISOString(), amount, caja: input.caja, movementId: mv.id, by }] }
  await putRow(sql, PAYABLES, 'id', id, updated)
  return updated
}
