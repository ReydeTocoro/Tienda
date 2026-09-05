import { db } from '../index'
import type { Product } from '../../types/product'
import type { StockAuditEntry } from '../../types/auditLog'
import type { ParsedImportRow, DupAction } from '../../features/inventory/lib/importProducts'

/** Convert `qty` packages into loose units, creating the loose-unit sibling product the first
 * time it's opened. Legacy `confirmarAbrirPaquete()` (index.html L4072-4114). */
export async function openPackage(packageCode: string, qty: number): Promise<{ sueltaName: string; nuevasSueltas: number }> {
  return db.transaction('rw', db.products, async () => {
    const p = await db.products.get(packageCode)
    if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
    if (qty <= 0) throw new Error('Indica cuántos paquetes abrir')
    if (qty > p.stock) throw new Error(`Solo tienes ${p.stock} paquete${p.stock !== 1 ? 's' : ''}`)

    const nuevasSueltas = qty * (p.unidadesPor || 1)
    await db.products.update(packageCode, { stock: p.stock - qty })

    const suelta = p.codigoSuelta ? await db.products.get(p.codigoSuelta) : undefined
    if (suelta) {
      await db.products.update(suelta.code, { stock: (suelta.stock || 0) + nuevasSueltas })
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
      await db.products.add(newSuelta)
    }
    return { sueltaName: p.nombreSuelta || 'unidad', nuevasSueltas }
  })
}

/** "Vender unidad suelta" quick action from the package card — auto-opens a package if no
 * loose units remain. Legacy `veredaVenderUnidad()` (index.html L4009-4030). Note: like the
 * legacy app, this is a direct stock adjustment, not a POS sale (no `sales` row is created). */
export async function sellLooseUnit(packageCode: string): Promise<void> {
  return db.transaction('rw', db.products, async () => {
    const p = await db.products.get(packageCode)
    if (!p || !p.esPaquete || !p.codigoSuelta) throw new Error('El producto no es un paquete')

    let suelta = await db.products.get(p.codigoSuelta)
    if (!suelta || suelta.stock <= 0) {
      if (p.stock <= 0) throw new Error('Sin unidades sueltas ni paquetes')
      const nuevas = p.unidadesPor || 1
      await db.products.update(packageCode, { stock: p.stock - 1 })
      if (suelta) {
        await db.products.update(suelta.code, { stock: (suelta.stock || 0) + nuevas })
      } else {
        await db.products.add({
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
        })
      }
      suelta = await db.products.get(p.codigoSuelta)
    }
    if (!suelta) return
    await db.products.update(suelta.code, { stock: Math.max(0, (suelta.stock || 0) - 1) })
  })
}

/** "Vender paquete completo" quick action — legacy `veredaVenderPaquete()` (index.html L4032-4043). */
export async function sellWholePackage(packageCode: string): Promise<void> {
  return db.transaction('rw', db.products, async () => {
    const p = await db.products.get(packageCode)
    if (!p || !p.esPaquete) throw new Error('El producto no es un paquete')
    if (p.stock <= 0) throw new Error('No hay paquetes disponibles')
    await db.products.update(packageCode, { stock: p.stock - 1 })
  })
}

export interface CyclicCountAdjustment {
  code: string
  counted: number
  reason: string
}

/** Apply conteo cíclico differences, logging each one to the audit trail — legacy
 * `aplicarAjustesConteo()` (index.html L5758-5810). */
export async function applyCyclicCountAdjustments(adjustments: CyclicCountAdjustment[], user: string): Promise<number> {
  return db.transaction('rw', db.products, db.auditLog, async () => {
    let applied = 0
    for (const a of adjustments) {
      const p = await db.products.get(a.code)
      if (!p) continue
      const before = p.stock || 0
      const diff = a.counted - before
      if (diff === 0) continue
      await db.products.update(a.code, { stock: a.counted })
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
      await db.auditLog.add(entry)
      applied++
    }
    return applied
  })
}

export interface ImportSummary {
  added: number
  updated: number
  skipped: number
}

/** Commit a previewed import — legacy `confirmImport()` (index.html L5596-5651). */
export async function applyImport(parsed: ParsedImportRow[], dupAction: DupAction): Promise<ImportSummary> {
  return db.transaction('rw', db.products, db.auditLog, async () => {
    let added = 0
    let updated = 0
    let skipped = 0

    for (const row of parsed) {
      const existing = await db.products.get(row.code)
      if (existing) {
        if (dupAction === 'skip') {
          skipped++
          continue
        }
        if (dupAction === 'stock_only') {
          const before = existing.stock || 0
          const after = before + row.stock
          await db.products.update(row.code, { stock: after })
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
          await db.auditLog.add(entry)
          updated++
          continue
        }
        // 'update': merge, preserving existing values where the imported ones are blank/0
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
        await db.products.put(merged)
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
        await db.products.add(newProduct)
        added++
      }
    }

    return { added, updated, skipped }
  })
}
