import pg from 'pg'
import type { PGlite } from '@electric-sql/pglite'
import { SUPABASE_CA } from './supabaseCa'

/** Postgres access for the routes and the money logic. Each table mirrors a Dexie table: a
 * primary-key column plus `data` (jsonb) holding the row exactly as its client type defines it,
 * while triggers keep the key inside `data` and stamp `updated_at` (supabase/migrations). So the
 * code only ever reads and writes whole objects, like it did with SQLite. */
export interface Sql {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]>
}

export interface Db extends Sql {
  /** Runs `fn` in one transaction: everything commits or nothing does. Each transaction first
   * takes the same app-wide lock, so writes run one at a time — the guarantee the synchronous
   * SQLite server gave for free. A stock or balance check can't be invalidated by another request
   * between the check and the write, even with several Function instances running. */
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>
  end(): Promise<void>
}

/** Arbitrary app-wide key for pg_advisory_xact_lock, released by the commit or rollback itself. */
const WRITE_LOCK = 4207

/** Supabase through its connection pooler. The certificate is checked against Supabase's root CA
 * (not in Node's default store), so the connection is verified, not just encrypted. The URL must
 * not carry `sslmode`, which would override this. */
export function pgDb(connectionString: string, maxConnections = 3): Db {
  const pool = new pg.Pool({ connectionString, max: maxConnections, idleTimeoutMillis: 30_000, ssl: { ca: SUPABASE_CA, rejectUnauthorized: true } })
  const wrap = (c: pg.Pool | pg.PoolClient): Sql => ({
    async query<R>(text: string, params?: unknown[]) {
      return (await c.query(text, params)).rows as R[]
    },
  })
  return {
    ...wrap(pool),
    async tx<T>(fn: (q: Sql) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('select pg_advisory_xact_lock($1)', [WRITE_LOCK])
        const result = await fn(wrap(client))
        await client.query('commit')
        return result
      } catch (err) {
        await client.query('rollback').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    end: () => pool.end(),
  }
}

interface LiteQueryable {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>
}

/** In-memory Postgres for the money self-check (npm run check:cash): the same SQL and triggers,
 * no network, never the real data. PGlite has a single connection, so no lock is needed. */
export function pgliteDb(lite: PGlite): Db {
  const wrap = (c: LiteQueryable): Sql => ({
    async query<R>(text: string, params?: unknown[]) {
      return (await c.query<R>(text, params)).rows
    },
  })
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    end: () => lite.close(),
  }
}
