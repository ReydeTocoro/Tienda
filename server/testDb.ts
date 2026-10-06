import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

/** The bits of a Supabase database the migrations rely on, for an in-memory PGlite: the API roles
 * (with Supabase's default grants on new public tables, so the migrations' revokes are really
 * tested), `auth.jwt()` reading the claims PostgREST/Realtime set, the `extensions` schema with
 * pgcrypto, and the Realtime publication. */
const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension pgcrypto with schema extensions;
create publication supabase_realtime;
`

export const MIGRATIONS_DIR = path.resolve('supabase/migrations')

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** A throwaway database with every migration applied (or the ones before `until`, to test what a
 * migration does to existing data) — never the real Supabase data. */
export async function testDatabase(opts: { until?: string } = {}): Promise<PGlite> {
  const lite = await PGlite.create({ extensions: { pgcrypto } })
  await lite.exec(SUPABASE_SHIM)
  for (const file of migrationFiles()) {
    if (opts.until && file >= opts.until) break
    await lite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return lite
}

export async function applyMigration(lite: PGlite, file: string): Promise<void> {
  await lite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
}

/** Runs `fn` as a browser would reach the database: the `authenticated` role with these JWT claims
 * (what PostgREST does for every request), then back to the superuser. */
export async function asBrowser<T>(lite: PGlite, claims: Record<string, unknown> | null, fn: () => Promise<T>): Promise<T> {
  await lite.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : ''])
  await lite.exec(claims ? 'set role authenticated' : 'set role anon')
  try {
    return await fn()
  } finally {
    await lite.exec('reset role')
    await lite.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
