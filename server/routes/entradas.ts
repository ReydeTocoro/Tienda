import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { EntradaRecord } from '../../src/types/entrada'
import type { Db } from '../db'
import { getRow, putRow, insertAutoRow, roundQty } from './generic'
import { handle } from './http'

const TABLE = 'entradas'

/** legacy confirmarEntrada()/msFinalize() (repositories/entradas.ts). */
export function entradasRouter(db: Db) {
  const router = Router()

  /** Single-item restock. */
  router.post(
    '/',
    handle(async (req) => {
      const { code, qty, source } = req.body as { code: string; qty: number; source?: string }
      return db.tx(async (q) => {
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p) throw new Error('Producto no encontrado')
        const stockAntes = p.stock || 0
        const stockDespues = roundQty(stockAntes + qty)
        await putRow(q, 'products', 'code', code, { ...p, stock: stockDespues })
        const record: EntradaRecord = { code, name: p.name, qty, stockAntes, stockDespues, date: new Date().toISOString(), source }
        return insertAutoRow(q, TABLE, record)
      })
    }, 201),
  )

  /** Bulk restock from "escaneo masivo" — legacy msFinalize(). Silently skips unknown codes,
   * same as the original (repositories/entradas.ts L24). */
  router.post(
    '/bulk',
    handle(async (req) => {
      const { entries, source } = req.body as { entries: Array<{ code: string; qty: number }>; source?: string }
      return db.tx(async (q) => {
        let totalUnidades = 0
        for (const e of entries) {
          const p = await getRow<Product>(q, 'products', 'code', e.code)
          if (!p) continue
          const stockAntes = p.stock || 0
          const stockDespues = roundQty(stockAntes + e.qty)
          await putRow(q, 'products', 'code', e.code, { ...p, stock: stockDespues })
          const record: EntradaRecord = { code: e.code, name: p.name, qty: e.qty, stockAntes, stockDespues, date: new Date().toISOString(), source: source ?? 'masivo' }
          await insertAutoRow(q, TABLE, record)
          totalUnidades += e.qty
        }
        return { totalUnidades }
      })
    }),
  )

  return router
}
