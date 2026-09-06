import { db } from '../index'
import type { Cierre, Cuadre } from '../../types/cierre'
import type { DayAggregate } from '../../shared/lib/aggregation'

export async function listCierres(): Promise<Cierre[]> {
  return db.cierres.orderBy('id').reverse().toArray()
}

export interface ConfirmCierreInput {
  dayKey: string
  cajero: string
  notas: string
  efectivoFisico: number
  /** The `{ onlyOpen: true }` aggregate for this day — what's actually being closed. */
  aggregate: DayAggregate
}

/** Non-destructive Cierre Z (plan decision 2): archives a summary row in `cierres` and marks
 * that day's still-open sales/purchases/extras with `closedInCierreId` — it never deletes them
 * (legacy `confirmarCierreZ()`, index.html L6008-6067, used `sales = sales.filter(...)` to drop
 * the day's rows; here they stay queryable in Historial/Reporte forever). */
export async function confirmCierreZ(input: ConfirmCierreInput): Promise<Cierre> {
  const { aggregate } = input
  const efectivoSistema = aggregate.payBreak.efectivo
  const diferencia = input.efectivoFisico - efectivoSistema
  const cuadre: Cuadre = diferencia === 0 ? 'perfecto' : diferencia > 0 ? 'sobrante' : 'faltante'

  return db.transaction('rw', db.cierres, db.sales, db.purchases, db.extras, async () => {
    const cierre: Omit<Cierre, 'id'> = {
      tipo: 'Z',
      fecha: input.dayKey,
      cajero: input.cajero,
      cerradoEn: new Date().toISOString(),
      totalVentas: aggregate.totalVentas,
      totalGanancia: aggregate.totalGanancia,
      numTx: aggregate.numTx,
      totalCompras: aggregate.totalCompras,
      totalExIn: aggregate.totalExIn,
      totalExOut: aggregate.totalExOut,
      netDay: aggregate.netDay,
      payBreak: aggregate.payBreak,
      arqueo: { efectivoSistema, efectivoFisico: input.efectivoFisico, diferencia, cuadre },
      notas: input.notas || undefined,
    }
    const id = await db.cierres.add(cierre as Cierre)

    const saleIds = aggregate.ventasDay.map((s) => s.id).filter((v): v is number => v !== undefined)
    const purchaseIds = aggregate.comprasDay.map((p) => p.id).filter((v): v is number => v !== undefined)
    const extraIds = aggregate.extrasDay.map((e) => e.id).filter((v): v is number => v !== undefined)

    if (saleIds.length) await db.sales.where('id').anyOf(saleIds).modify({ closedInCierreId: id })
    if (purchaseIds.length) await db.purchases.where('id').anyOf(purchaseIds).modify({ closedInCierreId: id })
    if (extraIds.length) await db.extras.where('id').anyOf(extraIds).modify({ closedInCierreId: id })

    return { ...cierre, id }
  })
}
