import type Database from 'better-sqlite3'
import type { Cierre, Cuadre } from '../../src/types/cierre'
import type { Sale } from '../../src/types/sale'
import type { CashMovement } from '../../src/types/cash'
import type { DayAggregate } from '../../src/shared/lib/aggregation'
import { round2 } from '../../src/shared/lib/cash'
import { getRow, insertAutoRow, putRow } from '../routes/generic'
import { cajaBalance, closeOpenSession, openSession, recordArqueoAdjustment, transferFunds, type Out } from './cash'

export interface ConfirmCierreInput {
  dayKey: string
  cajero: string
  notas: string
  efectivoFisico: number
  /** Cash to move from the Caja Menor to the Caja Mayor as part of closing. */
  trasladar?: number
  aggregate: DayAggregate
}

/** Non-destructive Cierre Z (plan decision 2): archives a summary row and marks that day's
 * still-open sales and cash movements with `closedInCierreId` — never deletes them. It is also
 * the end of the Caja Menor workday: the expected cash is the ledger balance (computed here, not
 * trusted from the client), any gap against the counted cash is booked as an arqueo adjustment,
 * and the optional transfer to the Caja Mayor happens in the same transaction. */
export function confirmCierre(db: Database.Database, out: Out, input: ConfirmCierreInput): Cierre {
  const { aggregate } = input
  const cajero = (input.cajero ?? '').trim()
  if (!cajero) throw new Error('Ingresa el nombre del cajero')
  const fisico = round2(input.efectivoFisico)
  if (!Number.isFinite(fisico) || fisico < 0) throw new Error('El efectivo contado no es válido')
  const traslado = round2(input.trasladar ?? 0)
  if (traslado < 0 || traslado > fisico + 0.005) throw new Error('No puedes trasladar más efectivo del que contaste')

  const efectivoSistema = cajaBalance(db, 'menor')
  const diferencia = round2(fisico - efectivoSistema)
  const cuadre: Cuadre = diferencia === 0 ? 'perfecto' : diferencia > 0 ? 'sobrante' : 'faltante'

  const cierreBase: Omit<Cierre, 'id'> = {
    tipo: 'Z',
    fecha: input.dayKey,
    cajero,
    cerradoEn: new Date().toISOString(),
    totalVentas: aggregate.totalVentas,
    totalGanancia: aggregate.totalGanancia,
    numTx: aggregate.numTx,
    totalExIn: aggregate.totalExIn,
    totalExOut: aggregate.totalExOut,
    netDay: aggregate.netDay,
    payBreak: aggregate.payBreak,
    arqueo: { efectivoSistema, efectivoFisico: fisico, diferencia, cuadre },
    traslado: traslado > 0 ? traslado : undefined,
    dejadoEnCaja: round2(fisico - traslado),
    sessionId: openSession(db)?.id,
    notas: input.notas?.trim() || undefined,
  }
  const saved = insertAutoRow(db, 'cierres', cierreBase)
  out.push({ table: 'cierres', op: 'put', data: saved })

  // The ledger now says exactly what was counted; then part of it can travel to the Caja Mayor.
  recordArqueoAdjustment(db, out, diferencia, cajero)
  if (traslado > 0) transferFunds(db, out, { from: 'menor', to: 'mayor', amount: traslado, by: cajero })
  closeOpenSession(db, out, { closedBy: cajero, expectedCash: efectivoSistema, countedCash: fisico, closeDiff: diferencia, transferred: traslado, cierreId: saved.id })

  for (const s of aggregate.ventasDay) {
    if (s.id === undefined) continue
    const row = getRow<Sale>(db, 'sales', 'id', s.id)
    if (!row) continue
    const u: Sale = { ...row, closedInCierreId: saved.id }
    putRow(db, 'sales', 'id', s.id, {}, u)
    out.push({ table: 'sales', op: 'put', data: u })
  }
  for (const m of aggregate.movementsDay) {
    if (m.id === undefined) continue
    const row = getRow<CashMovement>(db, 'cashMovements', 'id', m.id)
    if (!row) continue
    const u: CashMovement = { ...row, closedInCierreId: saved.id }
    putRow(db, 'cashMovements', 'id', m.id, {}, u)
    out.push({ table: 'cashMovements', op: 'put', data: u })
  }
  return saved
}
