import { db } from '../index'
import type { EntradaRecord } from '../../types/entrada'

/** Single-item restock — legacy `confirmarEntrada()` (index.html L3290-3302). */
export async function confirmEntrada(code: string, qty: number, source?: string): Promise<EntradaRecord> {
  return db.transaction('rw', db.products, db.entradas, async () => {
    const p = await db.products.get(code)
    if (!p) throw new Error('Producto no encontrado')
    const stockAntes = p.stock || 0
    const stockDespues = stockAntes + qty
    await db.products.update(code, { stock: stockDespues })
    const record: EntradaRecord = { code, name: p.name, qty, stockAntes, stockDespues, date: new Date().toISOString(), source }
    const id = await db.entradas.add(record)
    return { ...record, id }
  })
}

/** Bulk restock from the "escaneo masivo" modal — legacy `msFinalize()` (index.html L6475-6510). */
export async function confirmEntradasBulk(entries: Array<{ code: string; qty: number }>, source = 'masivo'): Promise<number> {
  return db.transaction('rw', db.products, db.entradas, async () => {
    let totalUnidades = 0
    for (const e of entries) {
      const p = await db.products.get(e.code)
      if (!p) continue
      const stockAntes = p.stock || 0
      const stockDespues = stockAntes + e.qty
      await db.products.update(e.code, { stock: stockDespues })
      await db.entradas.add({ code: e.code, name: p.name, qty: e.qty, stockAntes, stockDespues, date: new Date().toISOString(), source })
      totalUnidades += e.qty
    }
    return totalUnidades
  })
}

export async function listEntradas(limit = 50): Promise<EntradaRecord[]> {
  return db.entradas.orderBy('id').reverse().limit(limit).toArray()
}
