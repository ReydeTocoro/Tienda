import { db } from '../db/index'
import { apiGet } from '../api/client'

/** Keeps the local Dexie mirror in sync with the server's SQLite source of truth: pulls every
 * table in full on (re)connect, then applies each WebSocket broadcast as it arrives. Mounted
 * once from AppShell. Read functions in src/db/repositories/*.ts keep reading Dexie directly —
 * this module is the only thing that writes to Dexie now. */

const TABLES = ['products', 'sales', 'purchases', 'customers', 'extras', 'cierres', 'auditLog', 'entradas', 'settings'] as const

interface SyncMessage {
  table: (typeof TABLES)[number]
  op: 'put' | 'delete'
  data: unknown
}

let started = false

export function startSync(): void {
  if (started) return
  started = true
  connect()
}

async function pullAll(): Promise<void> {
  await Promise.all(
    TABLES.map(async (table) => {
      const rows = await apiGet<unknown[]>(`/api/${table}`)
      await db.table(table).bulkPut(rows as never[])
    }),
  )
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.onopen = () => {
    // A fresh connection also means "we might have missed messages while disconnected" (first
    // load included) — a full re-pull is the simplest way to guarantee convergence, and at this
    // app's scale (one small shop's data) it's cheap enough to just always do it.
    pullAll().catch((err) => console.error('Sync: falló el pull inicial', err))
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as SyncMessage
    void applyMessage(msg)
  }
  ws.onerror = () => ws.close()
  ws.onclose = () => {
    setTimeout(connect, 2000)
  }
}

async function applyMessage(msg: SyncMessage): Promise<void> {
  const table = db.table(msg.table)
  if (msg.op === 'delete') {
    await table.delete(msg.data as never)
  } else {
    await table.put(msg.data as never)
  }
}
