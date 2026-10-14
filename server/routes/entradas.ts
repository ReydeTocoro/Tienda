import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { EntradaRecord } from '../../src/types/entrada'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { logStock, stockEntry, type StockEntry } from '../domain/stockAudit'
import { getRow, getRowsByKey, putRow, insertAutoRow, insertAutoRows, roundQty, setStocks } from './generic'
import { HttpError, handle } from './http'

const TABLE = 'entradas'
const MAX_BULK_ENTRIES = 5000

function quantity(v: unknown): number {
  const n = roundQty(Number(v))
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new HttpError(400, 'La cantidad no es válida')
  return n
}

const source = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined)

/** What the audit trail says of a stock-in, by where it came from. */
const entradaReason = (s: string | undefined) => (s === 'masivo' ? 'Entrada de mercancía (escaneo masivo)' : s ? `Entrada de mercancía (${s})` : 'Entrada de mercancía')

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
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.entradas')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p) throw new Error('Producto no encontrado')
        const stockAntes = p.stock || 0
        const stockDespues = roundQty(stockAntes + qty)
        await putRow(q, 'products', 'code', code, { ...p, stock: stockDespues })
        const record: EntradaRecord = { code, name: p.name, qty, stockAntes, stockDespues, date: new Date().toISOString(), source: source(rawSource) }
        await logStock(q, [stockEntry(p, stockAntes, stockDespues, entradaReason(record.source), by, 'entrada', record.date)])
        return insertAutoRow(q, TABLE, record)
      })
    }, 201),
  )

  /** Bulk restock from "escaneo masivo". Silently skips unknown codes, same as the original. */
  router.post(
    '/bulk',
    handle(async (req) => {
      const { entries, source: rawSource } = (req.body ?? {}) as { entries: Array<{ code: string; qty: number }>; source?: string }
      if (!Array.isArray(entries)) throw new HttpError(400, 'No hay entradas para registrar')
      if (entries.length > MAX_BULK_ENTRIES) throw new HttpError(400, `Registra hasta ${MAX_BULK_ENTRIES.toLocaleString('es-CO')} productos por vez (hay ${entries.length.toLocaleString('es-CO')}): hazlo en partes`)
      const clean = entries.map((e) => ({ code: String(e?.code ?? ''), qty: quantity(e?.qty) }))
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.entradas')
        // Every product in one trip, the arithmetic here (a code that appears twice adds up in order, each
        // record showing the stock before and after it), and the stocks and records written in one trip each —
        // a trip per product made a scan of fifty products wait for a hundred and fifty.
        const products = await getRowsByKey<Product>(q, 'products', 'code', clean.map((e) => e.code))
        const stock = new Map([...products].map(([code, p]) => [code, p.stock || 0]))
        const records: Array<Omit<EntradaRecord, 'id'>> = []
        const audit: StockEntry[] = []
        const date = new Date().toISOString()
        const from = source(rawSource) ?? 'masivo'
        let totalUnidades = 0
        for (const e of clean) {
          const p = products.get(e.code)
          if (!p) continue
          const stockAntes = stock.get(e.code)!
          const stockDespues = roundQty(stockAntes + e.qty)
          stock.set(e.code, stockDespues)
          records.push({ code: e.code, name: p.name, qty: e.qty, stockAntes, stockDespues, date, source: from })
          audit.push(stockEntry(p, stockAntes, stockDespues, entradaReason(from), by, 'entrada', date))
          totalUnidades += e.qty
        }
        await setStocks(q, [...new Set(records.map((r) => r.code))].map((code) => ({ code, stock: stock.get(code)! })))
        await insertAutoRows(q, TABLE, records)
        await logStock(q, audit)
        return { totalUnidades }
      })
    }),
  )

  return router
}
