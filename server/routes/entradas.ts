import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { EntradaRecord } from '../../src/types/entrada'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { getRow, putRow, insertAutoRow, roundQty } from './generic'
import { HttpError, handle } from './http'

const TABLE = 'entradas'

function quantity(v: unknown): number {
  const n = roundQty(Number(v))
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new HttpError(400, 'La cantidad no es válida')
  return n
}

const source = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined)

/** Stock-in ("entradas de mercancía"), mounted at /api/entradas — needs `stock.entradas`. */
export function entradasRouter(db: Db) {
  const router = Router()

  /** Single-item restock. */
  router.post(
    '/',
    handle(async (req) => {
      const { code, qty: rawQty, source: rawSource } = (req.body ?? {}) as { code: string; qty: number; source?: string }
      const qty = quantity(rawQty)
      return db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.entradas')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p) throw new Error('Producto no encontrado')
        const stockAntes = p.stock || 0
        const stockDespues = roundQty(stockAntes + qty)
        await putRow(q, 'products', 'code', code, { ...p, stock: stockDespues })
        const record: EntradaRecord = { code, name: p.name, qty, stockAntes, stockDespues, date: new Date().toISOString(), source: source(rawSource) }
        return insertAutoRow(q, TABLE, record)
      })
    }, 201),
  )

  /** Bulk restock from "escaneo masivo". Silently skips unknown codes, same as the original. */
  router.post(
    '/bulk',
    handle(async (req) => {
      const { entries, source: rawSource } = (req.body ?? {}) as { entries: Array<{ code: string; qty: number }>; source?: string }
      if (!Array.isArray(entries) || entries.length > 5000) throw new HttpError(400, 'No hay entradas para registrar')
      const clean = entries.map((e) => ({ code: String(e?.code ?? ''), qty: quantity(e?.qty) }))
      return db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.entradas')
        let totalUnidades = 0
        for (const e of clean) {
          const p = await getRow<Product>(q, 'products', 'code', e.code)
          if (!p) continue
          const stockAntes = p.stock || 0
          const stockDespues = roundQty(stockAntes + e.qty)
          await putRow(q, 'products', 'code', e.code, { ...p, stock: stockDespues })
          const record: EntradaRecord = { code: e.code, name: p.name, qty: e.qty, stockAntes, stockDespues, date: new Date().toISOString(), source: source(rawSource) ?? 'masivo' }
          await insertAutoRow(q, TABLE, record)
          totalUnidades += e.qty
        }
        return { totalUnidades }
      })
    }),
  )

  return router
}
