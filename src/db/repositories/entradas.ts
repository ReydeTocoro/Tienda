import { db } from '../index'
import type { EntradaRecord } from '../../types/entrada'
import { apiPost } from '../../api/client'

/** Single-item restock — legacy `confirmarEntrada()`. */
export async function confirmEntrada(code: string, qty: number, source?: string): Promise<EntradaRecord> {
  return apiPost<EntradaRecord>('/api/entradas', { code, qty, source })
}

/** Bulk restock from the "escaneo masivo" modal — legacy `msFinalize()`. */
export async function confirmEntradasBulk(entries: Array<{ code: string; qty: number }>, source = 'masivo'): Promise<number> {
  const { totalUnidades } = await apiPost<{ totalUnidades: number }>('/api/entradas/bulk', { entries, source })
  return totalUnidades
}

export async function listEntradas(limit = 50): Promise<EntradaRecord[]> {
  return db.entradas.orderBy('id').reverse().limit(limit).toArray()
}
