import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, requireEnv } from './env'
import { createServerApp } from './serverApp'

/** Local API for development (`npm run server`), against the same Supabase database the deployed
 * app uses; Vite proxies /api here (vite.config.ts). It also serves the built app (`npm run
 * build`) for a production-like check. The real deployment is Firebase: Hosting serves the app
 * and a Function runs this same API (`npm run deploy`). */
loadEnv()

const app = createServerApp({
  dbUrl: requireEnv('SUPABASE_DB_URL'),
  supabaseUrl: requireEnv('VITE_SUPABASE_URL'),
  publishableKey: requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
  // Optional, in .env.local: lets Configuración → Usuarios create accounts and set passwords.
  secretKey: process.env.SUPABASE_SECRET_KEY,
})

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const port = Number(process.env.PORT) || 3001
app.listen(port, '0.0.0.0', () => {
  console.log(`API de la tienda en http://localhost:${port} (base de datos: Supabase)`)
})
