import { Router } from 'express'
import type { Product } from '../../src/types/product'
import { UNITS } from '../../src/types/unit'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { getRow, putRow, deleteRow, roundQty } from './generic'
import { HttpError, handle } from './http'

const TABLE = 'products'
const UNIT_VALUES = new Set(UNITS.map((u) => u.value))

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
function amount(v: unknown, label: string): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, `${label} no es válido`)
  return n
}

/** A product as the form sends it, reduced to the fields a product has. The loose-unit link
 * (`esUnidadSuelta`, `codigoPaquete`…) is only ever set by the server when a package is opened, so
 * it's kept from the stored row. The purchase price is handled apart (it needs `costos.ver`). */
function cleanProduct(raw: Record<string, unknown>, code: string, existing?: Product): Product {
  const name = text(raw.name, 120)
  if (!name) throw new HttpError(400, 'Escribe el nombre')
  const esPaquete = raw.esPaquete === true
  const unit = typeof raw.unit === 'string' && UNIT_VALUES.has(raw.unit) ? raw.unit : 'unidad'
  return {
    code,
    name,
    price: amount(raw.price ?? 0, 'El precio'),
    stock: roundQty(amount(raw.stock ?? 0, 'El stock')),
    min: amount(raw.min ?? 0, 'El mínimo'),
    cat: text(raw.cat, 60),
    brand: text(raw.brand, 60),
    unit,
    esPaquete,
    unidadesPor: esPaquete ? Math.max(1, Math.round(amount(raw.unidadesPor ?? 1, 'Las unidades por paquete'))) : undefined,
    codigoSuelta: esPaquete ? text(raw.codigoSuelta, 60) || undefined : undefined,
    nombreSuelta: esPaquete ? text(raw.nombreSuelta, 120) || undefined : undefined,
    precioSuelta: esPaquete ? amount(raw.precioSuelta ?? 0, 'El precio de la unidad suelta') : undefined,
    esUnidadSuelta: existing?.esUnidadSuelta,
    codigoPaquete: existing?.codigoPaquete,
    nombrePaquete: existing?.nombrePaquete,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
}

/** Every write runs in `db.tx`, which serializes writes — that's what keeps a "check then write"
 * like the duplicate-code guard below safe when two devices act at the same moment. Each one checks
 * the permission of whoever is working (server/domain/counter.ts). */
export function productsRouter(db: Db) {
  const router = Router()

  /** Rejects a code that already exists. Its purchase price is only taken from someone who may see
   * purchase prices. */
  router.post(
    '/',
    handle(async (req) => {
      const raw = (req.body ?? {}) as Record<string, unknown>
      const code = text(raw.code, 60)
      if (!code) throw new HttpError(400, 'Escribe el código')
      return db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        await requireNeed(q, actor, 'stock.editar')
        if (await getRow<Product>(q, TABLE, 'code', code)) throw new HttpError(409, 'Ese código ya existe')
        const product = cleanProduct(raw, code)
        const withCost = 'cost' in raw && allowed(actor, 'costos.ver') ? { ...product, cost: amount(raw.cost, 'El precio de compra') } : product
        // The table's trigger files the cost in "productCosts", out of the row everyone reads.
        await putRow(q, TABLE, 'code', code, withCost)
        return withCost
      })
    }, 201),
  )

  /** Full replace of an existing product; the code (the primary key) never changes. Without
   * `stock.ajustar` the stock stays as stored, and without `costos.ver` so does the purchase price. */
  router.put(
    '/:code',
    handle(async (req) => {
      const raw = (req.body ?? {}) as Record<string, unknown>
      return db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        await requireNeed(q, actor, 'stock.editar')
        const existing = await getRow<Product>(q, TABLE, 'code', req.params.code)
        if (!existing) throw new HttpError(404, 'Producto no encontrado')
        const product = cleanProduct(raw, existing.code, existing)
        if (!allowed(actor, 'stock.ajustar')) product.stock = existing.stock
        const withCost = 'cost' in raw && allowed(actor, 'costos.ver') ? { ...product, cost: amount(raw.cost, 'El precio de compra') } : product
        await putRow(q, TABLE, 'code', existing.code, withCost)
        return withCost
      })
    }),
  )

  /** adjustStock: signed delta, clamped at 0 (legacy `quickStock`). */
  router.post(
    '/:code/adjust-stock',
    handle(async (req) => {
      const delta = Number((req.body as { delta?: unknown })?.delta)
      if (!Number.isFinite(delta)) throw new HttpError(400, 'La cantidad no es válida')
      return db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
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
      await db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.eliminar')
        await deleteRow(q, TABLE, 'code', req.params.code)
      })
    }),
  )

  return router
}

