import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import type { Settings } from '../src/types/settings'

/** Every table mirrors Dexie's own shape (see src/db/schema.ts): a primary key column for
 * lookups/uniqueness, plus a `json` column holding the full row exactly as the client type
 * defines it (Sale.items, Cierre.payBreak/arqueo, the AuditLogEntry union, etc. all round-trip
 * losslessly without hand-mapping every nested field to a SQL column — Dexie itself works the
 * same way: it only indexes the handful of fields declared in `.stores()`, everything else is
 * an opaque object in IndexedDB). `cedula` on customers is the one extra indexed column,
 * because addCustomer/updateCustomer need a real duplicate-cedula lookup. */
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
fs.mkdirSync(dataDir, { recursive: true })
const dbPath = process.env.TIENDA_DB_PATH || path.join(dataDir, 'tienda.db')

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS products (code TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, cedula TEXT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS extras (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS cierres (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS auditLog (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS entradas (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_customers_cedula ON customers(cedula);
`)

// Seed the single 'main' settings row the first time the server ever runs — mirrors the
// defaults in src/db/repositories/settings.ts's getSettings() exactly (same default PIN
// "1234", same SHA-256 hash) so a client that reads its local Dexie fallback before the first
// sync pull lands never disagrees with what the server ends up serving.
const hasSettings = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('main')
if (!hasSettings) {
  const defaults: Settings = {
    key: 'main',
    storeName: 'Mi Tienda',
    pinHash: createHash('sha256').update('1234').digest('hex'),
    pinLength: 4,
    theme: 'light',
    hidScannerEnabled: true,
  }
  db.prepare('INSERT INTO settings (key, json) VALUES (?, ?)').run('main', JSON.stringify(defaults))
}
