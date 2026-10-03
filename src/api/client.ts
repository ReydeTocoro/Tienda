import { supabase } from './supabase'

/** Thin fetch wrapper for the write API (server/, deployed as a Firebase Function that Hosting
 * serves at /api; in dev, Vite proxies /api to `npm run server`). Every call carries the signed-in
 * session, which the API checks against the staff list. Reads don't come through here: src/sync
 * keeps the local mirror up to date from Supabase directly. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers: Record<string, string> = {}
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new Error('Sin conexión con el servidor: revisa el internet e inténtalo de nuevo')
  }
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      // Response wasn't JSON — fall back to the raw text.
    }
    throw new Error(message || `${method} ${path} HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body)
export const apiDelete = <T = void>(path: string): Promise<T> => request<T>('DELETE', path)

/** Wakes the API up when the app opens: a Function that sat idle starts cold, and it's better to
 * pay that second now than on the first sale. */
export function warmUpApi(): void {
  fetch('/api/health').catch(() => {})
}
