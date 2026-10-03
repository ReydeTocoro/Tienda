import type { RealtimeChannel } from '@supabase/supabase-js'
import { db } from '../db/index'
import { supabase } from '../api/supabase'

/** Keeps the local Dexie mirror in step with Supabase, the source of truth. On every (re)connect
 * it pulls only what changed since its last pull (everything the first time, or after the data
 * was reloaded wholesale), then applies each Realtime change as it arrives. Read functions in
 * src/db/repositories/*.ts keep reading Dexie directly — this module is the only thing that
 * writes to Dexie. Mounted once from AppShell, after login. */

const TABLES = [
  'products',
  'sales',
  'customers',
  'cierres',
  'auditLog',
  'entradas',
  'settings',
  'usuarios',
  'cashMovements',
  'cashSessions',
  'suppliers',
  'purchaseOrders',
  'payables',
] as const
type Table = (typeof TABLES)[number]

/** Primary-key column of each table — also its Dexie key. */
const pkOf = (t: Table) => (t === 'products' ? 'code' : t === 'settings' ? 'key' : 'id')
/** Tables keyed by text; the rest have numeric ids, which arrive as text in `deletions`. */
const TEXT_KEYS = new Set<string>(['products', 'settings', 'customers', 'usuarios', 'suppliers'])
const toKey = (table: string, key: unknown) => (TEXT_KEYS.has(table) ? String(key) : Number(key))

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000
/** Re-read a minute before the cursor, so a row that committed a little late isn't skipped. */
const OVERLAP_MS = 60_000
const EPOCH_KEY = 'sync:epoch'
const cursorKey = (name: string) => `sync:cursor:${name}`

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

export function startSync(): void {
  if (channel) return
  channel = supabase.channel('tienda-sync')
  for (const table of TABLES) {
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

/** Drops this device's copy of the data (signing out on a shared device). */
export async function clearLocalData(): Promise<void> {
  await Promise.all(TABLES.map((t) => db.table(t).clear()))
  for (const t of [...TABLES, 'deletions']) writeLocal(cursorKey(t), null)
  writeLocal(EPOCH_KEY, null)
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
  await Promise.all(TABLES.map((t) => pullTable(t, fresh)))
  if (fresh) writeLocal(cursorKey('deletions'), deletionsMark)
  else await pullDeletions()
  writeLocal(EPOCH_KEY, epoch)
}

async function pullTable(table: Table, replace: boolean): Promise<void> {
  const cursor = replace ? null : readLocal(cursorKey(table))
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null
  const rows: Array<{ data: unknown; updated_at: string }> = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select('data, updated_at').order('updated_at').order(pkOf(table)).range(from, from + PAGE - 1)
    if (since) query = query.gt('updated_at', since)
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data as typeof rows))
    if (data.length < PAGE) break
  }
  const t = db.table(table)
  // Replace (not merge) on a full pull: rows deleted while this device wasn't listening must go
  // too. Clear + put in one transaction, so live queries never see the table empty mid-refresh.
  await db.transaction('rw', t, async () => {
    if (replace) await t.clear()
    if (rows.length) await t.bulkPut(rows.map((r) => r.data) as never[])
  })
  const last = rows.at(-1)?.updated_at
  if (last) writeLocal(cursorKey(table), last)
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
    if ((TABLES as readonly string[]).includes(d.table_name)) await db.table(d.table_name).delete(toKey(d.table_name, d.pk))
  }
  const last = data.at(-1)?.deleted_at as string | undefined
  if (last) writeLocal(cursorKey('deletions'), last)
}

async function applyChange(table: Table, event: string, next: { data?: unknown }, old: Record<string, unknown>): Promise<void> {
  const t = db.table(table)
  if (event === 'DELETE') {
    const key = old?.[pkOf(table)]
    if (key !== undefined) await t.delete(toKey(table, key))
  } else if (next?.data) {
    await t.put(next.data as never)
  }
}
