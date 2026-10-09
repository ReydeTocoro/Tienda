import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { StockAuditEntry } from '../../src/types/auditLog'
import type { ParsedImportRow, DupAction } from '../../src/features/inventory/lib/importProducts'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { looseUnitCost } from '../domain/secrets'
import { getRow, putRow, insertAutoRow, roundQty } from './generic'
import { HttpError, handle } from './http'

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const nonNegative = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** The loose-unit product a package opens into, the first time it's opened. Its purchase price is
 * the package's split evenly — worked out here, from the costs the browser may not see. */
async function newLooseUnit(q: Parameters<typeof looseUnitCost>[0], p: Product, stock: number): Promise<Product> {
  return {
    code: p.codigoSuelta!,
    name: p.nombreSuelta || 'Unidad suelta',
    price: p.precioSuelta || 0,
    cost: await looseUnitCost(q, p.code, p.unidadesPor || 1),
    stock,
    min: p.min || 0,
    cat: p.cat || '',
    brand: p.brand || '',
    unit: 'unidad',
    esPaquete: false,
    esUnidadSuelta: true,
    codigoPaquete: p.code,
    nombrePaquete: p.name,
  }
}

/** openPackage / sellLooseUnit / sellWholePackage / applyCyclicCountAdjustments / applyImport —
 * mounted at /api/inventory. Every one needs a permission of whoever is working. */
