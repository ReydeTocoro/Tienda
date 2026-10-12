import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/index'
import type { FinalizeSaleInput } from '../db/repositories/sales'
import { dayKeyOf } from '../shared/lib/currency'
import { pendingRef } from '../shared/lib/id'
import { useSessionStore } from '../store/useSessionStore'
import type { OutboxSale } from '../types/outbox'
import type { Product } from '../types/product'
import type { Sale } from '../types/sale'

/** The sales made while the server could not be reached.
 *
 * A sale is a fact — the goods left and the customer paid — so when the internet is down it is kept on this
 * device (the `outbox` table of IndexedDB), shown everywhere as a provisional sale (a `sales` row with a NEGATIVE
 * id, `-seq`, printed "PEND-0003") and taken off the shelf at once (the stock overlay below), and sent to
 * `/api/sales/offline` by ./outboxSync as soon as the server answers again. The server saves it whatever it holds
 * and writes down what didn't add up; its answer, or the sale itself arriving through the sync, replaces the
 * provisional one.
 *
 * The overlay: a product's local `stock` is what the server said minus what pending sales already took, and the
 * server's own figure is kept in `serverStock` while anything is held back. Everything that changes the outbox
 * or writes a server product runs in one Dexie transaction over `outbox` and `products`, so the two never
 * disagree. */

export const roundQty = (n: number): number => Math.round(n * 10000) / 10000

type Seq = { seq: number }

/** The sale as the lists and the receipt show it until the server has it. */
export function provisionalSale(entry: OutboxSale & Seq): Sale {
  const p = entry.payload
  return {
    id: -entry.seq,
    items: p.items,
    subtotal: p.subtotal,
    discount: p.discount,
    total: p.total,
    roundingAdjustment: p.roundingAdjustment,
    amountReceived: p.amountReceived,
    changeGiven: p.changeGiven,
    payMethod: p.payMethod,
    transferAccount: p.transferAccount,
    customerId: p.customerId ?? undefined,
    customerName: p.customerName ?? undefined,
    fiadoName: p.fiadoName ?? undefined,
    date: p.soldAt,
    dayKey: dayKeyOf(p.soldAt),
    notes: p.notes,
    sellerId: p.seller?.id,
    sellerName: p.seller?.name,
    clientId: p.clientId,
    offline: true,
    refLocal: p.localRef,
    pendingSync: true,
  }
}

// ---- The stock overlay ------------------------------------------------------------------------------

/** How much of each product the sales waiting to be sent took (a rejected sale holds nothing back). */
async function heldQuantities(): Promise<Map<string, number>> {
  const held = new Map<string, number>()
  await db.outbox
    .where('status')
    .equals('pending')
    .each((e) => {
      for (const i of e.payload.items) if (!i.isFree) held.set(i.code, roundQty((held.get(i.code) ?? 0) + i.qty))
    })
  return held
}

/** Puts these products' stock right: the server's figure (`server`, else the one kept in `serverStock`, else the
 * stock as it is) minus what pending sales hold back. Always inside a transaction over `outbox` and `products`. */
export async function restock(codes: Iterable<string>, server?: Map<string, number>): Promise<void> {
  const held = await heldQuantities()
  for (const code of new Set(codes)) {
    const row = await db.products.get(code)
    if (!row) continue
    const base = server?.get(code) ?? row.serverStock ?? row.stock
    const h = held.get(code) ?? 0
    const next: Product = { ...row, stock: h > 0 ? Math.max(0, roundQty(base - h)) : base }
    if (h > 0) next.serverStock = base
    else delete next.serverStock
    await db.products.put(next)
  }
}

/** Products that come from the server, about to be written to this device: what pending sales took is taken off
 * their stock again. Inside the same transaction as the write (it must include `outbox`). */
export async function holdBack(rows: Product[]): Promise<Product[]> {
  if (!rows.length || !(await db.outbox.count())) return rows
  const held = await heldQuantities()
  if (!held.size) return rows
  return rows.map((r) => {
    const h = held.get(r.code)
    return h ? { ...r, serverStock: r.stock, stock: Math.max(0, roundQty(r.stock - h)) } : r
  })
}

// ---- Keeping a sale ---------------------------------------------------------------------------------

/** Saves a sale on this device, takes its products off the shelf and returns the provisional sale (what the
 * receipt shows). Saving the same `clientId` again returns the one already kept. */
export async function saveSaleOffline(input: FinalizeSaleInput & { clientId: string }): Promise<Sale> {
  const operator = useSessionStore.getState().operator
  const soldAt = new Date().toISOString()
  return db.transaction('rw', db.outbox, db.sales, db.products, async () => {
    const already = await db.outbox.where('clientId').equals(input.clientId).first()
    if (already?.seq !== undefined) return provisionalSale(already as OutboxSale & Seq)
    const entry: OutboxSale = {
      clientId: input.clientId,
      createdAt: soldAt,
      status: 'pending',
      attempts: 0,
      payload: {
        clientId: input.clientId,
        soldAt,
        seller: operator ? { id: operator.id, name: operator.name } : undefined,
        localRef: '',
        items: input.items,
        subtotal: input.subtotal,
        discount: input.discount,
        total: input.total,
        roundingAdjustment: input.roundingAdjustment,
        payMethod: input.payMethod,
        transferAccount: input.transferAccount ?? undefined,
        customerId: input.customerId,
        customerName: input.customerName,
        fiadoName: input.fiadoName,
        notes: input.notes,
        amountReceived: input.amountReceived,
        changeGiven: input.changeGiven,
      },
    }
    const seq = (await db.outbox.add(entry)) as number
    entry.seq = seq
    entry.payload.localRef = pendingRef(seq)
    await db.outbox.put(entry)
    const sale = provisionalSale(entry as OutboxSale & Seq)
    await db.sales.put(sale)
    await restock(entry.payload.items.map((i) => i.code))
    return sale
  })
}

