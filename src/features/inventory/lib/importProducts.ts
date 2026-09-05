import * as XLSX from 'xlsx'
import type { Product } from '../../../types/product'

export interface ParsedImportRow {
  code: string
  name: string
  brand: string
  cat: string
  unit: string
  price: number
  cost: number
  pricePer: number
  stock: number
  min: number
  warnings: string[]
  isNew: boolean
  existingName: string | null
}

export type DupAction = 'update' | 'skip' | 'stock_only'

function normalizeKeys(row: Record<string, unknown>): Record<string, string> {
  const n: Record<string, string> = {}
  Object.entries(row).forEach(([k, v]) => {
    n[k.toLowerCase().trim()] = String(v ?? '').trim()
  })
  return n
}

/** Parses .csv/.txt/.xlsx/.xls/.json into normalized lowercase-keyed rows — legacy
 * `importStock()` file reading (index.html L5392-5445). */
export async function parseImportFile(file: File): Promise<Record<string, string>[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''

  if (ext === 'json') {
    const text = await file.text()
    const data = JSON.parse(text) as unknown
    const rows = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.products ?? (data as Record<string, unknown>)?.items ?? [])
    return (rows as Record<string, unknown>[]).map(normalizeKeys)
  }

  if (ext === 'csv' || ext === 'txt') {
    const text = await file.text()
    const cleaned = text
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n')
    const wb = XLSX.read(cleaned, { type: 'string' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as Record<string, unknown>[]
    return rows.map(normalizeKeys)
  }

  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellText: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as Record<string, unknown>[]
  return rows.map(normalizeKeys)
}

function get(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.replace(/ /g, '_')] ?? row[k.replace(/_/g, ' ')]
    if (v !== undefined && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/** Validates + normalizes raw rows and flags new-vs-update/warnings for the preview table —
 * legacy `importStock()` row mapping (index.html L5458-5518). */
export function buildParsedRows(rawRows: Record<string, string>[], existingProducts: Product[]): { parsed: ParsedImportRow[]; errors: string[] } {
  const parsed: ParsedImportRow[] = []
  const errors: string[] = []
  const seenCodes = new Set<string>()
  const existingByCode = new Map(existingProducts.map((p) => [p.code, p]))

  rawRows.forEach((row, i) => {
    const rowNum = i + 2
    const code = get(row, 'código', 'codigo', 'code', 'barcode', 'ean', 'upc', 'sku')
    const name = get(row, 'nombre', 'name', 'producto', 'product', 'descripción', 'descripcion')

    if (!name) {
      errors.push(`Fila ${rowNum}: sin nombre (requerido)`)
      return
    }

    const finalCode = code || 'AUTO' + Date.now().toString(36).toUpperCase() + i
    if (seenCodes.has(finalCode)) errors.push(`Fila ${rowNum}: código duplicado en el archivo "${finalCode}"`)
    seenCodes.add(finalCode)

    let price = parseFloat(get(row, 'precio venta', 'precio_venta', 'price', 'precio', 'sale price', 'venta').replace(',', '.')) || 0
    const cost = parseFloat(get(row, 'precio compra', 'precio_compra', 'cost', 'costo', 'compra').replace(',', '.')) || 0
    const marginStr = get(row, '% margen', 'margen', 'margin', '% ganancia', 'ganancia')
    if (!price && cost && marginStr) price = cost * (1 + parseFloat(marginStr) / 100)

    const stock = parseFloat(get(row, 'stock', 'existencia', 'qty', 'quantity', 'cantidad', 'inventario')) || 0
    const min = parseFloat(get(row, 'stock mínimo', 'stock_minimo', 'min', 'minimo', 'minimum', 'stock min')) || 0

    const warnings: string[] = []
    if (!price) warnings.push('sin precio')
    if (stock < 0) warnings.push('stock negativo')

    const existing = existingByCode.get(finalCode)

    parsed.push({
      code: finalCode,
      name,
      brand: get(row, 'marca', 'brand'),
      cat: get(row, 'categoría', 'categoria', 'category', 'cat'),
      unit: get(row, 'unidad', 'unit') || 'unidad',
      price,
      cost,
      pricePer: parseFloat(get(row, 'precio x um', 'precio_x_um', 'priceper', 'price_per')) || 0,
      stock,
      min,
      warnings,
      isNew: !existing,
      existingName: existing ? existing.name : null,
    })
  })

  return { parsed, errors }
}
