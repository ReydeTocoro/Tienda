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

/** Wraps an async route: what it returns goes out as JSON with `okStatus` (`undefined` → an empty
 * 204), and whatever it throws becomes `{ error }` — with the HttpError's status, or 400 for a
 * rule the request broke (insufficient stock, duplicate cédula...). Express 4 doesn't catch a
 * rejected promise by itself, so every route goes through this. */
export function handle(fn: (req: Request) => Promise<unknown>, okStatus = 200) {
  return async (req: Request, res: Response) => {
    try {
      const result = await fn(req)
      if (result === undefined) res.status(204).end()
      else res.status(okStatus).json(result)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 400
      res.status(status).json({ ...(err instanceof HttpError ? err.extra : {}), error: errorMessage(err) })
    }
  }
}
