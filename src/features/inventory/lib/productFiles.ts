import type { Product } from '../../../types/product'

/** What goes into the stock files — the Excel sheet, the CSV and the import template — kept apart
 * from the code that downloads them so it needs no browser (the self-check imports these). */

/** The same columns in all three. "Precio 1" is what older files called "Precio Venta" (the import
 * reads both); Precio 2 and 3 stay empty for a product with a single price. */
export const HEADERS = ['Código', 'Nombre', 'Marca', 'Categoría', 'Unidad', 'Precio 1', 'Precio 2', 'Precio 3', 'Precio Compra', '% Margen', 'Stock', 'Stock Mínimo']

/** Byte-order mark: with it Excel opens a CSV as UTF-8 and the accents come out right. */
const BOM = '﻿'

export function marginOf(p: Product): string {
  const cost = p.cost ?? 0
  return cost > 0 && p.price > 0 ? (((p.price - cost) / cost) * 100).toFixed(1) : ''
}

const quoted = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** One product as the cells of a row of the Excel sheet, in the order of `HEADERS`. */
export const excelRow = (p: Product) => [p.code, p.name, p.brand || '', p.cat || '', p.unit || 'unidad', p.price || 0, p.price2 || '', p.price3 || '', p.cost || 0, marginOf(p), p.stock || 0, p.min || 0]

/** One product as a CSV line, in the order of `HEADERS`. */
const csvLine = (p: Product, margin: string) =>
  [quoted(p.code), quoted(p.name), quoted(p.brand || ''), quoted(p.cat || ''), quoted(p.unit || 'unidad'), p.price || 0, p.price2 || '', p.price3 || '', p.cost || 0, margin, p.stock || 0, p.min || 0].join(',')

/** legacy `exportCSV()` (index.html L4250-4274). */
export function stockCsv(products: Product[]): string {
  return BOM + [HEADERS.join(','), ...products.map((p) => csvLine(p, marginOf(p) || '0'))].join('\n')
}

/** legacy `downloadImportTemplate()` (index.html L5347-5385). */
export function importTemplateCsv(products: Product[], storeName: string): string {
  const lines = [
    '# PLANTILLA DE IMPORTACIÓN — ' + storeName,
    '# INSTRUCCIONES:',
    '# - No modifiques los encabezados de la fila 5',
    '# - Guarda los códigos de barras como TEXTO en Excel para preservar ceros a la izquierda',
    '# - Usa punto (.) como separador decimal en los precios, NO coma',
    '# - "Precio 1" es el precio de venta de siempre; "Precio 2" y "Precio 3" son opcionales: déjalos vacíos si el producto tiene un solo precio',
    '# - Elimina estas filas de instrucciones (#) antes de importar, o déjalas (se ignoran)',
    '# - El campo "Código" es obligatorio o se generará uno automático',
    '# - El campo "Nombre" es OBLIGATORIO',
    HEADERS.join(','),
    '"001","Ejemplo Producto 1","MarcaA","Bebidas","unidad","5.50","5.00","4.50","3.00","83.3","20","5"',
    '"7501234567890","Ejemplo Producto 2 con EAN","MarcaB","Snacks","unidad","2.00","1.80","","1.20","66.7","50","10"',
    '"PESO-001","Arroz (por kg)","","Granos","kg","1.50","","","0.90","66.7","25","5"',
    '"","Producto sin código","","","unidad","10.00","","","6.00","66.7","0","0"',
  ]
  if (products.length) {
    lines.push('', '# TUS PRODUCTOS ACTUALES (solo referencia):')
    for (const p of products.slice(0, 5)) lines.push(csvLine(p, marginOf(p)))
  }
  return BOM + lines.join('\n')
}