// ---- When the server has the sale -------------------------------------------------------------------

export interface SentSale {
  /** The sale as the server saved it. */
  sale?: Sale
  /** What the stock of its products is now, on the server. */
  stocks?: Array<{ code: string; stock: number }>
}

/** The server has this sale: the provisional one and its outbox entry go, the real sale takes their place and the
 * stock is put right. False when it was no longer here (the sync already took care of it). */
export async function settleSale(clientId: string, sent?: SentSale): Promise<boolean> {
  return db.transaction('rw', db.outbox, db.sales, db.products, async () => {
    const entry = await db.outbox.where('clientId').equals(clientId).first()
    if (!entry || entry.seq === undefined) return false
    await db.outbox.delete(entry.seq)
    await db.sales.delete(-entry.seq)
    // The sync brings the sale by itself; this only avoids a gap when it is slower than the answer.
    if (sent?.sale?.id !== undefined && !(await db.sales.get(sent.sale.id))) await db.sales.put(sent.sale)
    await restock(
      entry.payload.items.map((i) => i.code),
      new Map(sent?.stocks?.map((s): [string, number] => [s.code, s.stock])),
    )
    return true
  })
}

/** The sync wrote these server sales to this device: the ones this device was still holding have reached the
 * server (it was its own sale, whose answer got lost), and a full download — which empties the table first —
 * must not take the sales that only exist here with it. */
export async function reconcileSales(serverSales: Sale[]): Promise<void> {
  if (!(await db.outbox.count())) return // the usual case: nothing was made without internet
  const sent = serverSales.map((s) => s.clientId).filter((c): c is string => !!c)
  const codes = new Set<string>()
  if (sent.length) {
    for (const e of await db.outbox.where('clientId').anyOf(sent).toArray()) {
      if (e.seq === undefined) continue
      await db.outbox.delete(e.seq)
      await db.sales.delete(-e.seq)
      for (const i of e.payload.items) codes.add(i.code)
    }
  }
  const left = (await db.outbox.toArray()).filter((e): e is OutboxSale & Seq => e.seq !== undefined)
  if (left.length) await db.sales.bulkPut(left.map(provisionalSale))
  if (codes.size) await restock(codes)
}

// ---- When the server does not take it ---------------------------------------------------------------

async function withEntry(clientId: string, change: (e: OutboxSale & Seq) => Promise<void>): Promise<void> {
  await db.transaction('rw', db.outbox, db.sales, db.products, async () => {
    const entry = await db.outbox.where('clientId').equals(clientId).first()
    if (entry?.seq !== undefined) await change(entry as OutboxSale & Seq)
  })
}

/** An attempt that did not work out (no internet, the server failing): the sale stays and will be tried again. */
export const noteAttempt = (clientId: string, error: string): Promise<void> =>
  withEntry(clientId, async (e) => {
    await db.outbox.update(e.seq, { attempts: e.attempts + 1, lastError: error, lastTriedAt: new Date().toISOString() })
  })

/** The server refused the sale itself (it can't be a sale): it stops being sent and no longer holds stock back —
 * a person decides what to do with it. */
export const rejectSale = (clientId: string, error: string): Promise<void> =>
  withEntry(clientId, async (e) => {
    await db.outbox.update(e.seq, { status: 'rejected', attempts: e.attempts + 1, lastError: error, lastTriedAt: new Date().toISOString() })
    await restock(e.payload.items.map((i) => i.code))
  })

/** Sends a rejected sale again. */
export const retrySale = (clientId: string): Promise<void> =>
  withEntry(clientId, async (e) => {
    await db.outbox.update(e.seq, { status: 'pending', attempts: 0, lastError: undefined })
    await restock(e.payload.items.map((i) => i.code))
  })

/** Throws the sale away: it never reaches the server, and its products go back on the shelf. */
export const discardSale = (clientId: string): Promise<void> =>
  withEntry(clientId, async (e) => {
    await db.outbox.delete(e.seq)
    await db.sales.delete(-e.seq)
    await restock(e.payload.items.map((i) => i.code))
  })

// ---- Reading it -------------------------------------------------------------------------------------

/** How many sales wait to be sent, and how many the server refused. */
export interface OutboxCounts {
  pending: number
  rejected: number
}
const NONE: OutboxCounts = { pending: 0, rejected: 0 }

export async function outboxCounts(): Promise<OutboxCounts> {
  const [pending, total] = await Promise.all([db.outbox.where('status').equals('pending').count(), db.outbox.count()])
  return { pending, rejected: total - pending }
}

export const useOutboxCounts = (): OutboxCounts => useLiveQuery(outboxCounts, [], NONE)

/** Every sale kept on this device, oldest first. */
export const useOutbox = (): OutboxSale[] => useLiveQuery(() => db.outbox.orderBy('seq').toArray(), [], [])
