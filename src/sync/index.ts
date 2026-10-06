import type { RealtimeChannel } from '@supabase/supabase-js'
import { db } from '../db/index'
import { supabase } from '../api/supabase'
import { SECURE_TABLES, SECURE_TABLE_NAMES, clearSecure, deleteSecure, isSecureLoaded, putSecure, securePk, type SecureTable } from '../db/secure'

/** Keeps the local copies in step with Supabase, the source of truth. On every (re)connect it pulls
 * only what changed since its last pull (everything the first time, or after the data was reloaded
 * wholesale), then applies each Realtime change as it arrives. Read functions in
 * src/db/repositories/*.ts keep reading the local copies — this module is the only thing that
 * writes them. Mounted once from AppShell, after login.
 *
 * Two kinds of tables:
 * - `TABLES`: what every staff member may see, mirrored in Dexie (on disk, so it works offline);
 * - the secret ones (src/db/secure.ts): the database only serves them while someone allowed is
 *   signed in on this device, and they're kept in memory only. `setSecurePerms` (called as whoever
 *   is working changes) downloads a table when its permission is gained and forgets it when lost. */

const TABLES = ['products', 'sales', 'customers', 'auditLog', 'entradas', 'settings', 'usuarios', 'cajaState'] as const
type Table = (typeof TABLES)[number]

/** Primary-key column of each table — also its Dexie key. */
const pkOf = (t: Table) => (t === 'products' ? 'code' : t === 'settings' || t === 'cajaState' ? 'key' : 'id')
/** Tables keyed by text; the rest have numeric ids, which arrive as text in `deletions`. */
const TEXT_KEYS = new Set<string>(['products', 'settings', 'customers', 'usuarios', 'cajaState'])
const toKey = (table: string, key: unknown) => (TEXT_KEYS.has(table) ? String(key) : Number(key))
const isTable = (t: string): t is Table => (TABLES as readonly string[]).includes(t)
const isSecure = (t: string): t is SecureTable => t in SECURE_TABLES

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000
/** Pages of a full download fetched at once. */
const PARALLEL = 4
/** Re-read a minute before the cursor, so a row that committed a little late isn't skipped. */
const OVERLAP_MS = 60_000
const EPOCH_KEY = 'sync:epoch'
const cursorKey = (name: string) => `sync:cursor:${name}`
/** Tables that used to be mirrored on disk; their cursors are dropped along with them. */
const FORMERLY_ON_DISK = ['cierres', 'cashMovements', 'cashSessions', 'suppliers', 'purchaseOrders', 'payables']

// The sync cursors are per-device conveniences: losing them only means a full pull.
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked: every reconnect simply pulls everything again.
  }
}

let channel: RealtimeChannel | null = null
let pulling: Promise<void> | null = null

/** Which secret tables whoever is working may receive right now, and how far each was downloaded
 * (memory only, like the rows). */
let securePerms = new Set<string>()
const secureCursor = new Map<SecureTable, string>()
const allowedSecure = (t: SecureTable) => securePerms.has(SECURE_TABLES[t])

export function startSync(): void {
  if (channel) return
  for (const t of FORMERLY_ON_DISK) writeLocal(cursorKey(t), null)
  channel = supabase.channel('tienda-sync')
  for (const table of [...TABLES, ...SECURE_TABLE_NAMES]) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      void applyChange(table, payload.eventType, payload.new as { data?: unknown }, payload.old as Record<string, unknown>)
    })
  }
  // A bumped epoch means the server data was reloaded wholesale: start over from scratch.
  channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_meta' }, () => void pull())
  channel.subscribe((status) => {
    // Fired on the first connection and again after every reconnect: changes made while this
    // device was offline are fetched instead of trusting that nothing happened.
    if (status === 'SUBSCRIBED') void pull()
  })
}

export async function stopSync(): Promise<void> {
  if (!channel) return
  const c = channel
  channel = null
  await supabase.removeChannel(c)
}

/** The permissions of whoever is working on this device — call it whenever they change, and only once
 * the server agrees (signed in there, or signed out). Secret tables they may no longer see are
 * forgotten at once; the ones they may now see are downloaded. */
export function setSecurePerms(perms: Iterable<string>): void {
  const next = new Set(perms)
  const gained: SecureTable[] = []
  for (const t of SECURE_TABLE_NAMES) {
    const was = allowedSecure(t)
    const now = next.has(SECURE_TABLES[t])
    if (was && !now) {
      clearSecure(t)
      secureCursor.delete(t)
    }
    if (!was && now) gained.push(t)
  }
  securePerms = next
  if (gained.length && channel) void Promise.all(gained.map((t) => pullSecure(t, true))).catch((err) => console.error('Sync: falló la descarga de datos protegidos', err))
}

/** Drops this device's copy of the data (signing out on a shared device). */
export async function clearLocalData(): Promise<void> {
  await Promise.all(TABLES.map((t) => db.table(t).clear()))
  for (const t of [...TABLES, 'deletions']) writeLocal(cursorKey(t), null)
  writeLocal(EPOCH_KEY, null)
  for (const t of SECURE_TABLE_NAMES) clearSecure(t)
  secureCursor.clear()
  securePerms = new Set()
}

