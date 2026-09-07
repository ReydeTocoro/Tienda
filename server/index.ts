import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db'
import { addClient } from './broadcast'
import { productsRouter } from './routes/products'
import { customersRouter } from './routes/customers'
import { salesRouter } from './routes/sales'
import { purchasesRouter } from './routes/purchases'
import { extrasRouter } from './routes/extras'
import { cierresRouter } from './routes/cierres'
import { auditLogRouter } from './routes/auditLog'
import { entradasRouter } from './routes/entradas'
import { settingsRouter } from './routes/settings'
import { inventoryOpsRouter } from './routes/inventoryOps'

const app = express()
app.use(express.json())

app.use('/api/products', productsRouter(db))
app.use('/api/customers', customersRouter(db))
app.use('/api/sales', salesRouter(db))
app.use('/api/purchases', purchasesRouter(db))
app.use('/api/extras', extrasRouter(db))
app.use('/api/cierres', cierresRouter(db))
app.use('/api/auditLog', auditLogRouter(db))
app.use('/api/entradas', entradasRouter(db))
app.use('/api/settings', settingsRouter(db))
app.use('/api/inventory', inventoryOpsRouter(db))

// Serve the Vite production build (npm run build) so the PC and any phone on the same WiFi hit
// this one server for both the app shell and the API — no separate dev server needed for the
// real multi-device test.
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const port = Number(process.env.PORT) || 3001
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (ws) => addClient(ws))

server.listen(port, '0.0.0.0', () => {
  console.log(`Tienda server escuchando en http://0.0.0.0:${port} (LAN + localhost)`)
})
