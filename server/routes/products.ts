import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { Db } from '../db'
import { getRow, putRow, deleteRow, roundQty } from './generic'
import { HttpError, handle } from './http'

const TABLE = 'products'

/** Every write runs in `db.tx`, which serializes writes — that's what keeps a "check then write"
 * like the duplicate-code guard below safe when two devices act at the same moment. */
export function productsRouter(db: Db) {
  const router = Router()

  /** legacy addProduct: rejects a code that already exists (repositories/products.ts L13-17). */
  router.post(
    '/',
    handle(async (req) => {
      const product = req.body as Product
      if (!product?.code) throw new HttpError(400, 'code es requerido')
      return db.tx(async (q) => {
        if (await getRow<Product>(q, TABLE, 'code', product.code)) throw new HttpError(409, 'Ese código ya existe')
        await putRow(q, TABLE, 'code', product.code, product)
        return product
      })
    }, 201),
  )

  /** updateProduct/upsertProduct: full replace, code (the PK) never changes. */
  router.put(
    '/:code',
    handle(async (req) => {
      const product = req.body as Product
      await db.tx((q) => putRow(q, TABLE, 'code', req.params.code, product))
      return product
    }),
  )

  /** adjustStock: signed delta, clamped at 0 (legacy `quickStock`). */
  router.post(
    '/:code/adjust-stock',
    handle(async (req) => {
      const { delta } = req.body as { delta: number }
      return db.tx(async (q) => {
        const p = await getRow<Product>(q, TABLE, 'code', req.params.code)
        if (!p) throw new Error('Producto no encontrado')
        const u: Product = { ...p, stock: roundQty(Math.max(0, (p.stock || 0) + delta)) }
        await putRow(q, TABLE, 'code', req.params.code, u)
        return u
      })
    }),
  )

  router.delete(
    '/:code',
    handle(async (req) => {
      await db.tx((q) => deleteRow(q, TABLE, 'code', req.params.code))
    }),
  )

  return router
}
