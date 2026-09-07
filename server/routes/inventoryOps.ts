import { Router } from 'express'
import type Database from 'better-sqlite3'
import type { Product } from '../../src/types/product'
import type { StockAuditEntry } from '../../src/types/auditLog'
import type { ParsedImportRow, DupAction } from '../../src/features/inventory/lib/importProducts'
import { getRow, putRow, insertAutoRow, errorMessage } from './generic'
import { broadcast, type BroadcastMsg } from '../broadcast'

/** openPackage / sellLooseUnit / sellWholePackage / applyCyclicCountAdjustments / applyImport —
 * mounted at /api/inventory. Ported from repositories/inventoryOps.ts. */
export function inventoryOpsRouter(db: Database.Database) {
  const router = Router()

  /** Convert `qty` packages into loose units, creating the loose-unit sibling product the first
   * time it's opened. Legacy confirmarAbrirPaquete() (repositories/inventoryOps.ts L8-42). */
  router.post('/open-package', (req, res) => {
    const { code, qty } = req.body as { code: string; qty: number }
    try {
      const { result, broadcasts } = db.transaction(() => {
        const p = getRow<Product>(db, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (qty <= 0) throw new Error('Indica cuántos paquetes abrir')
        if (qty > p.stock) throw new Error(`Solo tienes ${p.stock} paquete${p.stock !== 1 ? 's' : ''}`)

        const nuevasSueltas = qty * (p.unidadesPor || 1)
        const broadcasts: BroadcastMsg[] = []

        const updatedP: Product = { ...p, stock: p.stock - qty }
        putRow(db, 'products', 'code', code, {}, updatedP)
        broadcasts.push({ table: 'products', op: 'put', data: updatedP })

        const suelta = p.codigoSuelta ? getRow<Product>(db, 'products', 'code', p.codigoSuelta) : undefined
        if (suelta) {
          const updatedS: Product = { ...suelta, stock: (suelta.stock || 0) + nuevasSueltas }
          putRow(db, 'products', 'code', suelta.code, {}, updatedS)
          broadcasts.push({ table: 'products', op: 'put', data: updatedS })
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
            pricePer: 0,
            esPaquete: false,
            esUnidadSuelta: true,
            codigoPaquete: p.code,
            nombrePaquete: p.name,
          }
          putRow(db, 'products', 'code', newSuelta.code, {}, newSuelta)
          broadcasts.push({ table: 'products', op: 'put', data: newSuelta })
        }
        return { result: { sueltaName: p.nombreSuelta || 'unidad', nuevasSueltas }, broadcasts }
      })()
      broadcasts.forEach(broadcast)
      res.json(result)
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** "Vender unidad suelta" — auto-opens a package if no loose units remain. Legacy
   * veredaVenderUnidad() (repositories/inventoryOps.ts L47-82). Not a POS sale — a direct stock
   * adjustment, same as the original. */
  router.post('/sell-loose-unit', (req, res) => {
    const { code } = req.body as { code: string }
    try {
      const broadcasts = db.transaction(() => {
        const p = getRow<Product>(db, 'products', 'code', code)
        if (!p || !p.esPaquete || !p.codigoSuelta) throw new Error('El producto no es un paquete')

        const broadcasts: BroadcastMsg[] = []
        let suelta = getRow<Product>(db, 'products', 'code', p.codigoSuelta)
        if (!suelta || suelta.stock <= 0) {
          if (p.stock <= 0) throw new Error('Sin unidades sueltas ni paquetes')
          const nuevas = p.unidadesPor || 1
          const updatedP: Product = { ...p, stock: p.stock - 1 }
          putRow(db, 'products', 'code', code, {}, updatedP)
          broadcasts.push({ table: 'products', op: 'put', data: updatedP })

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
              pricePer: 0,
              esPaquete: false,
              esUnidadSuelta: true,
              codigoPaquete: p.code,
              nombrePaquete: p.name,
            }
          }
          putRow(db, 'products', 'code', suelta.code, {}, suelta)
          broadcasts.push({ table: 'products', op: 'put', data: suelta })
        }
        if (!suelta) return broadcasts
        const finalSuelta: Product = { ...suelta, stock: Math.max(0, (suelta.stock || 0) - 1) }
        putRow(db, 'products', 'code', finalSuelta.code, {}, finalSuelta)
        broadcasts.push({ table: 'products', op: 'put', data: finalSuelta })
        return broadcasts
      })()
      broadcasts.forEach(broadcast)
      res.status(204).end()
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** "Vender paquete completo" — legacy veredaVenderPaquete() (repositories/inventoryOps.ts
   * L85-92). */
  router.post('/sell-whole-package', (req, res) => {
    const { code } = req.body as { code: string }
    try {
      const updatedP = db.transaction(() => {
        const p = getRow<Product>(db, 'products', 'code', code)
        if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
        if (p.stock <= 0) throw new Error('No hay paquetes disponibles')
        const u: Product = { ...p, stock: p.stock - 1 }
        putRow(db, 'products', 'code', code, {}, u)
        return u
      })()
      broadcast({ table: 'products', op: 'put', data: updatedP })
      res.status(204).end()
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  /** Apply conteo cíclico differences, logging each one to the audit trail — legacy
   * aplicarAjustesConteo() (repositories/inventoryOps.ts L102-128). */
  router.post('/cyclic-count', (req, res) => {
    const { adjustments, user } = req.body as { adjustments: Array<{ code: string; counted: number; reason: string }>; user: string }
    const { applied, broadcasts } = db.transaction(() => {
      let applied = 0
      const broadcasts: BroadcastMsg[] = []
      for (const a of adjustments) {
        const p = getRow<Product>(db, 'products', 'code', a.code)
        if (!p) continue
        const before = p.stock || 0
        const diff = a.counted - before
        if (diff === 0) continue
        const u: Product = { ...p, stock: a.counted }
        putRow(db, 'products', 'code', a.code, {}, u)
        broadcasts.push({ table: 'products', op: 'put', data: u })

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
        const savedEntry = insertAutoRow(db, 'auditLog', entry)
        broadcasts.push({ table: 'auditLog', op: 'put', data: savedEntry })
        applied++
      }
      return { applied, broadcasts }
    })()
    broadcasts.forEach(broadcast)
    res.json({ applied })
  })

  /** Commit a previewed import — legacy confirmImport() (repositories/inventoryOps.ts
   * L137-204). */
  router.post('/import', (req, res) => {
    const { parsed, dupAction } = req.body as { parsed: ParsedImportRow[]; dupAction: DupAction }
    const { summary, broadcasts } = db.transaction(() => {
      let added = 0
      let updated = 0
      let skipped = 0
      const broadcasts: BroadcastMsg[] = []

      for (const row of parsed) {
        const existing = getRow<Product>(db, 'products', 'code', row.code)
        if (existing) {
          if (dupAction === 'skip') {
            skipped++
            continue
          }
          if (dupAction === 'stock_only') {
            const before = existing.stock || 0
            const after = before + row.stock
            const u: Product = { ...existing, stock: after }
            putRow(db, 'products', 'code', row.code, {}, u)
            broadcasts.push({ table: 'products', op: 'put', data: u })

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
            const savedEntry = insertAutoRow(db, 'auditLog', entry)
            broadcasts.push({ table: 'auditLog', op: 'put', data: savedEntry })
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
          if (row.pricePer > 0) merged.pricePer = row.pricePer
          if (row.stock > 0) merged.stock = row.stock
          if (row.min > 0) merged.min = row.min
          putRow(db, 'products', 'code', row.code, {}, merged)
          broadcasts.push({ table: 'products', op: 'put', data: merged })
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
            pricePer: row.pricePer,
            stock: row.stock,
            min: row.min,
            esPaquete: false,
            createdAt: new Date().toISOString(),
          }
          putRow(db, 'products', 'code', row.code, {}, newProduct)
          broadcasts.push({ table: 'products', op: 'put', data: newProduct })
          added++
        }
      }
      return { summary: { added, updated, skipped }, broadcasts }
    })()
    broadcasts.forEach(broadcast)
    res.json(summary)
  })

  return router
}
