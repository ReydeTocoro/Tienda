import type { NextFunction, Request, Response } from 'express'
import type { Sql } from './db'
import { checkAccount } from './domain/counter'
import { HttpError } from './routes/http'

interface AuthOptions {
  supabaseUrl: string
  publishableKey: string
  db: Sql
}

/** Who a request comes from, once its Supabase session checked out. */
export interface AuthInfo {
  /** The Supabase Auth session (JWT claim `session_id`): one signed-in device. It's bound server-side
   * to the person whose account it is (server/domain/counter.ts), which is also what RLS reads. */
  sessionId: string
  /** The account's email: an owner's (public.staff) or a user's (public.usuarios). */
  email: string
  /** When this session proved the account's password (JWT `amr`), in epoch ms — sessions from before
   * the switch to one account per person must sign in again. */
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
  until: number
  auth: AuthInfo | null
  /** Why the session may not go on (no access, or it must sign in again). */
  refusal?: HttpError
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

/** Every /api call must carry the Supabase session of someone who works at the store. The token is
 * verified by Supabase Auth itself (`/auth/v1/user`, which also rejects expired or revoked
 * sessions), then its account is checked (`checkAccount`: an owner or an active user — the same rule
 * RLS applies to reads — signed in recently enough). The verdict is cached for a minute per token,
 * so a burst of requests costs one round trip; the routes still look the person up again inside
 * their transaction, so a deactivation applies at once. */
export function requireStaff({ supabaseUrl, publishableKey, db }: AuthOptions) {
  const cache = new Map<string, Verdict>()

  async function verify(token: string): Promise<Verdict | null> {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const { email } = (await res.json()) as { email?: string }
    const claims = claimsOf(token)
    const sessionId = typeof claims?.session_id === 'string' ? claims.session_id : ''
    const until = Date.now() + CACHE_MS
    if (!email || !sessionId) return { until, auth: null, refusal: new HttpError(403, 'Esta cuenta no tiene acceso a la tienda') }
    const auth: AuthInfo = { sessionId, email, passwordAt: passwordAtOf(claims!) }
    try {
      await checkAccount(db, auth)
    } catch (err) {
      if (err instanceof HttpError) return { until, auth: null, refusal: err }
      throw err
    }
    return { until, auth }
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
    if (verdict.refusal || !verdict.auth) {
      const refusal = verdict.refusal ?? new HttpError(403, 'Esta cuenta no tiene acceso a la tienda')
      return void res.status(refusal.status).json({ ...refusal.extra, error: refusal.message })
    }
    req.auth = verdict.auth
    next()
  }
}
