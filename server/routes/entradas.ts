import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Product } from '../../src/types/product'
import type { EntradaRecord } from '../../src/types/entrada'
import { getRow, putRow, insertAutoRow, errorMessage } from './generic'
import { broadcast, type BroadcastMsg } from '../broadcast'

const TABLE = 'entradas'

/** legacy confirmarEntrada()/msFinalize() (repositories/entradas.ts). */
export function entradasRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (req, res) => {
    const limit = Number(req.query.limit) || 50
    const rows = db.prepare(`SELECT json FROM ${TABLE} ORDER BY id DESC LIMIT ?`).all(limit) as { json: string }[]
    res.json(rows.map((r) => JSON.parse(r.json) as EntradaRecord))
  })

  /** Single-item restock. */
  router.post('/', (req, res) => {
    const { code, qty, source } = req.body as { code: string; qty: number; source?: string }
    try {
      const { saved, broadcasts } = db.transaction(() => {
        const p = getRow<Product>(db, 'products', 'code', code)
        if (!p) throw new Error('Producto no encontrado')
        const stockAntes = p.stock || 0
        const stockDespues = stockAntes + qty
        const updatedP: Product = { ...p, stock: stockDespues }
        putRow(db, 'products', 'code', code, {}, updatedP)
        const record: EntradaRecord = { code, name: p.name, qty, stockAntes, stockDespues, date: new Date().toISOString(), source }
        const saved = insertAutoRow(db, TABLE, record)
        const broadcasts: BroadcastMsg[] = [
          { table: 'products', op: 'put', data: updatedP },
          { table: TABLE, op: 'put', data: saved },
        ]
        return { saved, broadcasts }
      })()
      broadcasts.forEach(broadcast)
      res.status(201).json(saved)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** Bulk restock from "escaneo masivo" — legacy msFinalize(). Silently skips unknown codes,
   * same as the original (repositories/entradas.ts L24). */
  router.post('/bulk', (req, res) => {
    const { entries, source } = req.body as { entries: Array<{ code: string; qty: number }>; source?: string }
    const { totalUnidades, broadcasts } = db.transaction(() => {
      let totalUnidades = 0
      const broadcasts: BroadcastMsg[] = []
      for (const e of entries) {
        const p = getRow<Product>(db, 'products', 'code', e.code)
        if (!p) continue
        const stockAntes = p.stock || 0
        const stockDespues = stockAntes + e.qty
        const updatedP: Product = { ...p, stock: stockDespues }
        putRow(db, 'products', 'code', e.code, {}, updatedP)
        broadcasts.push({ table: 'products', op: 'put', data: updatedP })
        const record: EntradaRecord = { code: e.code, name: p.name, qty: e.qty, stockAntes, stockDespues, date: new Date().toISOString(), source: source ?? 'masivo' }
        const saved = insertAutoRow(db, TABLE, record)
        broadcasts.push({ table: TABLE, op: 'put', data: saved })
        totalUnidades += e.qty
      }
      return { totalUnidades, broadcasts }
    })()
    broadcasts.forEach(broadcast)
    res.json({ totalUnidades })
  })

  return router
}
