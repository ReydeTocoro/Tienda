import type { Cierre, Cuadre } from '../../src/types/cierre'
import type { Sale } from '../../src/types/sale'
import type { CashMovement } from '../../src/types/cash'
import type { DayAggregate } from '../../src/shared/lib/aggregation'
import { round2 } from '../../src/shared/lib/cash'
import type { Sql } from '../db'
import { getRow, insertAutoRow, putRow } from '../routes/generic'
import { cajaBalance, closeOpenSession, openSession, recordArqueoAdjustment, transferFunds } from './cash'

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
export async function confirmCierre(sql: Sql, input: ConfirmCierreInput): Promise<Cierre> {
  const { aggregate } = input
  const cajero = (input.cajero ?? '').trim()
  if (!cajero) throw new Error('Ingresa el nombre del cajero')
  const fisico = round2(input.efectivoFisico)
  if (!Number.isFinite(fisico) || fisico < 0) throw new Error('El efectivo contado no es válido')
  const traslado = round2(input.trasladar ?? 0)
  if (traslado < 0 || traslado > fisico + 0.005) throw new Error('No puedes trasladar más efectivo del que contaste')

  const efectivoSistema = await cajaBalance(sql, 'menor')
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
    sessionId: (await openSession(sql))?.id,
    notas: input.notas?.trim() || undefined,
  }
  const saved = await insertAutoRow(sql, 'cierres', cierreBase)

  // The ledger now says exactly what was counted; then part of it can travel to the Caja Mayor.
  await recordArqueoAdjustment(sql, diferencia, cajero)
  if (traslado > 0) await transferFunds(sql, { from: 'menor', to: 'mayor', amount: traslado, by: cajero })
  await closeOpenSession(sql, { closedBy: cajero, expectedCash: efectivoSistema, countedCash: fisico, closeDiff: diferencia, transferred: traslado, cierreId: saved.id })

  for (const s of aggregate.ventasDay) {
    if (s.id === undefined) continue
    const row = await getRow<Sale>(sql, 'sales', 'id', s.id)
    if (!row) continue
    await putRow(sql, 'sales', 'id', s.id, { ...row, closedInCierreId: saved.id })
  }
  for (const m of aggregate.movementsDay) {
    if (m.id === undefined) continue
    const row = await getRow<CashMovement>(sql, 'cashMovements', 'id', m.id)
    if (!row) continue
    await putRow(sql, 'cashMovements', 'id', m.id, { ...row, closedInCierreId: saved.id })
  }
  return saved
}
