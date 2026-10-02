import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { CajaId, CashMovement, CashSession, ExpenseCategory } from '../../src/types/cash'
import type { Sale } from '../../src/types/sale'
import { CAJA_LABEL, round2 } from '../../src/shared/lib/cash'
import { dayKeyOf, formatMoney } from '../../src/shared/lib/currency'
import { formatSaleId } from '../../src/shared/lib/id'
import { insertAutoRow, putRow } from '../routes/generic'
import type { BroadcastMsg } from '../broadcast'

/** Cash-ledger rules. Every function runs inside the caller's SQLite transaction and pushes the
 * rows it touched onto `out`; the route broadcasts them only after the transaction commits, so a
 * rejected operation (insufficient funds, bad input) leaves both the data and the clients
 * untouched. */
export type Out = BroadcastMsg[]

const MOVEMENTS = 'cashMovements'
const SESSIONS = 'cashSessions'

export function isCaja(v: unknown): v is CajaId {
  return v === 'menor' || v === 'mayor'
}

/** Balance = sum of the caja's movements (never a stored number). */
export function cajaBalance(db: Database.Database, caja: CajaId): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE json_extract(json, '$.direction') WHEN 'in' THEN json_extract(json, '$.amount') ELSE -json_extract(json, '$.amount') END), 0) AS b
       FROM ${MOVEMENTS} WHERE json_extract(json, '$.caja') = ?`,
    )
    .get(caja) as { b: number }
  return round2(row.b)
}

export function openSession(db: Database.Database): CashSession | undefined {
  const row = db.prepare(`SELECT json FROM ${SESSIONS} WHERE json_extract(json, '$.status') = 'abierta' ORDER BY id DESC LIMIT 1`).get() as { json: string } | undefined
  return row ? (JSON.parse(row.json) as CashSession) : undefined
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

export function insertMovement(db: Database.Database, out: Out, m: NewMovement): CashMovement & { id: number } {
  const amount = round2(m.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0')
  const now = new Date()
  const row: Omit<CashMovement, 'id'> = {
    ...m,
    amount,
    date: now.toISOString(),
    dayKey: dayKeyOf(now),
    sessionId: m.sessionId ?? (m.caja === 'menor' ? openSession(db)?.id : undefined),
  }
  const saved = insertAutoRow(db, MOVEMENTS, row)
  out.push({ table: MOVEMENTS, op: 'put', data: saved })
  return saved
}

export function requireFunds(db: Database.Database, caja: CajaId, amount: number): void {
  const available = cajaBalance(db, caja)
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
export function registerMovement(db: Database.Database, out: Out, input: MovementInput): CashMovement {
  if (!isCaja(input.caja)) throw new Error('Caja inválida')
  if (input.direction !== 'in' && input.direction !== 'out') throw new Error('Indica si es ingreso o egreso')
  const concept = (input.concept ?? '').trim()
  if (!concept) throw new Error('Escribe el concepto del movimiento')
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('El monto debe ser mayor a 0')
  if (input.direction === 'out') requireFunds(db, input.caja, amount)
  return insertMovement(db, out, {
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
export function transferFunds(db: Database.Database, out: Out, input: TransferInput): { transferId: string } {
  if (!isCaja(input.from) || !isCaja(input.to) || input.from === input.to) throw new Error('Elige dos cajas distintas')
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('El monto a trasladar debe ser mayor a 0')
  requireFunds(db, input.from, amount)
  const transferId = randomUUID()
  const by = input.by?.trim() || undefined
  insertMovement(db, out, { caja: input.from, direction: 'out', type: 'traslado_salida', amount, concept: `Traslado a ${CAJA_LABEL[input.to]}`, transferId, by })
  insertMovement(db, out, { caja: input.to, direction: 'in', type: 'traslado_entrada', amount, concept: `Traslado desde ${CAJA_LABEL[input.from]}`, transferId, by })
  return { transferId }
}

/** First ever opening = the starting point of the books: the counted cash becomes the Caja Menor's
 * "base inicial" and, optionally, the Caja Mayor starts with what is in the safe and the banks.
 * Sales from before the cajas existed are deliberately not back-filled — their cash was already
 * handled outside this ledger, so re-creating it would only invent phantom shortages. */
export function isFirstOpening(db: Database.Database): boolean {
  return !db.prepare(`SELECT 1 FROM ${SESSIONS} LIMIT 1`).get()
}

/** Opens the Caja Menor workday by counting what is physically in the drawer; any gap against
 * the ledger is booked as an explicit arqueo adjustment instead of silently disappearing. */
export function openCaja(db: Database.Database, out: Out, input: { countedCash: number; by: string; mayorInitial?: number }): CashSession {
  const counted = round2(input.countedCash)
  if (!Number.isFinite(counted) || counted < 0) throw new Error('Cuenta el efectivo de la caja (no puede ser negativo)')
  const by = (input.by ?? '').trim()
  if (!by) throw new Error('Indica quién abre la caja')
  const already = openSession(db)
  if (already) throw new Error(`Ya hay una caja abierta (desde el ${already.dayKey}). Ciérrala antes de abrir otra.`)
  const first = isFirstOpening(db)
  const mayorInitial = round2(input.mayorInitial ?? 0)
  if (!Number.isFinite(mayorInitial) || mayorInitial < 0) throw new Error('El saldo inicial de la Caja Mayor no es válido')
  if (mayorInitial > 0 && !first) throw new Error('El saldo inicial de la Caja Mayor solo se registra en la primera apertura. Después usa un ingreso o un traslado.')

  const system = cajaBalance(db, 'menor')
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
  const session = insertAutoRow(db, SESSIONS, base)
  out.push({ table: SESSIONS, op: 'put', data: session })
  if (diff !== 0) {
    insertMovement(db, out, {
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
    insertMovement(db, out, { caja: 'mayor', direction: 'in', type: 'ingreso', amount: mayorInitial, concept: 'Saldo inicial de Caja Mayor (caja fuerte y bancos)', by })
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
export function closeOpenSession(db: Database.Database, out: Out, patch: CloseSessionPatch): CashSession | undefined {
  const s = openSession(db)
  if (!s) return undefined
  const updated: CashSession = { ...s, status: 'cerrada', closedAt: new Date().toISOString(), ...patch }
  putRow(db, SESSIONS, 'id', s.id, {}, updated)
  out.push({ table: SESSIONS, op: 'put', data: updated })
  return updated
}

/** Books the arqueo gap found at closing so the ledger matches what was counted. */
export function recordArqueoAdjustment(db: Database.Database, out: Out, diff: number, by: string): void {
  const d = round2(diff)
  if (d === 0) return
  insertMovement(db, out, {
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
export function recordSaleReceipt(db: Database.Database, out: Out, sale: Sale & { id: number }): void {
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || sale.total <= 0) return
  insertMovement(db, out, { ...receiptTarget(sale.payMethod), direction: 'in', type: 'venta', amount: sale.total, concept: `Venta ${formatSaleId(sale.id)}`, refType: 'sale', refId: sale.id })
}

/** Correcting an invoice changes what was collected; the difference goes through the ledger, in
 * the same caja the original payment went to. */
export function recordSaleCorrection(db: Database.Database, out: Out, sale: Sale & { id: number }, totalDiff: number): void {
  const diff = round2(totalDiff)
  if ((sale.payMethod !== 'efectivo' && sale.payMethod !== 'transferencia') || diff === 0) return
  insertMovement(db, out, {
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
export function recordFiadoCollection(db: Database.Database, out: Out, sale: Sale & { id: number }, amount: number, method: CollectMethod = 'efectivo'): void {
  if (!(amount > 0)) return
  if (method !== 'efectivo' && method !== 'transferencia') throw new Error('Medio de pago inválido')
  const who = sale.fiadoName || sale.customerName || 'cliente'
  insertMovement(db, out, { ...receiptTarget(method), direction: 'in', type: 'abono_fiado', amount, concept: `Abono de fiado · ${who} (${formatSaleId(sale.id)})`, refType: 'sale', refId: sale.id })
}
