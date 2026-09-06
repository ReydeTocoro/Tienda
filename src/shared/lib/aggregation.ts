import type { Sale, PayMethod } from '../../types/sale'
import type { Purchase } from '../../types/purchase'
import type { Extra } from '../../types/extra'

export type PayBreak = Record<PayMethod, number>

export interface DayAggregate {
  dayKey: string
  ventasDay: Sale[]
  comprasDay: Purchase[]
  extrasDay: Extra[]
  totalVentas: number
  totalGanancia: number
  totalDescuentos: number
  numTx: number
  avgTicket: number
  totalCompras: number
  totalExIn: number
  totalExOut: number
  netDay: number
  payBreak: PayBreak
  fiadoTotalDay: number
  /** What actually landed in the register (efectivo + transferencia — fiado isn't cash yet). */
  cobradoReal: number
  /** netDay minus today's new fiado (money that's owed but not in hand). */
  flujoCaja: number
}

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
  purchases: Purchase[],
  extras: Extra[],
  options: ComputeDayAggregateOptions = {},
): DayAggregate {
  const onlyOpen = options.onlyOpen ?? false
  const isOpen = (closedInCierreId?: number) => !onlyOpen || closedInCierreId == null

  const ventasDay = sales.filter((s) => s.dayKey === dayKey && isOpen(s.closedInCierreId))
  const comprasDay = purchases.filter((p) => p.dayKey === dayKey && isOpen(p.closedInCierreId))
  const extrasDay = extras.filter((e) => e.dayKey === dayKey && isOpen(e.closedInCierreId))

  const totalVentas = ventasDay.reduce((a, s) => a + s.total, 0)
  const totalGanancia = ventasDay.reduce((a, s) => a + (s.ganancia || 0), 0)
  const totalDescuentos = ventasDay.reduce((a, s) => a + (s.discount || 0), 0)
  const numTx = ventasDay.length
  const avgTicket = numTx ? totalVentas / numTx : 0

  const totalCompras = comprasDay.reduce((a, p) => a + p.total, 0)
  const totalExIn = extrasDay.filter((e) => e.type === 'ingreso').reduce((a, e) => a + e.amount, 0)
  const totalExOut = extrasDay.filter((e) => e.type === 'egreso').reduce((a, e) => a + e.amount, 0)

  const netDay = totalVentas + totalExIn - totalCompras - totalExOut

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
    comprasDay,
    extrasDay,
    totalVentas,
    totalGanancia,
    totalDescuentos,
    numTx,
    avgTicket,
    totalCompras,
    totalExIn,
    totalExOut,
    netDay,
    payBreak,
    fiadoTotalDay,
    cobradoReal,
    flujoCaja,
  }
}
