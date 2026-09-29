import type Database from 'better-sqlite3'

/** Tiny generic helpers shared by every route file — table names are always our own hardcoded
 * literals (never user input), so string-building the SQL is safe here. Kept deliberately thin:
 * most entities still need their own POST/PUT logic (dup checks, computed fields, cascades), so
 * a one-size-fits-all CRUD router would fight more than it'd save. */

export function listAll<T>(db: Database.Database, table: string): T[] {
  const rows = db.prepare(`SELECT json FROM ${table}`).all() as { json: string }[]
  return rows.map((r) => JSON.parse(r.json) as T)
}

export function getRow<T>(db: Database.Database, table: string, pkCol: string, pk: unknown): T | undefined {
  const row = db.prepare(`SELECT json FROM ${table} WHERE ${pkCol} = ?`).get(pk) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as T) : undefined
}

/** Insert-or-replace by primary key. `extraCols` are additional indexed columns to keep in sync
 * with the JSON blob (e.g. customers.cedula) — empty for most tables. */
export function putRow(db: Database.Database, table: string, pkCol: string, pk: unknown, extraCols: Record<string, unknown>, obj: unknown): void {
  const cols = [pkCol, ...Object.keys(extraCols), 'json']
  const placeholders = cols.map(() => '?').join(', ')
  const updates = cols
    .filter((c) => c !== pkCol)
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  const values = [pk, ...Object.values(extraCols), JSON.stringify(obj)]
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${pkCol}) DO UPDATE SET ${updates}`).run(...values)
}

export function deleteRow(db: Database.Database, table: string, pkCol: string, pk: unknown): boolean {
  const info = db.prepare(`DELETE FROM ${table} WHERE ${pkCol} = ?`).run(pk)
  return info.changes > 0
}

/** Insert into an `id INTEGER PRIMARY KEY AUTOINCREMENT` table, then stamp the generated id back
 * into the stored JSON so the row that comes back (and gets broadcast) carries its own id —
 * mirrors Dexie's `table.add(obj)` returning the new key. AUTOINCREMENT (not bare INTEGER
 * PRIMARY KEY) is what guarantees ids are never reused even after a row is deleted — SQLite
 * tracks the high-water mark in `sqlite_sequence` instead of reusing the max rowid, matching the
 * "stable ids" guarantee the app's design already relies on for Dexie's auto-increment keys. */
export function insertAutoRow<T extends object>(db: Database.Database, table: string, obj: T): T & { id: number } {
  const info = db.prepare(`INSERT INTO ${table} (json) VALUES (?)`).run(JSON.stringify(obj))
  const id = Number(info.lastInsertRowid)
  const withId = { ...obj, id }
  db.prepare(`UPDATE ${table} SET json = ? WHERE id = ?`).run(JSON.stringify(withId), id)
  return withId
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Repeated float add/subtract on `stock` (kg deliveries, weighed sales) drifts — e.g.
 * 0.1 + 0.2 !== 0.3 — so every stock write rounds to the same 4 decimals WeightModal already
 * rounds a weighed qty to, instead of letting garbage digits accumulate sale after sale. */
export function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000
}
