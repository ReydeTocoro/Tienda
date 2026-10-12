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

/** Several rows of one table by key in ONE round trip, as a map keyed by the key as text. A loop of
 * `getRow` costs a trip to the database per row — a ticket of ten products took ten. */
export async function getRowsByKey<T>(sql: Sql, table: string, pkCol: string, keys: string[]): Promise<Map<string, T>> {
  if (!keys.length) return new Map()
  const rows = await sql.query<{ pk: string; data: T }>(`select ${ident(pkCol)}::text as pk, data from ${ident(table)} where ${ident(pkCol)} = any($1)`, [[...new Set(keys)]])
  return new Map(rows.map((r) => [r.pk, r.data]))
}

/** Insert-or-replace by primary key (the trigger keeps the key inside `data` in step). */
export async function putRow(sql: Sql, table: string, pkCol: string, pk: unknown, obj: unknown): Promise<void> {
  await sql.query(`insert into ${ident(table)} (${ident(pkCol)}, data) values ($1, $2::jsonb) on conflict (${ident(pkCol)}) do update set data = excluded.data`, [pk, JSON.stringify(obj)])
}

/** Insert-or-replace many rows in ONE round trip — the same effect as a `putRow` each (the table's triggers
 * still run for every row). The keys must be different from each other. */
export async function putRows(sql: Sql, table: string, pkCol: string, rows: Array<{ pk: string; obj: unknown }>): Promise<void> {
  if (!rows.length) return
  await sql.query(
    `insert into ${ident(table)} (${ident(pkCol)}, data) select r ->> 'pk', r -> 'obj' from jsonb_array_elements($1::jsonb) as r
     on conflict (${ident(pkCol)}) do update set data = excluded.data`,
    [JSON.stringify(rows)],
  )
}

/** Sets the stock of several products in one statement; the rest of each row stays as it is. */
export async function setStocks(sql: Sql, stocks: Array<{ code: string; stock: number }>): Promise<void> {
  if (!stocks.length) return
  await sql.query(
    `update products p set data = jsonb_set(p.data, '{stock}', to_jsonb(u.stock))
     from jsonb_to_recordset($1::jsonb) as u(code text, stock float8) where p.code = u.code`,
    [JSON.stringify(stocks)],
  )
}

/** Inserts many identity-keyed rows at once, in the order given, and returns them with their ids. */
export async function insertAutoRows<T extends object>(sql: Sql, table: string, objs: T[]): Promise<Array<T & { id: number }>> {
  if (!objs.length) return []
  const rows = await sql.query<{ data: T & { id: number } }>(
    `insert into ${ident(table)} (data) select e.value from jsonb_array_elements($1::jsonb) with ordinality as e(value, n) order by e.n returning data`,
    [JSON.stringify(objs)],
  )
  return rows.map((r) => r.data)
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

/** A request field as text: trimmed and cut to `max` characters, '' when it isn't a string. */
export const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Repeated float add/subtract on `stock` (kg deliveries, weighed sales) drifts — e.g.
 * 0.1 + 0.2 !== 0.3 — so every stock write rounds to the same 4 decimals WeightModal already
 * rounds a weighed qty to, instead of letting garbage digits accumulate sale after sale. */
export function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000
}
