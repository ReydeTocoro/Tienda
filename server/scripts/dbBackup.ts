/** Copies every table of the Supabase database to local JSON files — run it right before
 * `npm run db:push`:  npm run db:backup
 * Read-only (it only SELECTs). The copy lands in server/data/backups/<date>-supabase/, which git
 * ignores: it holds the store's real data, purchase prices and PIN hashes included, so it stays on
 * this computer. */
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, requireEnv } from '../env'
import { pgDb } from '../db'

loadEnv()
const db = pgDb(requireEnv('SUPABASE_DB_URL'), 1)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = path.resolve('server/data/backups', `${stamp}-supabase`)
fs.mkdirSync(dir, { recursive: true })

try {
  const tables = await db.query<{ schema: string; name: string }>(
    `select table_schema as schema, table_name as name from information_schema.tables
     where table_schema in ('public', 'private') and table_type = 'BASE TABLE' order by 1, 2`,
  )
  for (const t of tables) {
    const rows = await db.query(`select * from "${t.schema}"."${t.name}"`)
    fs.writeFileSync(path.join(dir, `${t.schema}.${t.name}.json`), JSON.stringify(rows, null, 1))
    console.log(`  ${t.schema}.${t.name}: ${rows.length} filas`)
  }
  console.log(`\nCopia guardada en ${dir}`)
} finally {
  await db.end()
}
