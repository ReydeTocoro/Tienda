import { useSyncExternalStore } from 'react'
import type { CashMovement, CashSession } from '../types/cash'
import type { Cierre } from '../types/cierre'
import type { Payable, PurchaseOrder } from '../types/purchaseOrder'
import type { Supplier } from '../types/supplier'
import type { ProductCost, Profit } from '../types/secrets'
import type { Permission } from '../shared/lib/permissions'

/** The tables not everyone may see, kept in memory only — never in IndexedDB, so nothing secret is
 * left on the device's disk when whoever could see it walks away, closes the tab or the browser.
 * The database only serves them while someone allowed is signed in on this device (RLS, see
 * supabase/migrations/20261005000000_permisos_servidor.sql); src/sync fills and empties them as the
 * permissions of whoever is working change. A reload starts them empty, like the signed-in person. */

export interface SecureRows {
  productCosts: ProductCost
  profits: Profit
  purchaseOrders: PurchaseOrder
  payables: Payable
  suppliers: Supplier
  cashMovements: CashMovement
  cashSessions: CashSession
  cierres: Cierre
}
export type SecureTable = keyof SecureRows

/** The permission the database asks before serving each table — the same as its RLS policy. */
export const SECURE_TABLES: Record<SecureTable, Permission> = {
  productCosts: 'costos.ver',
  profits: 'ganancias.ver',
  purchaseOrders: 'costos.ver',
  payables: 'costos.ver',
  suppliers: 'proveedores.gestionar',
  cashMovements: 'caja.verEsperado',
  cashSessions: 'caja.verEsperado',
  cierres: 'reportes.ver',
}
export const SECURE_TABLE_NAMES = Object.keys(SECURE_TABLES) as SecureTable[]

export const securePk = (t: SecureTable): string => (t === 'productCosts' ? 'code' : t === 'profits' ? 'key' : 'id')
/** Tables keyed by text; the rest have numeric ids, which arrive as text in `deletions`. */
const TEXT_KEYED = new Set<SecureTable>(['productCosts', 'profits', 'suppliers'])
export const secureKey = (t: SecureTable, key: unknown): string | number => (TEXT_KEYED.has(t) ? String(key) : Number(key))

interface TableState {
  rows: Map<string | number, unknown>
  /** Downloaded since the permission was gained (until then, empty doesn't mean "none"). */
  loaded: boolean
  /** `rows` as an array, rebuilt only after a change — a stable snapshot for React. */
  list: unknown[] | null
  listeners: Set<() => void>
}

const tables = Object.fromEntries(SECURE_TABLE_NAMES.map((t) => [t, { rows: new Map(), loaded: false, list: null, listeners: new Set() }])) as unknown as Record<
  SecureTable,
  TableState
>

function changed(t: SecureTable): void {
  tables[t].list = null
  for (const l of tables[t].listeners) l()
}

/** Adds or replaces rows; with `replace`, the table becomes exactly these rows (a full download). */
export function putSecure(t: SecureTable, rows: unknown[], replace = false): void {
  const s = tables[t]
  if (replace) s.rows.clear()
  for (const r of rows) {
    const key = (r as Record<string, unknown>)?.[securePk(t)]
    if (key !== undefined && key !== null) s.rows.set(secureKey(t, key), r)
  }
  if (replace) s.loaded = true
  changed(t)
}

export function deleteSecure(t: SecureTable, key: unknown): void {
  if (tables[t].rows.delete(secureKey(t, key))) changed(t)
}

/** Forgets everything of a table (the permission was lost, or the data was reloaded wholesale). */
export function clearSecure(t: SecureTable): void {
  const s = tables[t]
  if (!s.rows.size && !s.loaded) return
  s.rows.clear()
  s.loaded = false
  changed(t)
}

export function isSecureLoaded(t: SecureTable): boolean {
  return tables[t].loaded
}

export function secureRows<T extends SecureTable>(t: T): SecureRows[T][] {
  const s = tables[t]
  s.list ??= [...s.rows.values()]
  return s.list as SecureRows[T][]
}

function subscribe(t: SecureTable, listener: () => void): () => void {
  tables[t].listeners.add(listener)
  return () => tables[t].listeners.delete(listener)
}

/** Resolves true once the table is downloaded (right after signing in someone who may see it), or
 * false if that takes too long. */
export function whenSecureLoaded(t: SecureTable, timeoutMs = 15_000): Promise<boolean> {
  if (tables[t].loaded) return Promise.resolve(true)
  return new Promise((resolve) => {
    const off = subscribe(t, () => {
      if (!tables[t].loaded) return
      off()
      clearTimeout(timer)
      resolve(true)
    })
    const timer = setTimeout(() => {
      off()
      resolve(false)
    }, timeoutMs)
  })
}

/** A secret table's rows, live: empty while whoever is working may not see it. */
export function useSecureTable<T extends SecureTable>(t: T): SecureRows[T][] {
  return useSyncExternalStore(
    (l) => subscribe(t, l),
    () => secureRows(t),
  )
}

/** Whether the table has been downloaded for whoever is working (false: not allowed, or still loading). */
export function useSecureLoaded(t: SecureTable): boolean {
  return useSyncExternalStore(
    (l) => subscribe(t, l),
    () => tables[t].loaded,
  )
}
