import type { Sale, PayMethod } from '../../types/sale'
import type { CashMovement, MovementType } from '../../types/cash'
import { emptyTransferBreak, type TransferBreak } from './transferAccounts'

export type PayBreak = Record<PayMethod, number>

export interface DayAggregate {
  dayKey: string
  ventasDay: Sale[]
  /** Caja Menor movements of the day that aren't sales: extra income, fiado collections, expenses, supplier payments. */
  movementsDay: CashMovement[]
  totalVentas: number
  totalGanancia: number
  totalDescuentos: number
  numTx: number
  avgTicket: number
  totalExIn: number
  totalExOut: number
  netDay: number
  payBreak: PayBreak
  fiadoTotalDay: number
  /** What came in by transfer, account by account: the day's transfer sales, plus the transfer payments of fiados and
   * the ones handed back (those are movements of the Caja Mayor, which `movementsDay` leaves out). */
  transferBreak: TransferBreak
  /** The Caja Mayor movements behind `transferBreak`, so a Cierre Z can mark them as closed like the rest. */
  transferMovementsDay: CashMovement[]
  /** What actually landed in the register (efectivo + transferencia — fiado isn't cash yet). */
  cobradoReal: number
  /** netDay minus today's new fiado (money that's owed but not in hand). */
  flujoCaja: number
}

/** What counts as the day's cash flow besides sales (sales come from the sales table; transfers and
 * arqueo adjustments are internal bookkeeping, not business income or expense). */
const DAY_FLOW_TYPES = new Set<MovementType>(['ingreso', 'egreso', 'abono_fiado', 'pago_proveedor'])

export interface ComputeDayAggregateOptions {
  /** true = only rows not yet marked by a previous Cierre Z (used by the Cierre Z flow to
   * decide what it's about to close). false (default) = every row for that day regardless of
   * past cierres — what Reporte/Reporte X show, since Cierre Z is non-destructive (plan
   * decision 2: closed rows stay queryable forever). */
  onlyOpen?: boolean
}

/** THE single day-aggregation implementation shared by Reporte, Reporte X and Cierre Z —
 * replaces three independent copies of this math in the legacy app (index.html L4574-4750,
 * L5867-5918, L5941-6026). */
export function computeDayAggregate(
  dayKey: string,
  sales: Sale[],
  movements: CashMovement[],
  options: ComputeDayAggregateOptions = {},
): DayAggregate {
  const onlyOpen = options.onlyOpen ?? false
  const isOpen = (closedInCierreId?: number) => !onlyOpen || closedInCierreId == null

  // An annulled invoice is history: it is in no total, count or list of the day.
  const ventasDay = sales.filter((s) => s.dayKey === dayKey && !s.voided && isOpen(s.closedInCierreId))
  const movementsDay = movements.filter((m) => m.caja === 'menor' && m.dayKey === dayKey && DAY_FLOW_TYPES.has(m.type) && isOpen(m.closedInCierreId))

  // Sales are counted from the sales table (corrections and annulments already in their total), so only the payments
    // of fiados and the refunds of them are taken from the movements.
  const transferMovementsDay = movements.filter(
    (m) => m.medio === 'transferencia' && (m.type === 'abono_fiado' || m.type === 'egreso') && m.dayKey === dayKey && isOpen(m.closedInCierreId),
  )
  const transferBreak = emptyTransferBreak()
  for (const s of ventasDay) if (s.payMethod === 'transferencia') transferBreak[s.transferAccount ?? 'sin'] += s.total
  for (const m of transferMovementsDay) transferBreak[m.cuenta ?? 'sin'] += m.direction === 'in' ? m.amount : -m.amount

  const totalVentas = ventasDay.reduce((a, s) => a + s.total, 0)
  const totalGanancia = ventasDay.reduce((a, s) => a + (s.ganancia || 0), 0)
  const totalDescuentos = ventasDay.reduce((a, s) => a + (s.discount || 0), 0)
  const numTx = ventasDay.length
  const avgTicket = numTx ? totalVentas / numTx : 0

  const totalExIn = movementsDay.filter((m) => m.direction === 'in').reduce((a, m) => a + m.amount, 0)
  const totalExOut = movementsDay.filter((m) => m.direction === 'out').reduce((a, m) => a + m.amount, 0)

  const netDay = totalVentas + totalExIn - totalExOut

  const payBreak: PayBreak = { efectivo: 0, transferencia: 0, fiado: 0 }
  ventasDay.forEach((s) => {
    payBreak[s.payMethod] += s.total
  })
  const fiadoTotalDay = payBreak.fiado
  const cobradoReal = payBreak.efectivo + payBreak.transferencia
  const flujoCaja = netDay - fiadoTotalDay

  return {
    dayKey,
    ventasDay,
    movementsDay,
    transferBreak,
    transferMovementsDay,
    totalVentas,
    totalGanancia,
    totalDescuentos,
    numTx,
    avgTicket,
    totalExIn,
    totalExOut,
    netDay,
    payBreak,
    fiadoTotalDay,
    cobradoReal,
    flujoCaja,
  }
}
