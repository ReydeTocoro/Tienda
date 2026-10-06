import type { Cierre } from '../../types/cierre'
import { apiPost } from '../../api/client'

export interface ConfirmCierreInput {
  dayKey: string
  cajero: string
  notas: string
  efectivoFisico: number
  /** Cash to move from the Caja Menor to the Caja Mayor as part of closing. */
  trasladar?: number
}

/** Non-destructive Cierre Z (plan decision 2): archives a summary row in `cierres` and marks
 * that day's still-open sales and cash movements with `closedInCierreId` — it never deletes them.
 * The server works out the day's figures itself (the person closing may count blind). Someone who
 * may not see the expected cash gets back only that it closed. */
export async function confirmCierreZ(input: ConfirmCierreInput): Promise<Cierre> {
  return apiPost<Cierre>('/api/cierres', input)
}
