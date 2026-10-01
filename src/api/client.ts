/** Thin fetch wrapper for the local-network server (see server/index.ts). Callers pass the full
 * `/api/...` path. In dev, Vite's proxy (vite.config.ts) forwards `/api` to the server; in
 * production the server serves the built app itself, so `/api` is always same-origin. */

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
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

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body)
export const apiDelete = <T = void>(path: string): Promise<T> => request<T>('DELETE', path)
