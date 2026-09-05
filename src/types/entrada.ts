/** Stock-in ("restock") history — separate from AuditLogEntry, which covers adjustments/corrections. */
export interface EntradaRecord {
  id?: number
  code: string
  name: string
  qty: number
  stockAntes: number
  stockDespues: number
  date: string
  source?: string
}
