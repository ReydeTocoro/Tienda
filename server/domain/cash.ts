import { randomUUID } from 'node:crypto'
import type { CajaId, CashMovement, CashSession, ExpenseCategory } from '../../src/types/cash'
import type { Sale } from '../../src/types/sale'
import { CAJA_LABEL, CATEGORY_LABEL, round2 } from '../../src/shared/lib/cash'
import { dayKeyOf, formatMoney } from '../../src/shared/lib/currency'
import { formatSaleId } from '../../src/shared/lib/id'
import type { TransferAccount } from '../../src/shared/lib/transferAccounts'
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

/** The workday that was open at `at` (an ISO date): what a sale made without internet belongs to, even
 * when it reaches the server after that day was closed. Falls back to the one open now, like any movement. */
export async function sessionAt(sql: Sql, at?: string): Promise<CashSession | undefined> {
  if (!at) return openSession(sql)
  const [row] = await sql.query<{ data: CashSession }>(
    `select data from "${SESSIONS}" where data ->> 'openedAt' <= $1 and (data ->> 'closedAt' is null or data ->> 'closedAt' >= $1) order by id desc limit 1`,
    [at],
  )
  return row?.data ?? (await openSession(sql))
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
  cuenta?: CashMovement['cuenta']
  by?: string
  sessionId?: number
  /** When it happened, if not now (ISO): a sale made without internet is booked when it reaches the
   * server but dated, and put in the workday, of the moment it was made. */
  at?: string
}

