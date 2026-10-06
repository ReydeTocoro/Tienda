import type { Need } from '../shared/lib/permissions'
import { supabase } from './supabase'

/** Thin fetch wrapper for the write API (server/, deployed as a Firebase Function that Hosting
 * serves at /api; in dev, Vite proxies /api to `npm run server`). Every call carries the signed-in
 * session, which the API checks against the staff list — and through it, who is working on this
 * device and what they may do. Reads don't come through here: src/sync keeps the local copies up
 * to date from Supabase directly. */

/** A refused call, with what the server sent along: `need` (a permission someone allowed can
 * authorize), `lockedUntil` / `attemptsLeft` (PIN lockout)… */
export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

/** Asks for the PIN of someone who may authorize `need` (set by src/features/pin); resolves true once
 * the server recorded their approval. */
type NeedHandler = (need: Need) => Promise<boolean>
let needHandler: NeedHandler | null = null
export function onPermissionNeeded(handler: NeedHandler): void {
  needHandler = handler
}

// The latest access token, for the one request that can't wait for `getSession()`: telling the
// server who is working has left when the page is being closed.
let currentToken: string | null = null
supabase.auth.onAuthStateChange((_event, session) => {
  currentToken = session?.access_token ?? null
})

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const headers: Record<string, string> = {}
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new Error('Sin conexión con el servidor: revisa el internet e inténtalo de nuevo')
  }
}

async function errorOf(method: string, path: string, res: Response): Promise<ApiError> {
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Response wasn't JSON — fall back to the raw text.
  }
  const message = typeof data.error === 'string' && data.error ? data.error : text || `${method} ${path} HTTP ${res.status}`
  return new ApiError(res.status, message, data)
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const res = await send(method, path, body)
  if (!res.ok) {
    const err = await errorOf(method, path, res)
    // A step this person may not take on their own: someone allowed can authorize it with their PIN,
    // and the same request goes again (nothing was written the first time).
    const need = err.data.need as Need | undefined
    if (res.status === 403 && need && need !== 'admin' && !retried && needHandler && (await needHandler(need))) return request<T>(method, path, body, true)
    throw err
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body)
export const apiDelete = <T = void>(path: string): Promise<T> => request<T>('DELETE', path)

/** Best effort while the page goes away: a request that outlives the page (keepalive). */
export function apiPostOnExit(path: string): void {
  if (!currentToken) return
  try {
    void fetch(path, { method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${currentToken}` } }).catch(() => {})
  } catch {
    // The page is closing anyway; the server forgets the session in a few minutes regardless.
  }
}

/** Wakes the API up when the app opens: a Function that sat idle starts cold, and it's better to
 * pay that second now than on the first sale. */
export function warmUpApi(): void {
  fetch('/api/health').catch(() => {})
}
