import type { Need } from '../shared/lib/permissions'
import { useBusyStore } from '../store/useBusyStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { apiUrl } from './base'
import { supabase } from './supabase'

/** Thin fetch wrapper for the write API (server/, deployed as a Firebase Function that Hosting
 * serves at /api; in dev, Vite proxies /api to `npm run server`; an installed app reaches it through
 * VITE_API_URL, see ./base). Every call carries the signed-in session, which the API checks — its account
 * says who is working on this device and what they may do. Reads don't come through here: src/sync keeps
 * the local copies up to date from Supabase directly. */

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

/** The server could not be reached: no answer at all (no internet, a Wi-Fi that says "connected" and goes
 * nowhere…) or none in time. It says nothing about whether the request got there — a save that ends like this
 * may or may not have been applied, which is why a sale carries its own code (src/offline). */
export class NetworkError extends Error {
  timedOut: boolean
  /** The call never left: the session it needs could not be renewed (the internet is down, or a recent failure of
   * that renewal is still being waited out). It says nothing about whether the server itself is there. */
  noSession: boolean
  constructor(timedOut = false, noSession = false) {
    super(
      noSession
        ? 'No se pudo verificar la sesión con el servidor: revisa el internet e inténtalo de nuevo'
        : timedOut
          ? 'El servidor tardó demasiado en responder: revisa el internet y confirma si el cambio quedó guardado antes de repetirlo'
          : 'Sin conexión con el servidor: revisa el internet e inténtalo de nuevo',
    )
    this.name = 'NetworkError'
    this.timedOut = timedOut
    this.noSession = noSession
  }
}

/** The server did not do the work for a reason that isn't the request's: out of reach, or failing (5xx). A
 * sale that ends like this is kept on this device and sent again later. */
export const isServerTrouble = (err: unknown): boolean => err instanceof NetworkError || (err instanceof ApiError && err.status >= 500)

/** Asks for the PIN of someone who may authorize `need` (set by src/features/pin); resolves true once
 * the server recorded their approval. */
type NeedHandler = (need: Need) => Promise<boolean>
let needHandler: NeedHandler | null = null
export function onPermissionNeeded(handler: NeedHandler): void {
  needHandler = handler
}

/** Runs before a write that adds up what the sales did to the stock or the caja (set by src/offline): the sales
 * made without internet must reach the server first, or that write and those sales count the same goods twice
 * or leave them out. It throws to stop the write. */
type BooksHandler = () => Promise<void>
let beforeBooksWrite: BooksHandler | null = null
export function onBeforeBooksWrite(handler: BooksHandler): void {
  beforeBooksWrite = handler
}
const BOOKS_WRITES = /^\/api\/(products|entradas|inventory|cierres|cash)(\/|$)|^\/api\/sales\/[^/]+\/(correct|void)$|^\/api\/purchaseOrders\/[^/]+\/receive$|^\/api\/payables\/[^/]+\/pay$/

export interface RequestOptions {
  /** How long to wait for the answer before giving the server up as out of reach (default 60 s). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

/** The access token to send, or null when nobody is signed in. Looking the session up can itself go to the
 * internet (an expired token is renewed there), and with no internet it fails: that is the same "cannot reach
 * the server" as the call that would have followed. */
async function bearer(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession()
  if (data.session) return data.session.access_token
  if (error) throw new NetworkError(false, true)
  return null
}

/** What came back from the server, body included. */
interface Answer {
  res: Response
  text: string
}

async function send(method: string, path: string, body: unknown, timeoutMs: number): Promise<Answer> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    // The session lookup can't be aborted, so the time limit also races it.
    const token = await new Promise<string | null>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new NetworkError(true)), { once: true })
      bearer().then(resolve, reject)
    })
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal })
    // The body is part of the answer, so the time limit covers it too: a connection that dies in the middle of the
    // answer can leave a read hanging for minutes.
    const text = res.status === 204 ? '' : await res.text()
    return { res, text }
  } catch (err) {
    throw err instanceof NetworkError && !timedOut ? err : new NetworkError(timedOut)
  } finally {
    clearTimeout(timer)
  }
}

/** The JSON object the server answered with ({} when it isn't one). */
function objectOf(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {} // not JSON — the raw text is the message
  }
}

function errorOf(method: string, path: string, status: number, text: string, data: Record<string, unknown>): ApiError {
  const message = typeof data.error === 'string' && data.error ? data.error : text || `${method} ${path} HTTP ${status}`
  return new ApiError(status, message, data)
}

