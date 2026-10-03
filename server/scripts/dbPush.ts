/** Applies the SQL migrations in supabase/migrations to the Supabase database:  npm run db:push
 * (append `-- --dry-run` to only list what would run). Runs the official Supabase CLI with the URL
 * from .env.local, launched through node directly so the password never passes through a shell. */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { loadEnv, requireEnv } from '../env'

loadEnv()
const cli = path.resolve('node_modules/supabase/dist/supabase.js')
const result = spawnSync(process.execPath, [cli, 'db', 'push', '--db-url', requireEnv('SUPABASE_DB_URL'), ...process.argv.slice(2)], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
