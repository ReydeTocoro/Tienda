import { randomUUID } from 'node:crypto'
import type { CajaId, CashMovement, CashSession, ExpenseCategory } from '../../src/types/cash'
import type { Sale } from '../../src/types/sale'
import { CAJA_LABEL, round2 } from '../../src/shared/lib/cash'
import { dayKeyOf, formatMoney } from '../../src/shared/lib/currency'
import { formatSaleId } from '../../src/shared/lib/id'
import type { Sql } from '../db'
import { insertAutoRow, putRow } from '../routes/generic'

/** Cash-ledger rules. Every function runs inside the caller's transaction (`db.tx`), so a rejected
 * operation (insufficient funds, bad input) leaves the data untouched; the apps receive the rows
 * that did commit through Supabase Realtime. */

const MOVEMENTS = 'cashMovements'
const SESSIONS = 'cashSessions'

export function isCaja(v: unknown): v is CajaId {
  return v === 'menor' || v === 'mayor'
}

/** Balance = sum of the caja's movements (never a stored number). */
export async function cajaBalance(sql: Sql, caja: CajaId): Promise<number> {
  const [row] = await sql.query<{ b: number }>(
    `select coalesce(sum(case when data ->> 'direction' = 'in' then (data ->> 'amount')::float8 else -(data ->> 'amount')::float8 end), 0)::float8 as b
     from "${MOVEMENTS}" where data ->> 'caja' = $1`,
    [caja],
  )
  return round2(Number(row.b))
}

export async function openSession(sql: Sql): Promise<CashSession | undefined> {
  const [row] = await sql.query<{ data: CashSession }>(`select data from "${SESSIONS}" where data ->> 'status' = 'abierta' order by id desc limit 1`)
  return row?.data
}

export interface NewMovement {
  caja: CajaId
  direction: 'in' | 'out'
  type: CashMovement['type']
  amount: number
  concept: string
  category?: ExpenseCategory
  refType?: CashMovement['refType']
  refId?: number | string
  transferId?: string
  medio?: CashMovement['medio']
  by?: string
  sessionId?: number
}

