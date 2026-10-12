import express, { type RequestHandler } from 'express'
import { noAccounts, type Accounts } from './accounts'
import type { Db } from './db'
import { refreshCounterPerms } from './domain/counter'
import { noMailer, type Mailer } from './mailer'
import { cashRouter } from './routes/cash'
import { cierresRouter } from './routes/cierres'
import { counterRouter } from './routes/counter'
import { customersRouter } from './routes/customers'
import { entradasRouter } from './routes/entradas'
import { inventoryOpsRouter } from './routes/inventoryOps'
import { payablesRouter } from './routes/payables'
import { productsRouter } from './routes/products'
import { purchaseOrdersRouter } from './routes/purchaseOrders'
import { publicReceiptRouter, receiptsRouter } from './routes/receipts'
import { pushRouter } from './routes/push'
import type { PushSend } from './domain/push'
import { salesRouter } from './routes/sales'
import { settingsRouter } from './routes/settings'
import { suppliersRouter } from './routes/suppliers'
import { usuariosRouter } from './routes/usuarios'

/** The write API under /api — reads don't come through here: the app reads Supabase directly
 * (src/sync), where RLS only serves the secret tables to whoever may see them. Every route checks
 * the permission of whoever is signed in on the requesting device (server/domain/counter.ts).
 * `accounts` manages the sign-in accounts of the users (server/accounts.ts) and `mailer` sends the
 * store's e-mails (server/mailer.ts), `push` the Administrador's phone notifications (server/domain/push.ts; null
 * without Firebase). Shared by the local dev server (server/index.ts) and the
 * Firebase Function (functions/index.js, via server/serverApp.ts). */
export function createApp(db: Db, auth: RequestHandler, accounts: Accounts = noAccounts, mailer: Mailer = noMailer, push: PushSend | null = null) {
  const app = express()
  app.disable('x-powered-by')
  // Answers can carry purchase prices or who is signed in: never kept by a browser or a proxy cache.
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    next()
  })
  // The apps installed on the PC (.exe) and the phone (.apk) are pages served from the device itself, so they call
  // this API from another origin — and the browser asks permission first (a preflight OPTIONS, which carries no
  // Authorization and so must be answered before the sign-in check below). Every route authenticates with a bearer
  // token in a header, never with a cookie, so letting any origin call it gives a stranger's page nothing it
  // couldn't already do with curl.
  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400',
    })
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })
  app.use(express.json({ limit: '5mb' }))

  // The permissions RLS reads for each signed-in session follow the current roles (they're kept in
  // step on every change; this catches up a database that was just migrated).
  db.tx(refreshCounterPerms).catch((err) => console.error('No se pudieron preparar los permisos de las sesiones', err))

  // Open and cheap: the app pings it when it starts, so a cold Function (and its database
  // connection) is warm by the first sale. Answers 503 when the database can't be reached.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('select 1')
      res.json({ ok: true })
    } catch {
      res.status(503).json({ ok: false, error: 'Sin conexión con la base de datos' })
    }
  })

  // The one open route besides /health: the page behind a receipt's WhatsApp link, which a customer
  // opens without signing in. It answers only for the receipt whose 128-bit code is in the URL.
  app.use('/api/recibo', publicReceiptRouter(db))

  app.use('/api', auth)
  app.use('/api/counter', counterRouter(db, accounts))
  app.use('/api/products', productsRouter(db))
  app.use('/api/customers', customersRouter(db))
  app.use('/api/sales', salesRouter(db))
  app.use('/api/cierres', cierresRouter(db))
  app.use('/api/entradas', entradasRouter(db))
  app.use('/api/settings', settingsRouter(db))
  app.use('/api/inventory', inventoryOpsRouter(db))
  app.use('/api/usuarios', usuariosRouter(db, accounts))
  app.use('/api/cash', cashRouter(db))
  app.use('/api/suppliers', suppliersRouter(db))
  app.use('/api/purchaseOrders', purchaseOrdersRouter(db))
  app.use('/api/payables', payablesRouter(db))
  app.use('/api/recibos', receiptsRouter(db, mailer))
  app.use('/api/push', pushRouter(db, push))
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' })
  })
  return app
}
