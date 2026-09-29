/** Currency + date formatting — ported 1:1 from legacy `fmt`/`fmtD` (legacy/index.html L2354-2355).
 * Locale is 'es-CO' (not generic 'es'): the bare 'es' locale doesn't reliably group thousands in
 * every ICU build (verified: `(1500).toLocaleString('es')` → "1500", `('es-CO')` → "1.500") — 'es-CO'
 * pins the "." thousands / "," decimal convention this app has always displayed money with. */
const LOCALE = 'es-CO'

export function formatCurrency(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatMoney(n: number | undefined | null): string {
  return '$' + formatCurrency(n)
}

/** Quantities/stock (not money): grouped thousands, decimals shown only when present — "20",
 * "1.500", "0,35 kg". Same grouping fix as formatCurrency, but without forcing ",00" on whole
 * counts. Up to 3 decimals covers gram-level precision on a kg-based product. */
export function formatQty(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: 3 })
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(LOCALE) + ' ' + d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function dayKeyOf(iso: string): string {
  return iso.slice(0, 10)
}
