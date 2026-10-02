import type { CajaId, CashMovement, ExpenseCategory, MovementType } from '../../types/cash'
import type { Payable } from '../../types/purchaseOrder'
import { dayKeyOf } from './currency'

/** Money math shared by the server (which enforces it) and the UI (which previews it). */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function balanceOf(movements: CashMovement[], caja: CajaId): number {
  let total = 0
  for (const m of movements) {
    if (m.caja !== caja) continue
    total += m.direction === 'in' ? m.amount : -m.amount
  }
  return round2(total)
}

/** 'YYYY-MM-DD' + N calendar days — pure date arithmetic, no timezone surprises. */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function dueDateFrom(received: Date | string, days: number): string {
  return addDaysToKey(dayKeyOf(received), days)
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((keyToUtc(toKey) - keyToUtc(fromKey)) / 86_400_000)
}

/** 'YYYY-MM-DD' → "5 oct 2026" for display (noon avoids any timezone shifting the day). */
export function formatDayKey(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function payableBalance(p: Payable): number {
  return round2(p.amount - p.paid)
}

export const CAJA_LABEL: Record<CajaId, string> = { menor: 'Caja Menor', mayor: 'Caja Mayor' }

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  venta: 'Venta',
  ajuste_venta: 'Corrección de venta',
  abono_fiado: 'Abono de fiado',
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  traslado_salida: 'Traslado (salida)',
  traslado_entrada: 'Traslado (entrada)',
  pago_proveedor: 'Pago a proveedor',
  ajuste_arqueo: 'Ajuste de arqueo',
}

export const MEDIO_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia' } as const

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  nomina: 'Nómina',
  servicios: 'Servicios públicos',
  arriendo: 'Arriendo',
  proveedores: 'Proveedores',
  impuestos: 'Impuestos',
  mantenimiento: 'Mantenimiento',
  otro: 'Otro',
}

/** Categories offered for each caja: Menor is petty cash, Mayor carries the big payments. */
export const CATEGORIES_BY_CAJA: Record<CajaId, ExpenseCategory[]> = {
  menor: ['otro', 'mantenimiento', 'servicios', 'proveedores'],
  mayor: ['nomina', 'servicios', 'arriendo', 'proveedores', 'impuestos', 'mantenimiento', 'otro'],
}
