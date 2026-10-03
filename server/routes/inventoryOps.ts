import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { StockAuditEntry } from '../../src/types/auditLog'
import type { ParsedImportRow, DupAction } from '../../src/features/inventory/lib/importProducts'
import type { Db } from '../db'
import { getRow, putRow, insertAutoRow } from './generic'
import { handle } from './http'

/** openPackage / sellLooseUnit / sellWholePackage / applyCyclicCountAdjustments / applyImport —
 * mounted at /api/inventory. Ported from repositories/inventoryOps.ts. */
export function inventoryOpsRouter(db: Db) {
  const router = Router()

  /** Convert `qty` packages into loose units, creating the loose-unit sibling product the first
   * time it's opened. Legacy confirmarAbrirPaquete() (repositories/inventoryOps.ts L8-42). */
  router.post(
    '/open-package',
    handle(async (req) => {
      const { code, qty } = req.body as { code: string; qty: number }
      return db.tx(async (q) => {
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (qty <= 0) throw new Error('Indica cuántos paquetes abrir')
        if (qty > p.stock) throw new Error(`Solo tienes ${p.stock} paquete${p.stock !== 1 ? 's' : ''}`)

        const nuevasSueltas = qty * (p.unidadesPor || 1)
        await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - qty })

        const suelta = p.codigoSuelta ? await getRow<Product>(q, 'products', 'code', p.codigoSuelta) : undefined
        if (suelta) {
          await putRow(q, 'products', 'code', suelta.code, { ...suelta, stock: (suelta.stock || 0) + nuevasSueltas })
        } else if (p.codigoSuelta) {
          const newSuelta: Product = {
            code: p.codigoSuelta,
            name: p.nombreSuelta || 'Unidad suelta',
            price: p.precioSuelta || 0,
            cost: p.cost > 0 ? +(p.cost / (p.unidadesPor || 1)).toFixed(2) : 0,
            stock: nuevasSueltas,
            min: p.min || 0,
            cat: p.cat || '',
            brand: p.brand || '',
            unit: 'unidad',
            esPaquete: false,
            esUnidadSuelta: true,
            codigoPaquete: p.code,
            nombrePaquete: p.name,
          }
          await putRow(q, 'products', 'code', newSuelta.code, newSuelta)
        }
        return { sueltaName: p.nombreSuelta || 'unidad', nuevasSueltas }
      })
    }),
  )

  /** "Vender unidad suelta" — auto-opens a package if no loose units remain. Legacy
   * veredaVenderUnidad() (repositories/inventoryOps.ts L47-82). Not a POS sale — a direct stock
   * adjustment, same as the original. */
  router.post(
    '/sell-loose-unit',
    handle(async (req) => {
      const { code } = req.body as { code: string }
      await db.tx(async (q) => {
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete || !p.codigoSuelta) throw new Error('El producto no es un paquete')

        let suelta = await getRow<Product>(q, 'products', 'code', p.codigoSuelta)
        if (!suelta || suelta.stock <= 0) {
          if (p.stock <= 0) throw new Error('Sin unidades sueltas ni paquetes')
          const nuevas = p.unidadesPor || 1
          await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - 1 })

          if (suelta) {
            suelta = { ...suelta, stock: (suelta.stock || 0) + nuevas }
          } else {
            suelta = {
              code: p.codigoSuelta,
              name: p.nombreSuelta || 'Unidad suelta',
              price: p.precioSuelta || 0,
              cost: p.cost > 0 ? +(p.cost / nuevas).toFixed(2) : 0,
              stock: nuevas,
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
          await putRow(q, 'products', 'code', suelta.code, suelta)
        }
        await putRow(q, 'products', 'code', suelta.code, { ...suelta, stock: Math.max(0, (suelta.stock || 0) - 1) })
      })
    }),
  )

  /** "Vender paquete completo" — legacy veredaVenderPaquete() (repositories/inventoryOps.ts
   * L85-92). */
  router.post(
    '/sell-whole-package',
    handle(async (req) => {
      const { code } = req.body as { code: string }
      await db.tx(async (q) => {
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (p.stock <= 0) throw new Error('No hay paquetes disponibles')
        await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - 1 })
      })
    }),
  )

  /** Apply conteo cíclico differences, logging each one to the audit trail — legacy
   * aplicarAjustesConteo() (repositories/inventoryOps.ts L102-128). */
  router.post(
    '/cyclic-count',
    handle(async (req) => {
      const { adjustments, user } = req.body as { adjustments: Array<{ code: string; counted: number; reason: string }>; user: string }
      return db.tx(async (q) => {
        let applied = 0
        for (const a of adjustments) {
          const p = await getRow<Product>(q, 'products', 'code', a.code)
          if (!p) continue
          const before = p.stock || 0
          const diff = a.counted - before
          if (diff === 0) continue
          await putRow(q, 'products', 'code', a.code, { ...p, stock: a.counted })

          const entry: Omit<StockAuditEntry, 'id'> = {
            type: diff < 0 ? 'merma' : 'ajuste',
            date: new Date().toISOString(),
            code: a.code,
            name: p.name,
            before,
            after: a.counted,
            diff,
            reason: a.reason,
            user,
          }
          await insertAutoRow(q, 'auditLog', entry)
          applied++
        }
        return { applied }
      })
    }),
  )

  /** Commit a previewed import — legacy confirmImport() (repositories/inventoryOps.ts
   * L137-204). */
  router.post(
    '/import',
    handle(async (req) => {
      const { parsed, dupAction } = req.body as { parsed: ParsedImportRow[]; dupAction: DupAction }
      return db.tx(async (q) => {
        let added = 0
        let updated = 0
        let skipped = 0

        for (const row of parsed) {
          const existing = await getRow<Product>(q, 'products', 'code', row.code)
          if (existing) {
            if (dupAction === 'skip') {
              skipped++
              continue
            }
            if (dupAction === 'stock_only') {
              const before = existing.stock || 0
              const after = before + row.stock
              await putRow(q, 'products', 'code', row.code, { ...existing, stock: after })

              const entry: Omit<StockAuditEntry, 'id'> = {
                type: 'importacion',
                date: new Date().toISOString(),
                code: row.code,
                name: row.name,
                before,
                after,
                diff: row.stock,
                reason: 'Importación CSV/Excel (solo stock)',
                user: 'Sistema',
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
