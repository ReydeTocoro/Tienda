import type { Cierre, Cuadre } from '../../src/types/cierre'
import type { Sale } from '../../src/types/sale'
import type { CashMovement } from '../../src/types/cash'
import type { Settings } from '../../src/types/settings'
import { computeDayAggregate } from '../../src/shared/lib/aggregation'
import { round2 } from '../../src/shared/lib/cash'
import type { Sql } from '../db'
import { getRow, insertAutoRow, putRow } from '../routes/generic'
import { cajaBalance, closeOpenSession, openSession, recordArqueoAdjustment, transferFunds } from './cash'
import { saleProfits } from './secrets'

export interface ConfirmCierreInput {
  dayKey: string
  cajero: string
  notas: string
  efectivoFisico: number
  /** Cash to move from the Caja Menor to the Caja Mayor as part of closing. */
  trasladar?: number
}

/** The day's figures as a Cierre Z closes them: the still-open sales (with their profit) and cash
 * movements of `dayKey`, computed here from the database — never taken from the browser, which may
 * not even be allowed to see them (blind count). */
export async function closingAggregate(sql: Sql, dayKey: string) {
  const sales = (await sql.query<{ data: Sale }>(`select data from sales where data ->> 'dayKey' = $1`, [dayKey])).map((r) => r.data)
  const profits = await saleProfits(sql, sales.map((s) => s.id).filter((id): id is number => id !== undefined))
  const movements = (await sql.query<{ data: CashMovement }>(`select data from "cashMovements" where data ->> 'dayKey' = $1`, [dayKey])).map((r) => r.data)
  return computeDayAggregate(dayKey, sales.map((s) => ({ ...s, ganancia: profits.get(s.id!) ?? 0 })), movements, { onlyOpen: true })
}

/** Non-destructive Cierre Z (plan decision 2): archives a summary row and marks that day's
 * still-open sales and cash movements with `closedInCierreId` — never deletes them. It is also
 * the end of the Caja Menor workday: the expected cash is the ledger balance, any gap against the
 * counted cash is booked as an arqueo adjustment, and the optional transfer to the Caja Mayor
 * happens in the same transaction. The base left in the drawer and the cashier's name are
 * remembered for the next close. */
export async function confirmCierre(sql: Sql, input: ConfirmCierreInput): Promise<Cierre> {
  const dayKey = typeof input?.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : ''
  if (!dayKey) throw new Error('La fecha del cierre no es válida')
  const cajero = (typeof input.cajero === 'string' ? input.cajero : '').trim().slice(0, 40)
  if (!cajero) throw new Error('Ingresa el nombre del cajero')
  const fisico = round2(input.efectivoFisico)
  if (!Number.isFinite(fisico) || fisico < 0) throw new Error('El efectivo contado no es válido')
  const traslado = round2(input.trasladar ?? 0)
  if (!Number.isFinite(traslado) || traslado < 0 || traslado > fisico + 0.005) throw new Error('No puedes trasladar más efectivo del que contaste')

  const aggregate = await closingAggregate(sql, dayKey)
  const session = await openSession(sql)
  if (!aggregate.ventasDay.length && !aggregate.movementsDay.length && !session) throw new Error('No hay movimientos en esa fecha')

  const efectivoSistema = await cajaBalance(sql, 'menor')
  const diferencia = round2(fisico - efectivoSistema)
  const cuadre: Cuadre = diferencia === 0 ? 'perfecto' : diferencia > 0 ? 'sobrante' : 'faltante'

  const cierreBase: Omit<Cierre, 'id'> = {
    tipo: 'Z',
    fecha: dayKey,
    cajero,
    cerradoEn: new Date().toISOString(),
    totalVentas: aggregate.totalVentas,
    // The table's trigger files this in "profits", out of the row Reporte reads.
    totalGanancia: aggregate.totalGanancia,
    numTx: aggregate.numTx,
    totalExIn: aggregate.totalExIn,
    totalExOut: aggregate.totalExOut,
    netDay: aggregate.netDay,
    payBreak: aggregate.payBreak,
    arqueo: { efectivoSistema, efectivoFisico: fisico, diferencia, cuadre },
    traslado: traslado > 0 ? traslado : undefined,
    dejadoEnCaja: round2(fisico - traslado),
    sessionId: session?.id,
    notas: typeof input.notas === 'string' ? input.notas.trim().slice(0, 300) || undefined : undefined,
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

  const settings = await getRow<Settings>(sql, 'settings', 'key', 'main')
  if (settings) await putRow(sql, 'settings', 'key', 'main', { ...settings, lastCajero: cajero, ...(traslado > 0 ? { cajaBase: round2(fisico - traslado) } : {}) })
  return saved
}
