/** Imports the old local SQLite database into Supabase:  npm run db:import -- [file.db] [--yes]
 *
 * The SQLite file (default server/data/tienda.db) is opened read-only and never changed. In ONE
 * Supabase transaction every data table is emptied and refilled with the original rows and ids,
 * the id sequences are moved past them, and the sync epoch is bumped so every open app drops its
 * local copy and reloads. Supabase data that isn't just the seeded defaults is only overwritten
 * with --yes. */
import Database from 'better-sqlite3'
import path from 'node:path'
import { pgDb } from '../db'
import { loadEnv, requireEnv } from '../env'

const TABLES = [
  { name: 'products', pk: 'code', identity: false },
  { name: 'customers', pk: 'id', identity: false },
  { name: 'settings', pk: 'key', identity: false },
  { name: 'usuarios', pk: 'id', identity: false },
  { name: 'suppliers', pk: 'id', identity: false },
  { name: 'sales', pk: 'id', identity: true },
  { name: 'cierres', pk: 'id', identity: true },
  { name: 'auditLog', pk: 'id', identity: true },
  { name: 'entradas', pk: 'id', identity: true },
  { name: 'cashMovements', pk: 'id', identity: true },
  { name: 'cashSessions', pk: 'id', identity: true },
  { name: 'purchaseOrders', pk: 'id', identity: true },
  { name: 'payables', pk: 'id', identity: true },
] as const

const CHUNK = 500

loadEnv()
const args = process.argv.slice(2)
const force = args.includes('--yes')
const file = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'server/data/tienda.db')

const sqlite = new Database(file, { readonly: true, fileMustExist: true })
const source = TABLES.map((t) => {
  const exists = sqlite.prepare(`select 1 from sqlite_master where type = 'table' and name = ?`).get(t.name)
  const rows = exists ? (sqlite.prepare(`select ${t.pk} as pk, json from ${t.name}`).all() as Array<{ pk: string | number; json: string }>) : []
  return { ...t, rows: rows.map((r) => ({ pk: r.pk, data: JSON.parse(r.json) as unknown })) }
})
sqlite.close()

const db = pgDb(requireEnv('SUPABASE_DB_URL'))
try {
  const counts = await db.query<{ name: string; n: number }>(
    TABLES.filter((t) => t.name !== 'settings')
      .map((t) => `select '${t.name}' as name, count(*)::int as n from "${t.name}"`)
      .join(' union all '),
  )
  const occupied = counts.filter((c) => c.n > 0)
  if (occupied.length && !force) {
    console.error(`Supabase ya tiene datos (${occupied.map((c) => `${c.name}: ${c.n}`).join(', ')}).`)
    console.error('Esto los reemplazaría por los del archivo. Si es lo que quieres, repite con --yes.')
    process.exitCode = 1
  } else {
    await db.tx(async (q) => {
      // TRUNCATE fires no row triggers, so `deletions` is emptied explicitly too.
      await q.query(`truncate ${TABLES.map((t) => `"${t.name}"`).join(', ')}, deletions`)
      for (const t of source) {
        for (let i = 0; i < t.rows.length; i += CHUNK) {
          const chunk = t.rows.slice(i, i + CHUNK)
          const values = chunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2}::jsonb)`).join(', ')
          await q.query(`insert into "${t.name}" ("${t.pk}", data) values ${values}`, chunk.flatMap((r) => [r.pk, JSON.stringify(r.data)]))
        }
        if (t.identity) {
          await q.query(`select setval(pg_get_serial_sequence('public."${t.name}"', 'id'), coalesce((select max(id) from "${t.name}"), 0) + 1, false)`)
        }
      }
      await q.query(`update sync_meta set value = $1 where key = 'epoch'`, [String(Date.now())])
    })

    console.log(`Importado desde ${file}:`)
    for (const t of source) {
      const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from "${t.name}"`)
      if (n !== t.rows.length) throw new Error(`${t.name}: el archivo tiene ${t.rows.length} filas pero Supabase quedó con ${n}`)
      console.log(`  ${t.name.padEnd(15)} ${String(n).padStart(6)}`)
    }
    console.log('Listo: cada app abierta descartará su copia local y recargará los datos.')
  }
} finally {
  await db.end()
}
