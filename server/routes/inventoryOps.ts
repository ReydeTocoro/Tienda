import { Router } from 'express'
import type { Product } from '../../src/types/product'
import type { ParsedImportRow, DupAction } from '../../src/features/inventory/lib/importProducts'
import type { Db } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { reviveKey } from '../domain/productCode'
import { looseUnitCost } from '../domain/secrets'
import { logStock, stockEntry, type StockEntry } from '../domain/stockAudit'
import { getRow, getRowsByKey, putRow, roundQty, setStocks, text } from './generic'
import { HttpError, handle } from './http'

const MAX_IMPORT_ROWS = 3000
const MAX_COUNT_ROWS = 5000
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
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (!(Number(qty) > 0) || !Number.isInteger(Number(qty))) throw new Error('Indica cuántos paquetes abrir')
        if (qty > p.stock) throw new Error(`Solo tienes ${p.stock} paquete${p.stock !== 1 ? 's' : ''}`)

        const nuevasSueltas = qty * (p.unidadesPor || 1)
        await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - qty })
        const opened = `${qty} paquete${qty !== 1 ? 's' : ''}`
        const audit = [stockEntry(p, p.stock, p.stock - qty, `Se abrió ${opened} → ${nuevasSueltas} unidades sueltas`, by, 'paquete')]

        const suelta = p.codigoSuelta ? await getRow<Product>(q, 'products', 'code', p.codigoSuelta) : undefined
        if (suelta) {
          await putRow(q, 'products', 'code', suelta.code, { ...suelta, stock: (suelta.stock || 0) + nuevasSueltas })
          audit.push(stockEntry(suelta, suelta.stock || 0, (suelta.stock || 0) + nuevasSueltas, `Salieron de abrir ${opened} de ${p.name}`, by, 'paquete'))
        } else if (p.codigoSuelta) {
          const loose = await newLooseUnit(q, p, nuevasSueltas)
          await putRow(q, 'products', 'code', p.codigoSuelta, loose)
          audit.push(stockEntry(loose, 0, nuevasSueltas, `Salieron de abrir ${opened} de ${p.name}`, by, 'paquete'))
        }
        await logStock(q, audit)
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
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete || !p.codigoSuelta) throw new Error('El producto no es un paquete')

        const audit: StockEntry[] = []
        let suelta = await getRow<Product>(q, 'products', 'code', p.codigoSuelta)
        if (!suelta || suelta.stock <= 0) {
          if (p.stock <= 0) throw new Error('Sin unidades sueltas ni paquetes')
          const nuevas = p.unidadesPor || 1
          await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - 1 })
          audit.push(stockEntry(p, p.stock, p.stock - 1, `Se abrió 1 paquete → ${nuevas} unidades sueltas (para vender una)`, by, 'paquete'))
          const looseBefore = suelta?.stock || 0
          suelta = suelta ? { ...suelta, stock: looseBefore + nuevas } : await newLooseUnit(q, p, nuevas)
          await putRow(q, 'products', 'code', suelta.code, suelta)
          audit.push(stockEntry(suelta, looseBefore, suelta.stock, `Salieron de abrir 1 paquete de ${p.name}`, by, 'paquete'))
        }
        const left = Math.max(0, (suelta.stock || 0) - 1)
        await putRow(q, 'products', 'code', suelta.code, { ...suelta, stock: left })
        audit.push(stockEntry(suelta, suelta.stock || 0, left, 'Vendida 1 unidad suelta desde Stock (no pasó por la caja)', by, 'paquete'))
        await logStock(q, audit)
      })
    }),
  )

  /** "Vender paquete completo". */
  router.post(
    '/sell-whole-package',
    handle(async (req) => {
      const { code } = (req.body ?? {}) as { code: string }
      await db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        const p = await getRow<Product>(q, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (p.stock <= 0) throw new Error('No hay paquetes disponibles')
        await putRow(q, 'products', 'code', code, { ...p, stock: p.stock - 1 })
        await logStock(q, [stockEntry(p, p.stock, p.stock - 1, 'Vendido 1 paquete completo desde Stock (no pasó por la caja)', by, 'paquete')])
      })
    }),
  )

  /** Apply conteo cíclico differences, logging each one to the audit trail. */
  router.post(
    '/cyclic-count',
    handle(async (req) => {
      const { adjustments } = (req.body ?? {}) as { adjustments: Array<{ code: string; counted: number; reason: string }> }
      if (!Array.isArray(adjustments)) throw new HttpError(400, 'No hay ajustes para aplicar')
      if (adjustments.length > MAX_COUNT_ROWS) throw new HttpError(400, `Aplica hasta ${MAX_COUNT_ROWS.toLocaleString('es-CO')} ajustes por vez (hay ${adjustments.length.toLocaleString('es-CO')}): hazlo en partes`)
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.ajustar')
        // Same shape as the bulk entries: one trip to read the products, the arithmetic here, one trip each
        // to write the stocks and the audit entries (a code that appears twice is counted in order).
        const products = await getRowsByKey<Product>(q, 'products', 'code', adjustments.map((a) => String(a?.code ?? '')))
        const stock = new Map([...products].map(([code, p]) => [code, p.stock || 0]))
        const entries: StockEntry[] = []
        const date = new Date().toISOString()
        for (const a of adjustments) {
          const code = String(a?.code ?? '')
          const p = products.get(code)
          if (!p) continue
          const counted = roundQty(nonNegative(a.counted))
          const before = stock.get(code)!
          const diff = counted - before
          if (diff === 0) continue
          stock.set(code, counted)
          entries.push(stockEntry(p, before, counted, text(a.reason, 200) || 'Conteo cíclico', by, undefined, date))
        }
        await setStocks(q, [...new Set(entries.map((e) => e.code))].map((code) => ({ code, stock: stock.get(code)! })))
        await logStock(q, entries)
        return { applied: entries.length }
      })
    }),
  )

  /** Commit a previewed import. Imports carry purchase prices, so `stock.importar` also includes
   * `costos.ver` (src/shared/lib/permissions.ts). */
  router.post(
    '/import',
    handle(async (req) => {
      const { parsed, dupAction } = (req.body ?? {}) as { parsed: ParsedImportRow[]; dupAction: DupAction }
      if (!Array.isArray(parsed)) throw new HttpError(400, 'El archivo no tiene filas válidas')
      // Every row costs a few queries in one transaction that holds the write lock, and the Function stops at 60 s:
      // more rows than fit would fail after a minute of nobody being able to sell.
      if (parsed.length > MAX_IMPORT_ROWS) throw new HttpError(400, `Importa hasta ${MAX_IMPORT_ROWS.toLocaleString('es-CO')} filas por archivo (este tiene ${parsed.length.toLocaleString('es-CO')}): divídelo en partes`)
      return db.tx(async (q) => {
        const by = await requireNeed(q, await actorOf(q, authOf(req)), 'stock.importar')
        let added = 0
        let updated = 0
        let skipped = 0
        const audit: StockEntry[] = []

        for (const raw of parsed) {
          const row = {
            code: text(raw?.code, 60),
            name: text(raw?.name, 120),
            brand: text(raw?.brand, 60),
            cat: text(raw?.cat, 60),
            unit: text(raw?.unit, 20),
            price: nonNegative(raw?.price),
            price2: nonNegative(raw?.price2),
            price3: nonNegative(raw?.price3),
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
              if (after !== before) audit.push(stockEntry({ code: row.code, name: row.name || existing.name }, before, after, 'Importación CSV/Excel (solo stock)', by, 'importacion'))
              updated++
              continue
            }
            const merged: Product = { ...existing }
            if (row.name) merged.name = row.name
            if (row.brand) merged.brand = row.brand
            if (row.cat) merged.cat = row.cat
            if (row.unit && row.unit !== 'unidad') merged.unit = row.unit
            if (row.price > 0) merged.price = row.price
            if (row.price2 > 0) merged.price2 = row.price2
            if (row.price3 > 0) merged.price3 = row.price3
            if (row.cost > 0) merged.cost = row.cost
            if (row.stock > 0) merged.stock = roundQty(row.stock)
            if (row.min > 0) merged.min = row.min
            await putRow(q, 'products', 'code', row.code, merged)
            // Replacing the stock leaves the same trace as adding to it ("solo stock" above).
            const before = existing.stock || 0
            const after = merged.stock || 0
            if (after !== before) audit.push(stockEntry(merged, before, after, 'Importación CSV/Excel (actualizar)', by, 'importacion'))
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
              ...(row.price2 > 0 ? { price2: row.price2 } : {}),
              ...(row.price3 > 0 ? { price3: row.price3 } : {}),
              cost: row.cost,
              stock: row.stock,
              min: row.min,
              esPaquete: false,
              createdAt: new Date().toISOString(),
            }
            await putRow(q, 'products', 'code', row.code, newProduct)
            await reviveKey(q, row.code)
            if (newProduct.stock > 0) audit.push(stockEntry(newProduct, 0, newProduct.stock, 'Importación CSV/Excel (producto nuevo)', by, 'importacion'))
            added++
          }
        }
        await logStock(q, audit)
        return { added, updated, skipped }
      })
    }),
  )

  return router
}
