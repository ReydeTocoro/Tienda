import type { Sql } from '../db'

/** Tiny generic helpers shared by every route file — table and column names are always our own
 * hardcoded literals (never user input), so string-building the SQL is safe here. Names are
 * quoted because several tables keep the client's camelCase ("cashMovements"). Kept deliberately
 * thin: most entities still need their own POST/PUT logic (dup checks, computed fields, cascades),
 * so a one-size-fits-all CRUD router would fight more than it'd save. */
const ident = (name: string) => `"${name}"`

export async function listAll<T>(sql: Sql, table: string): Promise<T[]> {
  const rows = await sql.query<{ data: T }>(`select data from ${ident(table)}`)
  return rows.map((r) => r.data)
}

export async function getRow<T>(sql: Sql, table: string, pkCol: string, pk: unknown): Promise<T | undefined> {
  const rows = await sql.query<{ data: T }>(`select data from ${ident(table)} where ${ident(pkCol)} = $1`, [pk])
  return rows[0]?.data
}

/** Insert-or-replace by primary key (the trigger keeps the key inside `data` in step). */
export async function putRow(sql: Sql, table: string, pkCol: string, pk: unknown, obj: unknown): Promise<void> {
  await sql.query(`insert into ${ident(table)} (${ident(pkCol)}, data) values ($1, $2::jsonb) on conflict (${ident(pkCol)}) do update set data = excluded.data`, [pk, JSON.stringify(obj)])
}

export async function deleteRow(sql: Sql, table: string, pkCol: string, pk: unknown): Promise<boolean> {
  const rows = await sql.query(`delete from ${ident(table)} where ${ident(pkCol)} = $1 returning 1`, [pk])
  return rows.length > 0
}

/** Insert into an identity-keyed table. The trigger copies the generated id into `data`, so the
 * row that comes back carries its own id — mirrors Dexie's `table.add(obj)` returning the new key.
 * Identity sequences never hand out an id twice, even after a delete: the "stable ids" guarantee
 * the app relies on for Dexie's auto-increment keys. */
export async function insertAutoRow<T extends object>(sql: Sql, table: string, obj: T): Promise<T & { id: number }> {
  const rows = await sql.query<{ data: T & { id: number } }>(`insert into ${ident(table)} (data) values ($1::jsonb) returning data`, [JSON.stringify(obj)])
  return rows[0].data
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
