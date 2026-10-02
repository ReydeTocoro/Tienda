import { db } from '../index'
import type { Cierre } from '../../types/cierre'
import type { DayAggregate } from '../../shared/lib/aggregation'
import { apiPost } from '../../api/client'

export async function listCierres(): Promise<Cierre[]> {
  return db.cierres.orderBy('id').reverse().toArray()
}

export interface ConfirmCierreInput {
  dayKey: string
  cajero: string
  notas: string
  efectivoFisico: number
  /** Cash to move from the Caja Menor to the Caja Mayor as part of closing. */
  trasladar?: number
  /** The `{ onlyOpen: true }` aggregate for this day — what's actually being closed. */
  aggregate: DayAggregate
}

/** Non-destructive Cierre Z (plan decision 2): archives a summary row in `cierres` and marks
 * that day's still-open sales and cash movements with `closedInCierreId` — it never deletes them. */
export async function confirmCierreZ(input: ConfirmCierreInput): Promise<Cierre> {
  return apiPost<Cierre>('/api/cierres', input)
}
