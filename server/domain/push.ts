import type { CajaState } from '../../src/types/secrets'
import type { Payable, PurchaseOrder } from '../../src/types/purchaseOrder'
import type { Product } from '../../src/types/product'
import type { Settings } from '../../src/types/settings'
import { buildNotices, pushMessage } from '../../src/features/notifications/lib/notices'
import { todayKey } from '../../src/shared/lib/currency'
import { ADMIN_ROLE_ID } from '../../src/shared/lib/permissions'
import type { Db, Sql } from '../db'
import { HttpError } from '../routes/http'
import { accountOperator } from './counter'

/** The phone notifications of the Administrador ("Pendientes de hoy" at fixed hours, sent by the Function through
 * Firebase Cloud Messaging — functions/index.js). The tokens live in private.push_tokens (migration 20261014000000). */

export interface PushMessage {
  title: string
  body: string
}

/** Sends one message to these devices; answers the tokens that no longer exist (the app was uninstalled, the browser
 * dropped its subscription), which are then forgotten. */
export type PushSend = (tokens: string[], message: PushMessage) => Promise<string[]>

/** An FCM token: letters, digits, `:`, `_`, `-`. */
const TOKEN = /^[\w:-]{20,4096}$/

export function checkPushToken(token: unknown): string {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new HttpError(400, 'Este equipo no dio un código de avisos válido')
  return token
}

/** This device gets the notices of the person signed in on it (who must be an Administrador — the route checks it). */
export async function savePushToken(q: Sql, email: string, token: string): Promise<void> {
  await q.query(
    `insert into private.push_tokens (token, email) values ($1, $2)
     on conflict (token) do update set email = excluded.email, updated_at = now()`,
    [token, email.toLowerCase()],
  )
}

export async function dropPushToken(q: Sql, token: string): Promise<void> {
  await q.query(`delete from private.push_tokens where token = $1`, [token])
}

/** What the notification says now — the Administrador sees everything — or null when nothing asks for action. One
 * query. Sales made without internet live on each device, and the fiados are left to the app (blue unless very old). */
export async function pendingPush(q: Sql, today = todayKey()): Promise<PushMessage | null> {
  const [r] = await q.query<{ payables: Payable[]; orders: PurchaseOrder[]; products: Product[]; caja: CajaState | null; settings: Settings | null }>(
    `select (select coalesce(jsonb_agg(data), '[]') from public.payables) as payables,
            (select coalesce(jsonb_agg(data), '[]') from public."purchaseOrders" where data ->> 'status' = 'pedido') as orders,
            (select coalesce(jsonb_agg(data), '[]') from public.products
              where coalesce((data ->> 'stock')::numeric, 0) <= greatest(coalesce((data ->> 'min')::numeric, 0), 0)) as products,
            (select data from public."cajaState" where key = 'menor') as caja,
            (select data from public.settings where key = 'main') as settings`,
  )
  const notices = buildNotices({
    today,
    payables: r.payables,
    orders: r.orders,
    products: r.products,
    caja: r.caja,
    outbox: { pending: 0, rejected: 0 },
    servicePayment: { paid: r.settings?.servicePaid },
  })
  return pushMessage(notices)
}

/** The scheduled send: to the devices of whoever is an active Administrador now (anyone else's token is forgotten —
 * a person who lost the role stops getting the store's figures), if anything asks for action. The message to Firebase
 * goes out after the transaction, never holding the app-wide lock. */
export async function sendPendingPush(db: Db, send: PushSend, today = todayKey()): Promise<{ sent: number; removed: number }> {
  const { tokens, stale, message } = await db.tx(async (q) => {
    const rows = await q.query<{ token: string; email: string }>(`select token, email from private.push_tokens`)
    const admins = new Set<string>()
    for (const email of new Set(rows.map((r) => r.email))) if ((await accountOperator(q, email))?.roleId === ADMIN_ROLE_ID) admins.add(email)
    const stale = rows.filter((r) => !admins.has(r.email)).map((r) => r.token)
    if (stale.length) await q.query(`delete from private.push_tokens where token = any($1)`, [stale])
    const tokens = rows.filter((r) => admins.has(r.email)).map((r) => r.token)
    return { tokens, stale, message: tokens.length ? await pendingPush(q, today) : null }
  })
  if (!tokens.length || !message) return { sent: 0, removed: stale.length }
  const gone = await send(tokens, message)
  if (gone.length) await db.tx((q) => q.query(`delete from private.push_tokens where token = any($1)`, [gone]))
  return { sent: tokens.length - gone.length, removed: stale.length + gone.length }
}
