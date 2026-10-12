import type { Request, Response } from 'express'
import { errorMessage } from './generic'

/** An error that answers with a specific HTTP status (404 not found, 409 duplicate...). `extra`
 * travels next to the message — e.g. `{ need }` on a 403, so the app can ask for the PIN of
 * someone allowed and retry, or `{ lockedUntil }` on a PIN lockout. */
export class HttpError extends Error {
  status: number
  extra?: Record<string, unknown>
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

/** The database couldn't be reached (the network to it, a restart, no free connections), as opposed to a
 * rule the request broke or a query that failed. */
export function isDatabaseDown(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown }
  const code = typeof e?.code === 'string' ? e.code : ''
  if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH)$/.test(code)) return true
  // PostgreSQL's own classes: 08 connection exception, 53 insufficient resources (too many connections),
  // 57P01-57P03 the server shutting down or not accepting connections yet.
  if (/^(08|53)/.test(code) || /^57P0[123]$/.test(code)) return true
  return /connection terminated|timeout exceeded when trying to connect|not queryable|connection error|the database system is (starting up|shutting down)/i.test(String(e?.message ?? ''))
}

/** Wraps an async route: what it returns goes out as JSON with `okStatus` (`undefined` → an empty
 * 204), and whatever it throws becomes `{ error }` — with the HttpError's status, 503 when the
 * database can't be reached (the app then knows the server is out of reach and keeps working on what it
 * has — see src/offline), or 400 for a rule the request broke (insufficient stock, duplicate cédula...).
 * Express 4 doesn't catch a rejected promise by itself, so every route goes through this. */
export function handle(fn: (req: Request) => Promise<unknown>, okStatus = 200) {
  return async (req: Request, res: Response) => {
    try {
      const result = await fn(req)
      if (result === undefined) res.status(204).end()
      else res.status(okStatus).json(result)
    } catch (err) {
      if (!(err instanceof HttpError) && isDatabaseDown(err)) {
        // The detail (hosts, ports) stays in our logs.
        console.error('No se pudo llegar a la base de datos:', err)
        // `down`: what tells the app this 503 is the server being out of reach (the till then keeps selling on its own),
        // unlike the 503s that mean "no mail account set up" or "Supabase refused" — see src/api/client.ts.
        return void res.status(503).json({ down: true, error: 'El servidor no puede acceder a la base de datos en este momento: inténtalo de nuevo en unos minutos' })
      }
      const status = err instanceof HttpError ? err.status : 400
      res.status(status).json({ ...(err instanceof HttpError ? err.extra : {}), error: errorMessage(err) })
    }
  }
}
