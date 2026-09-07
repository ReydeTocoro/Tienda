import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Cierre, Cuadre } from '../../src/types/cierre'
import type { Sale } from '../../src/types/sale'
import type { Purchase } from '../../src/types/purchase'
import type { Extra } from '../../src/types/extra'
import type { DayAggregate } from '../../src/shared/lib/aggregation'
import { listAll, getRow, putRow, insertAutoRow } from './generic'
import { broadcast, type BroadcastMsg } from '../broadcast'

const TABLE = 'cierres'

interface ConfirmCierreInput {
  dayKey: string
  cajero: string
  notas: string
  efectivoFisico: number
  aggregate: DayAggregate
}

/** Non-destructive Cierre Z (plan decision 2): archives a summary row and marks that day's
 * still-open sales/purchases/extras with `closedInCierreId` — never deletes them. Legacy
 * confirmarCierreZ() (repositories/cierres.ts L22-57). */
export function cierresRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Cierre>(db, TABLE))
  })

  router.post('/', (req, res) => {
    const input = req.body as ConfirmCierreInput
    const { aggregate } = input
    const efectivoSistema = aggregate.payBreak.efectivo
    const diferencia = input.efectivoFisico - efectivoSistema
    const cuadre: Cuadre = diferencia === 0 ? 'perfecto' : diferencia > 0 ? 'sobrante' : 'faltante'

    const { cierre, broadcasts } = db.transaction(() => {
      const cierreBase: Omit<Cierre, 'id'> = {
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
      const saved = insertAutoRow(db, TABLE, cierreBase)
      const broadcasts: BroadcastMsg[] = [{ table: TABLE, op: 'put', data: saved }]

      const saleIds = aggregate.ventasDay.map((s) => s.id).filter((v): v is number => v !== undefined)
      const purchaseIds = aggregate.comprasDay.map((p) => p.id).filter((v): v is number => v !== undefined)
      const extraIds = aggregate.extrasDay.map((e) => e.id).filter((v): v is number => v !== undefined)

      for (const id of saleIds) {
        const s = getRow<Sale>(db, 'sales', 'id', id)
        if (!s) continue
        const u: Sale = { ...s, closedInCierreId: saved.id }
        putRow(db, 'sales', 'id', id, {}, u)
        broadcasts.push({ table: 'sales', op: 'put', data: u })
      }
      for (const id of purchaseIds) {
        const p = getRow<Purchase>(db, 'purchases', 'id', id)
        if (!p) continue
        const u: Purchase = { ...p, closedInCierreId: saved.id }
        putRow(db, 'purchases', 'id', id, {}, u)
        broadcasts.push({ table: 'purchases', op: 'put', data: u })
      }
      for (const id of extraIds) {
        const e = getRow<Extra>(db, 'extras', 'id', id)
        if (!e) continue
        const u: Extra = { ...e, closedInCierreId: saved.id }
        putRow(db, 'extras', 'id', id, {}, u)
        broadcasts.push({ table: 'extras', op: 'put', data: u })
      }

      return { cierre: saved, broadcasts }
    })()

    broadcasts.forEach(broadcast)
    res.status(201).json(cierre)
  })

  return router
}
