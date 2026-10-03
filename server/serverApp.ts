import { createApp } from './app'
import { requireStaff } from './auth'
import { pgDb } from './db'

export interface ServerConfig {
  /** Postgres URL of the Supabase session pooler — a secret (`.env.local` locally, a Secret
   * Manager secret in the Function). */
  dbUrl: string
  supabaseUrl: string
  publishableKey: string
}

/** The API wired to Supabase. Also the entry point of the Firebase Function bundle
 * (`npm run build:functions` → functions/lib/server.js). */
export function createServerApp(cfg: ServerConfig) {
  for (const [key, value] of Object.entries(cfg)) {
    if (!value) throw new Error(`Falta la configuración del servidor: ${key}`)
  }
  const db = pgDb(cfg.dbUrl)
  return createApp(db, requireStaff({ supabaseUrl: cfg.supabaseUrl, publishableKey: cfg.publishableKey, db }))
}
