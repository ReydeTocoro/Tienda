import type { CajaId, CashMovement, CashSession, ExpenseCategory } from '../../types/cash'
import { apiPost } from '../../api/client'

/** Reads come from the synced Dexie mirror (see `useCaja`); every write goes through the server,
 * which enforces the ledger rules (sufficient funds, atomic transfers) and broadcasts the result. */

export interface RegisterMovementInput {
  caja: CajaId
  direction: 'in' | 'out'
  amount: number
  concept: string
  category?: ExpenseCategory
  by?: string
}

export function registerMovement(input: RegisterMovementInput): Promise<CashMovement> {
  return apiPost<CashMovement>('/api/cash/movement', input)
}

export function transferFunds(input: { from: CajaId; to: CajaId; amount: number; by?: string }): Promise<{ transferId: string }> {
  return apiPost<{ transferId: string }>('/api/cash/transfer', input)
}

/** `mayorInitial` (first opening only): what the safe and the banks hold at the start of the books. `settleWith: 'mayor'`:
 * the gap against the books is cash that came out of the Caja Mayor (the day's base) or went into it, so the server books it
 * as a transfer between the cajas instead of a sobrante or faltante. */
export function openCaja(input: { countedCash: number; by: string; mayorInitial?: number; settleWith?: 'mayor' }): Promise<CashSession> {
  return apiPost<CashSession>('/api/cash/open', input)
}
