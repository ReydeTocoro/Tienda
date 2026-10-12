import { randomBytes } from 'node:crypto'
import type { Sale } from '../../src/types/sale'
import type { Settings } from '../../src/types/settings'
import { receiptFromSale, type ReceiptData } from '../../src/shared/lib/receipt'
import type { Sql } from '../db'
import { HttpError } from '../routes/http'

/** How long a WhatsApp link keeps opening, counted from the last time the sale was shared. */
export const RECEIPT_LINK_DAYS = 30

/** What a receipt needs from the store's settings when the sale carries no name of its own. */
const DEFAULT_STORE_NAME = 'Mi Tienda Pro'

/** The receipt of a saved sale, built here from the rows — never from what a browser says it is. It is
 * the same data the printed receipt shows (`receiptFromSale`): no costs, no profit, no notes. */
export async function receiptOfSale(sql: Sql, saleId: number): Promise<ReceiptData> {
  const [row] = await sql.query<{ data: Sale }>(`select data from sales where id = $1`, [saleId])
  if (!row) throw new HttpError(404, 'Venta no encontrada')
  if (row.data.voided) throw new HttpError(409, 'Esa factura está anulada: no se puede compartir')
  const [settings] = await sql.query<{ data: Settings }>(`select data from settings where key = 'main'`)
  return receiptFromSale({ ...row.data, id: saleId }, settings?.data.storeName || DEFAULT_STORE_NAME, settings?.data.business)
}

/** Stores the sale's receipt as text under a random 128-bit code and returns the code: the link is
 * /recibo/<code>. One link per sale — sharing it again keeps the code, refreshes what it shows (a
 * corrected sale shows the correction) and pushes the expiry forward. Expired links are deleted on
 * the way, so the table never needs a cron. */
export async function shareReceipt(sql: Sql, saleId: number): Promise<{ id: string; expiresAt: string }> {
  const receipt = await receiptOfSale(sql, saleId)
  await sql.query(`delete from private.shared_receipts where expires_at < now()`)
  const [row] = await sql.query<{ id: string; expires_at: Date }>(
    `insert into private.shared_receipts (id, sale_id, data, expires_at)
     values ($1, $2, $3, now() + make_interval(days => $4))
     on conflict (sale_id) do update set data = excluded.data, expires_at = excluded.expires_at
     returning id, expires_at`,
    [randomBytes(16).toString('hex'), saleId, JSON.stringify(receipt), RECEIPT_LINK_DAYS],
  )
  return { id: row.id, expiresAt: new Date(row.expires_at).toISOString() }
}

/** A link that was already sent shows the sale as it was shared: after a correction it is refreshed (same code). */
export async function refreshSharedReceipt(sql: Sql, saleId: number): Promise<void> {
  const [link] = await sql.query(`select 1 from private.shared_receipts where sale_id = $1`, [saleId])
  if (link) await shareReceipt(sql, saleId)
}

/** An annulled sale's link is removed: its customer is told "not found" rather than shown a receipt for nothing. */
export async function dropSharedReceipt(sql: Sql, saleId: number): Promise<void> {
  await sql.query(`delete from private.shared_receipts where sale_id = $1`, [saleId])
}

/** What the public page behind a link reads. A code that doesn't exist is a 404 and one that expired
 * a 410, so the customer is told to ask the store for a new link instead of a bare "not found". */
export async function sharedReceipt(sql: Sql, id: string): Promise<{ receipt: ReceiptData; expiresAt: string }> {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new HttpError(404, 'No encontramos este recibo')
  const [row] = await sql.query<{ data: ReceiptData; expires_at: Date }>(`select data, expires_at from private.shared_receipts where id = $1`, [id])
  if (!row) throw new HttpError(404, 'No encontramos este recibo')
  const expiresAt = new Date(row.expires_at)
  if (expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'Este enlace del recibo venció. Pídele a la tienda que te lo envíe de nuevo.')
  return { receipt: row.data, expiresAt: expiresAt.toISOString() }
}