function pull(): Promise<void> {
  // One pull at a time; a reconnect while pulling just waits for the one in flight.
  pulling ??= pullAll()
    .catch((err) => console.error('Sync: falló la descarga de datos', err))
    .finally(() => {
      pulling = null
    })
  return pulling
}

async function pullAll(): Promise<void> {
  const { data: meta, error } = await supabase.from('sync_meta').select('value').eq('key', 'epoch').maybeSingle()
  if (error) throw error
  const epoch = (meta?.value as string | undefined) ?? ''
  const fresh = readLocal(EPOCH_KEY) !== epoch
  // Taken before the tables, so a delete that lands mid-pull is replayed next time, not lost.
  const deletionsMark = fresh ? await newestDeletion() : null
  await Promise.all([
    ...TABLES.map((t) => pullTable(t, fresh)),
    ...SECURE_TABLE_NAMES.filter(allowedSecure).map((t) => pullSecure(t, fresh || !isSecureLoaded(t))),
  ])
  if (fresh) writeLocal(cursorKey('deletions'), deletionsMark)
  else await pullDeletions()
  writeLocal(EPOCH_KEY, epoch)
}

type Row = { data: unknown; updated_at: string }

/** Rows written after `since` (all of them without it), oldest first. A full download fetches its
 * pages a few at a time. */
async function fetchRows(table: string, pk: string, since: string | null): Promise<Row[]> {
  const page = (from: number, count = false) => {
    let query = supabase
      .from(table)
      .select('data, updated_at', count ? { count: 'exact' } : undefined)
      .order('updated_at')
      .order(pk)
      .range(from, from + PAGE - 1)
    if (since) query = query.gt('updated_at', since)
    return query
  }
  const first = await page(0, true)
  if (first.error) throw first.error
  const rows = [...(first.data as Row[])]
  const total = first.count ?? rows.length
  const starts: number[] = []
  for (let from = PAGE; from < total; from += PAGE) starts.push(from)
  for (let i = 0; i < starts.length; i += PARALLEL) {
    const batch = await Promise.all(starts.slice(i, i + PARALLEL).map((from) => page(from)))
    for (const res of batch) {
      if (res.error) throw res.error
      rows.push(...(res.data as Row[]))
    }
  }
  return rows
}

async function pullTable(table: Table, replace: boolean): Promise<void> {
  const cursor = replace ? null : readLocal(cursorKey(table))
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null
  const rows = await fetchRows(table, pkOf(table), since)
  const t = db.table(table)
  // Replace (not merge) on a full pull: rows deleted while this device wasn't listening must go
  // too. Clear + put in one transaction, so live queries never see the table empty mid-refresh.
  await db.transaction('rw', t, async () => {
    if (replace) await t.clear()
    if (rows.length) await t.bulkPut(rows.map((r) => r.data) as never[])
  })
  const last = rows.reduce<string | null>((max, r) => (max && max > r.updated_at ? max : r.updated_at), null)
  if (last) writeLocal(cursorKey(table), last)
}

async function pullSecure(table: SecureTable, replace: boolean): Promise<void> {
  const cursor = replace ? null : (secureCursor.get(table) ?? null)
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null
  const rows = await fetchRows(table, securePk(table), since)
  // The permission may have gone while this was downloading: then nothing is kept.
  if (!allowedSecure(table)) return
  putSecure(
    table,
    rows.map((r) => r.data),
    replace,
  )
  const last = rows.reduce<string | null>((max, r) => (max && max > r.updated_at ? max : r.updated_at), cursor)
  if (last) secureCursor.set(table, last)
}

async function newestDeletion(): Promise<string> {
  const { data, error } = await supabase.from('deletions').select('deleted_at').order('deleted_at', { ascending: false }).limit(1)
  if (error) throw error
  return (data[0]?.deleted_at as string | undefined) ?? new Date(0).toISOString()
}

async function pullDeletions(): Promise<void> {
  const cursor = readLocal(cursorKey('deletions')) ?? new Date(0).toISOString()
  const since = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString()
  const { data, error } = await supabase.from('deletions').select('table_name, pk, deleted_at').gt('deleted_at', since).order('deleted_at')
  if (error) throw error
  for (const d of data as Array<{ table_name: string; pk: string; deleted_at: string }>) {
    if (isTable(d.table_name)) await db.table(d.table_name).delete(toKey(d.table_name, d.pk))
    else if (isSecure(d.table_name)) deleteSecure(d.table_name, d.pk)
  }
  const last = data.at(-1)?.deleted_at as string | undefined
  if (last) writeLocal(cursorKey('deletions'), last)
}

async function applyChange(table: Table | SecureTable, event: string, next: { data?: unknown }, old: Record<string, unknown>): Promise<void> {
  if (isSecure(table)) {
    // The database only sends these to an allowed device; a change that was already on its way when
    // the permission went is dropped here.
    if (!allowedSecure(table)) return
    if (event === 'DELETE') {
      const key = old?.[securePk(table)]
      if (key !== undefined) deleteSecure(table, key)
    } else if (next?.data) {
      putSecure(table, [next.data])
    }
    return
  }
  const t = db.table(table)
  if (event === 'DELETE') {
    const key = old?.[pkOf(table)]
    if (key !== undefined) await t.delete(toKey(table, key))
  } else if (next?.data) {
    await t.put(next.data as never)
  }
}