export function inventoryOpsRouter(db: Db) {
  const router = Router()

  /** Convert `qty` packages into loose units, creating the loose-unit sibling product the first
   * time it's opened. */
  router.post(
    '/open-package',
    handle(async (req) => {
      const { code, qty } = (req.body ?? {}) as { code: string; qty: number }
      return db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (!(Number(qty) > 0) || !Number.isInteger(Number(qty))) throw new Error('Indica cuántos paquetes abrir')
        if (qty > p.stock) throw new Error(`Solo tienes ${p.stock} paquete${p.stock !== 1 ? 's' : ''}`)

        const nuevasSueltas = qty * (p.unidadesPor || 1)
        await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - qty })

        const suelta = p.codigoSuelta ? await getRow<Product>(q, 'products', 'code', p.codigoSuelta) : undefined
        if (suelta) {
          await putRow(q, 'products', 'code', suelta.code, { ...suelta, stock: (suelta.stock || 0) + nuevasSueltas })
        } else if (p.codigoSuelta) {
          await putRow(q, 'products', 'code', p.codigoSuelta, await newLooseUnit(q, p, nuevasSueltas))
        }
        return { sueltaName: p.nombreSuelta || 'unidad', nuevasSueltas }
      })
    }),
  )

  /** "Vender unidad suelta" — auto-opens a package if no loose units remain. Not a POS sale — a
   * direct stock adjustment, same as the original. */
  router.post(
    '/sell-loose-unit',
    handle(async (req) => {
      const { code } = (req.body ?? {}) as { code: string }
      await db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete || !p.codigoSuelta) throw new Error('El producto no es un paquete')

        let suelta = await getRow<Product>(q, 'products', 'code', p.codigoSuelta)
        if (!suelta || suelta.stock <= 0) {
          if (p.stock <= 0) throw new Error('Sin unidades sueltas ni paquetes')
          const nuevas = p.unidadesPor || 1
          await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - 1 })
          suelta = suelta ? { ...suelta, stock: (suelta.stock || 0) + nuevas } : await newLooseUnit(q, p, nuevas)
          await putRow(q, 'products', 'code', suelta.code, suelta)
        }
        await putRow(q, 'products', 'code', suelta.code, { ...suelta, stock: Math.max(0, (suelta.stock || 0) - 1) })
      })
    }),
  )

  /** "Vender paquete completo". */
  router.post(
    '/sell-whole-package',
    handle(async (req) => {
      const { code } = (req.body ?? {}) as { code: string }
      await db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (p.stock <= 0) throw new Error('No hay paquetes disponibles')
        await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - 1 })
      })
    }),
  )

  /** Apply conteo cíclico differences, logging each one to the audit trail. */
  router.post(
    '/cyclic-count',
    handle(async (req) => {
      const { adjustments } = (req.body ?? {}) as { adjustments: Array<{ code: string; counted: number; reason: string }> }
      if (!Array.isArray(adjustments)) throw new HttpError(400, 'No hay ajustes para aplicar')
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        let applied = 0
        for (const a of adjustments) {
          const p = await getRow<Product>(q, 'products', 'code', a?.code)
          if (!p) continue
          const counted = roundQty(nonNegative(a.counted))
          const before = p.stock || 0
          const diff = counted - before
          if (diff === 0) continue
          await putRow(q, 'products', 'code', a.code, { ...p, stock: counted })

          const entry: Omit<StockAuditEntry, 'id'> = {
            type: diff < 0 ? 'merma' : 'ajuste',
            date: new Date().toISOString(),
            code: a.code,
            name: p.name,
            before,
            after: counted,
            diff,
            reason: text(a.reason, 200),
            user: by,
          }
          await insertAutoRow(q, 'auditLog', entry)
          applied++
        }
        return { applied }
      })
    }),
  )

  /** Commit a previewed import. Imports carry purchase prices, so `stock.importar` also includes
   * `costos.ver` (src/shared/lib/permissions.ts). */
  router.post(
    '/import',
    handle(async (req) => {
      const { parsed, dupAction } = (req.body ?? {}) as { parsed: ParsedImportRow[]; dupAction: DupAction }
      if (!Array.isArray(parsed) || parsed.length > 20_000) throw new HttpError(400, 'El archivo no tiene filas válidas')
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.importar')
        let added = 0
        let updated = 0
        let skipped = 0

        for (const raw of parsed) {
          const row = {
            code: text(raw?.code, 60),
            name: text(raw?.name, 120),
            brand: text(raw?.brand, 60),
            cat: text(raw?.cat, 60),
            unit: text(raw?.unit, 20),
            price: nonNegative(raw?.price),
            cost: nonNegative(raw?.cost),
            stock: nonNegative(raw?.stock),
            min: nonNegative(raw?.min),
          }
          if (!row.code) {
            skipped++
            continue
          }
          const existing = await getRow<Product>(q, 'products', 'code', row.code)
          if (existing) {
            if (dupAction === 'skip') {
              skipped++
              continue
            }
            if (dupAction === 'stock_only') {
              const before = existing.stock || 0
              const after = roundQty(before + row.stock)
              await putRow(q, 'products', 'code', row.code, { ...existing, stock: after })

              const entry: Omit<StockAuditEntry, 'id'> = {
                type: 'importacion',
                date: new Date().toISOString(),
                code: row.code,
                name: row.name || existing.name,
                before,
                after,
                diff: row.stock,
                reason: 'Importación CSV/Excel (solo stock)',
                user: by,
              }
              await insertAutoRow(q, 'auditLog', entry)
              updated++
              continue
            }
            const merged: Product = { ...existing }
            if (row.name) merged.name = row.name
            if (row.brand) merged.brand = row.brand
            if (row.cat) merged.cat = row.cat
            if (row.unit && row.unit !== 'unidad') merged.unit = row.unit
            if (row.price > 0) merged.price = row.price
            if (row.cost > 0) merged.cost = row.cost
            if (row.stock > 0) merged.stock = row.stock
            if (row.min > 0) merged.min = row.min
            await putRow(q, 'products', 'code', row.code, merged)
            updated++
          } else {
            if (!row.name) {
              skipped++
              continue
            }
            const newProduct: Product = {
              code: row.code,
              name: row.name,
              brand: row.brand,
              cat: row.cat,
              unit: row.unit || 'unidad',
              price: row.price,
              cost: row.cost,
              stock: row.stock,
              min: row.min,
              esPaquete: false,
              createdAt: new Date().toISOString(),
            }
            await putRow(q, 'products', 'code', row.code, newProduct)
            added++
          }
        }
        return { added, updated, skipped }
      })
    }),
  )

  return router
}
