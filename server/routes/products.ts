import { Router } from 'express'
import type { Product } from '../../src/types/product'
import { UNITS } from '../../src/types/unit'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, allowed, requireNeed } from '../domain/counter'
import { MAX_CODE, assertCodeFree, renameProduct, reviveKey } from '../domain/productCode'
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

/** A product code as typed: trimmed, there, and not longer than the column allows (never cut short, which could make it someone else's). */
function codeOf(v: unknown): string {
  const code = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  if (!code) throw new HttpError(400, 'Escribe el código')
  if (code.length > MAX_CODE) throw new HttpError(400, `El código es muy largo (máximo ${MAX_CODE} caracteres)`)
  return code
}

/** Precio 2 / Precio 3: an amount sets it; null, '' or 0 clears it. Absent keeps what's stored — a
 * screen from before these prices existed doesn't send them and must not wipe them by saving. */
function extraPrice(v: unknown, kept: number | undefined, label: string): number | undefined {
  if (v === undefined) return kept
  if (v === null || v === '') return undefined
  const n = amount(v, label)
  return n > 0 ? n : undefined
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
    price2: extraPrice(raw.price2, existing?.price2, 'El precio 2'),
    price3: extraPrice(raw.price3, existing?.price3, 'El precio 3'),
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
        await assertCodeFree(q, code)
        const product = cleanProduct(raw, code)
        const withCost = 'cost' in raw && allowed(actor, 'costos.ver') ? { ...product, cost: amount(raw.cost, 'El precio de compra') } : product
        // The table's trigger files the cost in "productCosts", out of the row everyone reads.
        await putRow(q, TABLE, 'code', code, withCost)
        await reviveKey(q, code)
        return withCost
      })
    }, 201),
  )

  /** Full replace of an existing product. A `code` in the body that differs from the one in the URL
   * changes the product's code (everything that points at it follows: server/domain/productCode.ts);
   * a body without one, or with the same, leaves it. Without `stock.ajustar` the stock stays as
   * stored, and without `costos.ver` so does the purchase price. */
  router.put(
    '/:code',
    handle(async (req) => {
      const raw = (req.body ?? {}) as Record<string, unknown>
      return db.tx(async (q) => {
        const actor = await actorOf(q, authOf(req))
        const by = await requireNeed(q, actor, 'stock.editar')
        const existing = await getRow<Product>(q, TABLE, 'code', req.params.code)
        if (!existing) throw new HttpError(404, 'Producto no encontrado')
        // The stored code as it is (an old one may carry spaces) is no change; anything else is a new code.
        const code = raw.code === undefined || raw.code === existing.code ? existing.code : codeOf(raw.code)
        const product = cleanProduct(raw, code, existing)
        if (!allowed(actor, 'stock.ajustar')) product.stock = existing.stock
        const withCost = 'cost' in raw && allowed(actor, 'costos.ver') ? { ...product, cost: amount(raw.cost, 'El precio de compra') } : product
        if (code === existing.code) await putRow(q, TABLE, 'code', existing.code, withCost)
        else await renameProduct(q, by, existing, withCost, code)
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

