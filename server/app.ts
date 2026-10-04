import express, { type RequestHandler } from 'express'
import type { Db } from './db'
import { auditLogRouter } from './routes/auditLog'
import { cashRouter } from './routes/cash'
import { cierresRouter } from './routes/cierres'
import { customersRouter } from './routes/customers'
import { entradasRouter } from './routes/entradas'
import { inventoryOpsRouter } from './routes/inventoryOps'
import { payablesRouter } from './routes/payables'
import { productsRouter } from './routes/products'
import { purchaseOrdersRouter } from './routes/purchaseOrders'
import { routeOrdersRouter } from './routes/routeOrders'
import { salesRouter } from './routes/sales'
import { settingsRouter } from './routes/settings'
import { suppliersRouter } from './routes/suppliers'
import { usuariosRouter } from './routes/usuarios'

/** The write API under /api — reads don't come through here: the app reads Supabase directly
 * (src/sync). Shared by the local dev server (server/index.ts) and the Firebase Function
 * (functions/index.js, via server/serverApp.ts). */
export function createApp(db: Db, auth: RequestHandler) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '5mb' }))

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

  app.use('/api', auth)
  app.use('/api/products', productsRouter(db))
  app.use('/api/customers', customersRouter(db))
  app.use('/api/sales', salesRouter(db))
  app.use('/api/cierres', cierresRouter(db))
  app.use('/api/auditLog', auditLogRouter(db))
  app.use('/api/entradas', entradasRouter(db))
  app.use('/api/settings', settingsRouter(db))
  app.use('/api/inventory', inventoryOpsRouter(db))
  app.use('/api/usuarios', usuariosRouter(db))
  app.use('/api/cash', cashRouter(db))
  app.use('/api/suppliers', suppliersRouter(db))
  app.use('/api/purchaseOrders', purchaseOrdersRouter(db))
  app.use('/api/payables', payablesRouter(db))
  app.use('/api/routeOrders', routeOrdersRouter(db))
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' })
  })
  return app
}