/** Whether this answer says the server is down, as opposed to refusing a request: a gateway answers 502/503/504 in
 * its own words when the Function is down or too slow (Google's pages are not JSON), and our API says `down` when
 * it can't reach its database. Our own API answers 502/503 for other reasons too (no mail account set up,
 * Supabase refusing an account…): those say nothing about whether the till can sell. */
function serverDown(res: Response, data: Record<string, unknown>): boolean {
  if (res.status < 502 || res.status > 504) return false
  return data.down === true || !(res.headers.get('content-type') ?? '').includes('json')
}

// ---- Feedback for a save ----------------------------------------------------------------------
// A save takes a moment (a trip to the database, seconds on a slow link), and a button that gives no sign
// of it gets pressed twice. So the button that started the save is locked — with a spinner, see
// `button[data-loading]` in index.css — until the server answers, and the whole app shows a progress bar
// (BusyBar) meanwhile. The button is the last one clicked a moment ago: the handlers don't have to know.

let lastClick: { el: HTMLButtonElement; at: number } | null = null
const locks = new WeakMap<HTMLButtonElement, number>()
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest('button')
      if (el && !el.disabled) lastClick = { el, at: Date.now() }
    },
    true,
  )
}

/** What the app does by itself (the heartbeat, a PIN being checked, signing out, sending the sales that were
 * made without internet): never a button's doing. */
const BACKGROUND = /^\/api\/(counter\/(session|approve|sign-out)|sales\/offline|health)$/

/** Locks the button that was just clicked and returns the function that unlocks it. */
function lockClickedButton(): () => void {
  const click = lastClick
  if (!click || Date.now() - click.at > 3000 || !click.el.isConnected || click.el.disabled) return () => {}
  const el = click.el
  locks.set(el, (locks.get(el) ?? 0) + 1)
  el.setAttribute('data-loading', '')
  el.setAttribute('aria-busy', 'true')
  el.disabled = true
  return () => {
    const left = (locks.get(el) ?? 1) - 1
    locks.set(el, left)
    if (left > 0) return // another save of the same click is still going
    el.removeAttribute('data-loading')
    el.removeAttribute('aria-busy')
    el.disabled = false
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}, retried = false): Promise<T> {
  // Only a person's saves: reading isn't a click's doing. The retry after a PIN is the same save, but
  // its button was locked by the first attempt.
  const tracked = method !== 'GET' && !BACKGROUND.test(path)
  const unlock = tracked && !retried ? lockClickedButton() : null
  if (tracked) useBusyStore.getState().begin()
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    unlock?.()
    if (tracked) useBusyStore.getState().end()
  }
  try {
    if (method !== 'GET' && !retried && beforeBooksWrite && BOOKS_WRITES.test(path)) await beforeBooksWrite()
    const { res, text } = await send(method, path, body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const data = objectOf(text)
    // Any answer from the server, even a refusal, proves it is there — except the ones a gateway or a server
    // that lost its database sends instead of its own.
    useConnectionStore.getState().setReachable(!serverDown(res, data))
    if (!res.ok) {
      const err = errorOf(method, path, res.status, text, data)
      // A step this person may not take on their own: someone allowed can authorize it with their PIN,
      // and the same request goes again (nothing was written the first time).
      const need = err.data.need as Need | undefined
      if (res.status === 403 && need && need !== 'admin' && !retried && needHandler) {
        settle() // waiting for someone to type a PIN is not a save in progress
        if (await needHandler(need)) return await request<T>(method, path, body, opts, true)
      }
      throw err
    }
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new NetworkError() // an answer that isn't ours at all (a Wi-Fi login page): no real connection
    }
  } catch (err) {
    if (err instanceof NetworkError && !err.noSession) useConnectionStore.getState().setReachable(false)
    throw err
  } finally {
    settle()
  }
}

export const apiGet = <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>('GET', path, undefined, opts)
export const apiPost = <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> => request<T>('POST', path, body, opts)
export const apiPut = <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> => request<T>('PUT', path, body, opts)
export const apiDelete = <T = void>(path: string, opts?: RequestOptions): Promise<T> => request<T>('DELETE', path, undefined, opts)

/** Wakes the API up when the app opens: a Function that sat idle starts cold, and it's better to
 * pay that second now than on the first sale. */
export function warmUpApi(): void {
  fetch(apiUrl('/api/health')).catch(() => {})
}
