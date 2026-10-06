import type { NextFunction, Request, Response } from 'express'
import type { Sql } from './db'
import { HttpError } from './routes/http'

interface AuthOptions {
  supabaseUrl: string
  publishableKey: string
  db: Sql
}

/** Who a request comes from, once its Supabase session checked out. */
export interface AuthInfo {
  /** The Supabase Auth session (JWT claim `session_id`): one signed-in device. Who is working on
   * that device is bound to it server-side (server/domain/counter.ts), which is also what RLS reads. */
  sessionId: string
  email: string
  /** When this session last proved the account's password (JWT `amr`), in epoch ms — how the owner's
   * PIN recovery knows the password was really typed just now. */
  passwordAt: number | null
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthInfo
  }
}

export function authOf(req: Request): AuthInfo {
  if (!req.auth) throw new HttpError(401, 'Inicia sesión para continuar')
  return req.auth
}

interface Verdict {
  allowed: boolean
  until: number
  auth: AuthInfo | null
}

const CACHE_MS = 60_000

/** The claims of a token Supabase Auth has already verified. */
function claimsOf(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function passwordAtOf(claims: Record<string, unknown>): number | null {
  const amr = Array.isArray(claims.amr) ? (claims.amr as Array<{ method?: unknown; timestamp?: unknown }>) : []
  const times = amr.filter((m) => m?.method === 'password' && typeof m.timestamp === 'number').map((m) => (m.timestamp as number) * 1000)
  return times.length ? Math.max(...times) : null
}

/** Every /api call must carry the Supabase session of someone on the `staff` list. The token is
 * verified by Supabase Auth itself (`/auth/v1/user`, which also rejects expired or revoked
 * sessions), then its email is looked up in `staff` — the same rule RLS applies to reads. The
 * verdict is cached for a minute per token, so a burst of requests costs one round trip. */
export function requireStaff({ supabaseUrl, publishableKey, db }: AuthOptions) {
  const cache = new Map<string, Verdict>()

  async function verify(token: string): Promise<Verdict | null> {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const { email } = (await res.json()) as { email?: string }
    const claims = claimsOf(token)
    const sessionId = typeof claims?.session_id === 'string' ? claims.session_id : ''
    const rows = email ? await db.query('select 1 from public.staff where lower(email) = lower($1)', [email]) : []
    const allowed = rows.length > 0 && !!sessionId
    return { allowed, until: Date.now() + CACHE_MS, auth: allowed ? { sessionId, email: email!, passwordAt: passwordAtOf(claims!) } : null }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return void res.status(401).json({ error: 'Inicia sesión para continuar' })
    let verdict = cache.get(token)
    if (!verdict || verdict.until < Date.now()) {
      try {
        const fresh = await verify(token)
        if (!fresh) {
          cache.delete(token)
          return void res.status(401).json({ error: 'Tu sesión venció: vuelve a iniciar sesión' })
        }
        if (cache.size > 500) cache.clear()
        cache.set(token, fresh)
        verdict = fresh
      } catch {
        return void res.status(503).json({ error: 'No se pudo verificar la sesión. Revisa la conexión a internet.' })
      }
    }
    if (!verdict.allowed || !verdict.auth) return void res.status(403).json({ error: 'Esta cuenta no tiene acceso a la tienda' })
    req.auth = verdict.auth
    next()
  }
}
