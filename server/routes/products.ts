import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Product } from '../../src/types/product'
import { listAll, getRow, putRow, deleteRow, errorMessage, roundQty } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'products'

/** Every handler here runs fully synchronously (better-sqlite3 is synchronous end to end) —
 * that's what makes a "check then write" like the duplicate-code guard below safe without an
 * explicit transaction: Node never interleaves another request's handler in the middle of a
 * synchronous function, so the check and the write are atomic for free. */
export function productsRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Product>(db, TABLE))
  })

  /** legacy addProduct: throws if the code already exists (repositories/products.ts L13-17). */
  router.post('/', (req, res) => {
    const product = req.body as Product
    if (!product?.code) return res.status(400).json({ error: 'code es requerido' })
    if (getRow<Product>(db, TABLE, 'code', product.code)) {
      return res.status(409).json({ error: 'Ese código ya existe' })
    }
    putRow(db, TABLE, 'code', product.code, {}, product)
    broadcast({ table: TABLE, op: 'put', data: product })
    res.status(201).json(product)
  })

  /** updateProduct/upsertProduct: full replace, code (the PK) never changes. */
  router.put('/:code', (req, res) => {
    const product = req.body as Product
    putRow(db, TABLE, 'code', req.params.code, {}, product)
    broadcast({ table: TABLE, op: 'put', data: product })
    res.json(product)
  })

  /** adjustStock: signed delta, clamped at 0 (legacy `quickStock`). */
  router.post('/:code/adjust-stock', (req, res) => {
    const { delta } = req.body as { delta: number }
    try {
      const updated = db.transaction(() => {
        const p = getRow<Product>(db, TABLE, 'code', req.params.code)
        if (!p) throw new Error('Producto no encontrado')
        const next = roundQty(Math.max(0, (p.stock || 0) + delta))
        const u: Product = { ...p, stock: next }
        putRow(db, TABLE, 'code', req.params.code, {}, u)
        return u
      })()
      broadcast({ table: TABLE, op: 'put', data: updated })
      res.json(updated)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.delete('/:code', (req, res) => {
    deleteRow(db, TABLE, 'code', req.params.code)
    broadcast({ table: TABLE, op: 'delete', data: req.params.code })
    res.status(204).end()
  })

  return router
}
