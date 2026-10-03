import type { NextFunction, Request, Response } from 'express'
import type { Sql } from './db'

interface AuthOptions {
  supabaseUrl: string
  publishableKey: string
  db: Sql
}

interface Verdict {
  allowed: boolean
  until: number
}

const CACHE_MS = 60_000

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
    const rows = email ? await db.query('select 1 from public.staff where lower(email) = lower($1)', [email]) : []
    return { allowed: rows.length > 0, until: Date.now() + CACHE_MS }
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
    if (!verdict.allowed) return void res.status(403).json({ error: 'Esta cuenta no tiene acceso a la tienda' })
    next()
  }
}
