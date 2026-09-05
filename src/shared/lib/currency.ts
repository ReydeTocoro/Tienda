/** Currency + date formatting — ported 1:1 from legacy `fmt`/`fmtD` (legacy/index.html L2354-2355). */

export function formatCurrency(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatMoney(n: number | undefined | null): string {
  return '$' + formatCurrency(n)
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es') + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function dayKeyOf(iso: string): string {
  return iso.slice(0, 10)
}