export async function insertMovement(sql: Sql, m: NewMovement): Promise<CashMovement & { id: number }> {
  const amount = round2(m.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0')
  const { at, ...movement } = m
  const when = at ? new Date(at) : new Date()
  const row: Omit<CashMovement, 'id'> = {
    ...movement,
    amount,
    date: when.toISOString(),
    dayKey: dayKeyOf(when),
    sessionId: m.sessionId ?? (m.caja === 'menor' ? (await sessionAt(sql, at))?.id : undefined),
  }
  return insertAutoRow(sql, MOVEMENTS, row)
}

/** `revealBalance` false (someone who may not see the expected cash): the refusal doesn't say how
 * much there is. */
export async function requireFunds(sql: Sql, caja: CajaId, amount: number, revealBalance = true): Promise<void> {
  const available = await cajaBalance(sql, caja)
  if (available + 0.005 < amount) {
    const hint = caja === 'menor' ? ' Abre la caja contando el efectivo si aún no lo has hecho.' : ''
    if (!revealBalance) throw new Error(`Saldo insuficiente en ${CAJA_LABEL[caja]} para pagar ${formatMoney(amount)}.${hint}`)
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
  if (input.category && !Object.hasOwn(CATEGORY_LABEL, input.category)) throw new Error('Esa categoría de gasto no existe')
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
  /** Why, when the transfer has a reason of its own: it follows the usual concept ("Traslado a Caja Menor · base al abrir caja"). */
  note?: string
}

/** Moves money between cajas as two linked movements, atomically (both or neither). */
export async function transferFunds(sql: Sql, input: TransferInput): Promise<{ transferId: string }> {
  if (!isCaja(input.from) || !isCaja(input.to) || input.from === input.to) throw new Error('Elige dos cajas distintas')
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('El monto a trasladar debe ser mayor a 0')
  await requireFunds(sql, input.from, amount)
  const transferId = randomUUID()
  const by = input.by?.trim() || undefined
  const note = input.note?.trim().slice(0, 80)
  const why = note ? ` · ${note}` : ''
  await insertMovement(sql, { caja: input.from, direction: 'out', type: 'traslado_salida', amount, concept: `Traslado a ${CAJA_LABEL[input.to]}${why}`, transferId, by })
  await insertMovement(sql, { caja: input.to, direction: 'in', type: 'traslado_entrada', amount, concept: `Traslado desde ${CAJA_LABEL[input.from]}${why}`, transferId, by })
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
 * the ledger is booked as an explicit arqueo adjustment instead of silently disappearing.
 *
 * With `settleWith: 'mayor'` the gap is not a sobrante or a faltante but money that moved between the cajas without
 * being recorded — the day's base taken out of the Caja Mayor (more cash than the books had), or cash that was carried
 * to it after closing (less) — so it is booked as the transfer it was and both cajas stay right. Nothing happens when
 * there is no gap; it can't be used on the first opening, whose cash is the starting point of the books. */
export async function openCaja(
  sql: Sql,
  input: { countedCash: number; by: string; mayorInitial?: number; settleWith?: 'mayor'; settledBy?: string },
): Promise<CashSession> {
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
  if (input.settleWith !== undefined && input.settleWith !== 'mayor') throw new Error('Esa forma de cuadrar la apertura no existe')
  if (input.settleWith && first) throw new Error('En la primera apertura el efectivo es la base inicial: no sale de la Caja Mayor.')

  const system = await cajaBalance(sql, 'menor')
  const diff = round2(counted - system)
  const viaMayor = input.settleWith === 'mayor' && diff !== 0
  const now = new Date()
  const base: Omit<CashSession, 'id'> = {
    status: 'abierta',
    dayKey: dayKeyOf(now),
    openedAt: now.toISOString(),
    openedBy: by,
    openingCash: counted,
    systemAtOpen: system,
    openDiff: diff,
    ...(viaMayor ? { openSettledWith: 'mayor' as const } : {}),
  }
  const session = await insertAutoRow(sql, SESSIONS, base)
  if (viaMayor) {
    // The transfer checks the funds of the caja it leaves: with too little in the Caja Mayor the whole opening is refused.
    await transferFunds(sql, {
      from: diff > 0 ? 'mayor' : 'menor',
      to: diff > 0 ? 'menor' : 'mayor',
      amount: Math.abs(diff),
      by: input.settledBy ?? by,
      note: diff > 0 ? 'base al abrir caja' : 'efectivo llevado antes de abrir caja',
    })
  } else if (diff !== 0) {
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
const receiptTarget = (method: CollectMethod, cuenta?: TransferAccount): Pick<NewMovement, 'caja' | 'medio' | 'cuenta'> =>
  method === 'transferencia' ? { caja: 'mayor', medio: 'transferencia', ...(cuenta ? { cuenta } : {}) } : { caja: 'menor', medio: 'efectivo' }

/** A collected sale puts its total where the money arrived. Fiado sales collect nothing yet. */
export async function recordSaleReceipt(sql: Sql, sale: Sale & { id: number }): Promise<void> {
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || sale.total <= 0) return
  await insertMovement(sql, {
    ...receiptTarget(sale.payMethod, sale.transferAccount),
    direction: 'in',
    type: 'venta',
    amount: sale.total,
    concept: `Venta ${formatSaleId(sale.id)}`,
    refType: 'sale',
    refId: sale.id,
    // A sale that came from a device without internet keeps the moment it was made.
    ...(sale.offline ? { at: sale.date } : {}),
  })
}

/** Correcting an invoice changes what was collected; the difference goes through the ledger, in
 * the same caja the original payment went to. */
export async function recordSaleCorrection(sql: Sql, sale: Sale & { id: number }, totalDiff: number): Promise<void> {
  const diff = round2(totalDiff)
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || diff === 0) return
  await insertMovement(sql, {
    ...receiptTarget(sale.payMethod, sale.transferAccount),
    direction: diff > 0 ? 'in' : 'out',
    type: 'ajuste_venta',
    amount: Math.abs(diff),
    concept: `Corrección de venta ${formatSaleId(sale.id)}`,
    refType: 'sale',
    refId: sale.id,
  })
}

/** Annulling an invoice that was collected takes its whole total back out of the caja it went into. */
export async function recordSaleVoid(sql: Sql, sale: Sale & { id: number }): Promise<void> {
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || sale.total <= 0) return
  await insertMovement(sql, {
    ...receiptTarget(sale.payMethod, sale.transferAccount),
    direction: 'out',
    type: 'ajuste_venta',
    amount: sale.total,
    concept: `Anulación de venta ${formatSaleId(sale.id)}`,
    refType: 'sale',
    refId: sale.id,
  })
}

/** What a customer had paid towards a fiado that is annulled goes back to them, from the caja it came into. It is an
 * expense of today because the payment itself counted as income on its own day. */
export async function recordFiadoRefund(sql: Sql, sale: Sale & { id: number }, amount: number, method: CollectMethod, account?: TransferAccount): Promise<void> {
  if (!(round2(amount) > 0)) return
  await insertMovement(sql, {
    ...receiptTarget(method, account),
    direction: 'out',
    type: 'egreso',
    amount,
    concept: `Devolución de abonos · anulación de venta ${formatSaleId(sale.id)}`,
    refType: 'sale',
    refId: sale.id,
  })
}

/** A fiado payment collected from the customer is money in (cash → Menor, transfer → Mayor);
 * forgiving a debt is not, so callers skip this for condonations. */
export async function recordFiadoCollection(sql: Sql, sale: Sale & { id: number }, amount: number, method: CollectMethod = 'efectivo', account?: TransferAccount): Promise<void> {
  if (!(amount > 0)) return
  if (method !== 'efectivo' && method !== 'transferencia') throw new Error('Medio de pago inválido')
  const who = sale.fiadoName || sale.customerName || 'cliente'
  await insertMovement(sql, { ...receiptTarget(method, account), direction: 'in', type: 'abono_fiado', amount, concept: `Abono de fiado · ${who} (${formatSaleId(sale.id)})`, refType: 'sale', refId: sale.id })
}
