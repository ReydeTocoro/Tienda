/** Id helpers. Dexie auto-increment ids are the real, stable, never-reused id (see plan
 *  "IDs estables"). These only format that numeric id for display, matching the legacy
 *  visible formats (`#0001`, `#C0001`, `Z001` — legacy/index.html L3379, L4561, L6029). */

/** The number a sale made without internet carries until the server gives it its own: "PEND-0003". */
export const pendingRef = (seq: number): string => 'PEND-' + String(seq).padStart(4, '0')

/** A sale that is still on the device that made it has a negative id (the opposite of its outbox number). */
export const isPendingSaleId = (id: number | undefined): boolean => id !== undefined && id < 0

export function formatSaleId(id: number | undefined): string {
  if (id !== undefined && id < 0) return pendingRef(-id)
  return '#' + String(id ?? 0).padStart(4, '0')
}

export function formatOrderId(id: number | undefined): string {
  return '#P' + String(id ?? 0).padStart(4, '0')
}

export function formatCierreId(id: number | undefined): string {
  return 'Z' + String(id ?? 0).padStart(3, '0')
}

/** Client-side unique id for rows that aren't Dexie auto-increment (customers, free cart items). */
export function generateId(): string {
  return crypto.randomUUID()
}

/** The code a sale carries from the moment it is charged, so that sending it twice can never save it twice. A
 * UUID v4; `randomUUID` only exists on secure pages (https, localhost), `getRandomValues` everywhere. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
