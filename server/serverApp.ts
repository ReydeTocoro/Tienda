import { createApp } from './app'
import { noAccounts, supabaseAccounts } from './accounts'
import { requireStaff } from './auth'
import { pgDb, type Db } from './db'
import { sendPendingPush, type PushSend } from './domain/push'
import { gmailMailer, noMailer, type GmailConfig } from './mailer'

export interface ServerConfig {
  /** Postgres URL of the Supabase session pooler — a secret (`.env.local` locally, a Secret
   * Manager secret in the Function). */
  dbUrl: string
  supabaseUrl: string
  publishableKey: string
  /** The project's secret key, for creating the users' sign-in accounts — a secret too. Optional:
   * without it the app records each user's email and the account is made in the Supabase dashboard. */
  secretKey?: string
  /** The Gmail account receipts are e-mailed from. Optional: without it the server answers "correo no
   * configurado" and the rest of the app works as usual. */
  mail?: Partial<GmailConfig>
  /** Sends the Administrador's phone notifications (Firebase Cloud Messaging, from functions/index.js). Optional. */
  push?: PushSend
}

/** The API wired to Supabase. Also the entry point of the Firebase Function bundle
 * (`npm run build:functions` → functions/lib/server.js). */
export function createServerApp(cfg: ServerConfig) {
  const { secretKey: rawKey, mail, push, ...required } = cfg
  // A pasted secret often carries a trailing newline or space, which would break the HTTP header.
  const secretKey = rawKey?.trim() || undefined
  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`Falta la configuración del servidor: ${key}`)
  }
  const db = pgDb(cfg.dbUrl)
  const accounts = secretKey ? supabaseAccounts(cfg.supabaseUrl, secretKey) : noAccounts
  const mailer = mail?.user?.trim() && mail.password?.trim() ? gmailMailer({ user: mail.user.trim(), password: mail.password }) : noMailer
  return createApp(db, requireStaff({ supabaseUrl: cfg.supabaseUrl, publishableKey: cfg.publishableKey, db }), accounts, mailer, push ?? null)
}

let pushDb: Db | undefined

/** The scheduled "Pendientes de hoy" on the Administrador's phone (functions/index.js runs it at fixed hours). */
export function sendScheduledPush(dbUrl: string, send: PushSend) {
  pushDb ??= pgDb(dbUrl, 1)
  return sendPendingPush(pushDb, send)
}
