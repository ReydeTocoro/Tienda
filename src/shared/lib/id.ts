/** Id helpers. Dexie auto-increment ids are the real, stable, never-reused id (see plan
 *  "IDs estables"). These only format that numeric id for display, matching the legacy
 *  visible formats (`#0001`, `#C0001`, `Z001` — legacy/index.html L3379, L4561, L6029). */

export function formatSaleId(id: number | undefined): string {
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