export async function insertMovement(sql: Sql, m: NewMovement): Promise<CashMovement & { id: number }> {
  const amount = round2(m.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0')
  const now = new Date()
  const row: Omit<CashMovement, 'id'> = {
    ...m,
    amount,
    date: now.toISOString(),
    dayKey: dayKeyOf(now),
    sessionId: m.sessionId ?? (m.caja === 'menor' ? (await openSession(sql))?.id : undefined),
  }
  return insertAutoRow(sql, MOVEMENTS, row)
}

export async function requireFunds(sql: Sql, caja: CajaId, amount: number): Promise<void> {
  const available = await cajaBalance(sql, caja)
  if (available + 0.005 < amount) {
    const hint = caja === 'menor' ? ' Abre la caja contando el efectivo si aún no lo has hecho.' : ''
    throw new Error(`Saldo insuficiente en ${CAJA_LABEL[caja]}: hay ${formatMoney(available)} y necesitas ${formatMoney(amount)}.${hint}`)
  }
}

export interface MovementInput {
  caja: CajaId
  direction: 'in' | 'out'
  amount: number
  concept: string
  category?: ExpenseCategory
  by?: string
}

/** Manual income/expense (gasto menor, nómina, servicios, arriendo...). */
export async function registerMovement(sql: Sql, input: MovementInput): Promise<CashMovement> {
  if (!isCaja(input.caja)) throw new Error('Caja inválida')
  if (input.direction !== 'in' && input.direction !== 'out') throw new Error('Indica si es ingreso o egreso')
  const concept = (input.concept ?? '').trim()
  if (!concept) throw new Error('Escribe el concepto del movimiento')
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('El monto debe ser mayor a 0')
  if (input.direction === 'out') await requireFunds(sql, input.caja, amount)
  return insertMovement(sql, {
    caja: input.caja,
    direction: input.direction,
    type: input.direction === 'in' ? 'ingreso' : 'egreso',
    amount,
    concept,
    category: input.direction === 'out' ? input.category : undefined,
    by: input.by?.trim() || undefined,
  })
}

export interface TransferInput {
  from: CajaId
  to: CajaId
  amount: number
  by?: string
}

/** Moves money between cajas as two linked movements, atomically (both or neither). */
export async function transferFunds(sql: Sql, input: TransferInput): Promise<{ transferId: string }> {
  if (!isCaja(input.from) || !isCaja(input.to) || input.from === input.to) throw new Error('Elige dos cajas distintas')
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('El monto a trasladar debe ser mayor a 0')
  await requireFunds(sql, input.from, amount)
  const transferId = randomUUID()
  const by = input.by?.trim() || undefined
  await insertMovement(sql, { caja: input.from, direction: 'out', type: 'traslado_salida', amount, concept: `Traslado a ${CAJA_LABEL[input.to]}`, transferId, by })
  await insertMovement(sql, { caja: input.to, direction: 'in', type: 'traslado_entrada', amount, concept: `Traslado desde ${CAJA_LABEL[input.from]}`, transferId, by })
  return { transferId }
}

/** First ever opening = the starting point of the books: the counted cash becomes the Caja Menor's
 * "base inicial" and, optionally, the Caja Mayor starts with what is in the safe and the banks.
 * Sales from before the cajas existed are deliberately not back-filled — their cash was already
 * handled outside this ledger, so re-creating it would only invent phantom shortages. */
export async function isFirstOpening(sql: Sql): Promise<boolean> {
  const rows = await sql.query(`select 1 from "${SESSIONS}" limit 1`)
  return rows.length === 0
}

/** Opens the Caja Menor workday by counting what is physically in the drawer; any gap against
 * the ledger is booked as an explicit arqueo adjustment instead of silently disappearing. */
export async function openCaja(sql: Sql, input: { countedCash: number; by: string; mayorInitial?: number }): Promise<CashSession> {
  const counted = round2(input.countedCash)
  if (!Number.isFinite(counted) || counted < 0) throw new Error('Cuenta el efectivo de la caja (no puede ser negativo)')
  const by = (input.by ?? '').trim()
  if (!by) throw new Error('Indica quién abre la caja')
  const already = await openSession(sql)
  if (already) throw new Error(`Ya hay una caja abierta (desde el ${already.dayKey}). Ciérrala antes de abrir otra.`)
  const first = await isFirstOpening(sql)
  const mayorInitial = round2(input.mayorInitial ?? 0)
  if (!Number.isFinite(mayorInitial) || mayorInitial < 0) throw new Error('El saldo inicial de la Caja Mayor no es válido')
  if (mayorInitial > 0 && !first) throw new Error('El saldo inicial de la Caja Mayor solo se registra en la primera apertura. Después usa un ingreso o un traslado.')

  const system = await cajaBalance(sql, 'menor')
  const diff = round2(counted - system)
  const now = new Date()
  const base: Omit<CashSession, 'id'> = {
    status: 'abierta',
    dayKey: dayKeyOf(now),
    openedAt: now.toISOString(),
    openedBy: by,
    openingCash: counted,
    systemAtOpen: system,
    openDiff: diff,
  }
  const session = await insertAutoRow(sql, SESSIONS, base)
  if (diff !== 0) {
    await insertMovement(sql, {
      caja: 'menor',
      direction: diff > 0 ? 'in' : 'out',
      type: 'ajuste_arqueo',
      amount: Math.abs(diff),
      concept: diff < 0 ? 'Faltante al abrir caja' : first ? 'Base inicial de caja' : 'Sobrante al abrir caja',
      sessionId: session.id,
      by,
    })
  }
  if (mayorInitial > 0) {
    await insertMovement(sql, { caja: 'mayor', direction: 'in', type: 'ingreso', amount: mayorInitial, concept: 'Saldo inicial de Caja Mayor (caja fuerte y bancos)', by })
  }
  return session
}

export interface CloseSessionPatch {
  closedBy: string
  expectedCash: number
  countedCash: number
  closeDiff: number
  transferred: number
  cierreId: number
}

/** Marks the open Caja Menor session (if any) as closed by the Cierre Z. */
export async function closeOpenSession(sql: Sql, patch: CloseSessionPatch): Promise<CashSession | undefined> {
  const s = await openSession(sql)
  if (!s) return undefined
  const updated: CashSession = { ...s, status: 'cerrada', closedAt: new Date().toISOString(), ...patch }
  await putRow(sql, SESSIONS, 'id', s.id, updated)
  return updated
}

/** Books the arqueo gap found at closing so the ledger matches what was counted. */
export async function recordArqueoAdjustment(sql: Sql, diff: number, by: string): Promise<void> {
  const d = round2(diff)
  if (d === 0) return
  await insertMovement(sql, {
    caja: 'menor',
    direction: d > 0 ? 'in' : 'out',
    type: 'ajuste_arqueo',
    amount: Math.abs(d),
    concept: d > 0 ? 'Sobrante al cerrar caja' : 'Faltante al cerrar caja',
    by,
  })
}

// --- Hooks used by sales and fiado collections: the money lands where it physically is. ---

export type CollectMethod = 'efectivo' | 'transferencia'

/** Cash goes into the Caja Menor drawer; a bank transfer is credited to the Caja Mayor (safe + banks). */
const receiptTarget = (method: CollectMethod): Pick<NewMovement, 'caja' | 'medio'> =>
  method === 'transferencia' ? { caja: 'mayor', medio: 'transferencia' } : { caja: 'menor', medio: 'efectivo' }

/** A collected sale puts its total where the money arrived. Fiado sales collect nothing yet. */
export async function recordSaleReceipt(sql: Sql, sale: Sale & { id: number }): Promise<void> {
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || sale.total <= 0) return
  await insertMovement(sql, { ...receiptTarget(sale.payMethod), direction: 'in', type: 'venta', amount: sale.total, concept: `Venta ${formatSaleId(sale.id)}`, refType: 'sale', refId: sale.id })
}

/** Correcting an invoice changes what was collected; the difference goes through the ledger, in
 * the same caja the original payment went to. */
export async function recordSaleCorrection(sql: Sql, sale: Sale & { id: number }, totalDiff: number): Promise<void> {
  const diff = round2(totalDiff)
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || diff === 0) return
  await insertMovement(sql, {
    ...receiptTarget(sale.payMethod),
    direction: diff > 0 ? 'in' : 'out',
    type: 'ajuste_venta',
    amount: Math.abs(diff),
    concept: `Corrección de venta ${formatSaleId(sale.id)}`,
    refType: 'sale',
    refId: sale.id,
  })
}

/** A fiado payment collected from the customer is money in (cash → Menor, transfer → Mayor);
 * forgiving a debt is not, so callers skip this for condonations. */
export async function recordFiadoCollection(sql: Sql, sale: Sale & { id: number }, amount: number, method: CollectMethod = 'efectivo'): Promise<void> {
  if (!(amount > 0)) return
  if (method !== 'efectivo' && method !== 'transferencia') throw new Error('Medio de pago inválido')
  const who = sale.fiadoName || sale.customerName || 'cliente'
  await insertMovement(sql, { ...receiptTarget(method), direction: 'in', type: 'abono_fiado', amount, concept: `Abono de fiado · ${who} (${formatSaleId(sale.id)})`, refType: 'sale', refId: sale.id })
}
