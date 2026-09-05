import * as XLSX from 'xlsx'
import type { Product } from '../../../types/product'

function marginOf(p: Product): string {
  return p.cost > 0 && p.price > 0 ? (((p.price - p.cost) / p.cost) * 100).toFixed(1) : ''
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Two-sheet Excel export (full stock + low-stock buy list) — legacy `exportExcel()`
 * (index.html L4174-4247). Cell styling/fills are dropped for simplicity; column layout and
 * the "buy list" logic (reorder to 2x min) are preserved. */
export function exportExcel(products: Product[], storeName: string): void {
  const headers = ['Código', 'Nombre', 'Marca', 'Categoría', 'Unidad', 'Precio Venta', 'Precio Compra', '% Margen', 'Precio x Unidad Medida', 'Stock', 'Stock Mínimo']
  const rows = products.map((p) => [p.code, p.name, p.brand || '', p.cat || '', p.unit || 'unidad', p.price || 0, p.cost || 0, marginOf(p), p.pricePer || '', p.stock || 0, p.min || 0])

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 16 }, { wch: 8 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Completo')

  const needed = products.filter((p) => p.stock <= p.min)
  if (needed.length) {
    const buyHeaders = ['Código', 'Nombre', 'Marca', 'Stock Actual', 'Stock Mínimo', 'Necesita', 'Unidad', 'Costo Unit.', 'Costo Estimado']
    const buyRows = needed.map((p) => {
      const falta = Math.max(0, p.min * 2 - p.stock)
      return [p.code, p.name, p.brand || '', p.stock, p.min, falta, p.unit || 'unidad', p.cost || 0, falta * (p.cost || 0)]
    })
    const wsBuy = XLSX.utils.aoa_to_sheet([buyHeaders, ...buyRows])
    wsBuy['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, wsBuy, 'Lista de Compras')
  }

  XLSX.writeFile(wb, `Stock_${storeName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/** legacy `exportCSV()` (index.html L4250-4274). */
export function exportCSV(products: Product[], storeName: string): void {
  const headers = ['Código', 'Nombre', 'Marca', 'Categoría', 'Unidad', 'Precio Venta', 'Precio Compra', '% Margen', 'Precio x UM', 'Stock', 'Stock Mínimo']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = products.map((p) =>
    [esc(p.code), esc(p.name), esc(p.brand || ''), esc(p.cat || ''), esc(p.unit || 'unidad'), p.price || 0, p.cost || 0, marginOf(p) || '0', p.pricePer || 0, p.stock || 0, p.min || 0].join(','),
  )
  const csv = [headers.join(','), ...rows].join('\n')
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `Stock_${storeName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`)
}

/** legacy `downloadImportTemplate()` (index.html L5347-5385). */
export function downloadImportTemplate(products: Product[], storeName: string): void {
  const lines = [
    '# PLANTILLA DE IMPORTACIÓN — ' + storeName,
    '# INSTRUCCIONES:',
    '# - No modifiques los encabezados de la fila 5',
    '# - Guarda los códigos de barras como TEXTO en Excel para preservar ceros a la izquierda',
    '# - Usa punto (.) como separador decimal en los precios, NO coma',
    '# - Elimina estas filas de instrucciones (#) antes de importar, o déjalas (se ignoran)',
    '# - El campo "Código" es obligatorio o se generará uno automático',
    '# - El campo "Nombre" es OBLIGATORIO',
    'Código,Nombre,Marca,Categoría,Unidad,Precio Venta,Precio Compra,% Margen,Stock,Stock Mínimo',
    '"001","Ejemplo Producto 1","MarcaA","Bebidas","unidad","5.50","3.00","83.3","20","5"',
    '"7501234567890","Ejemplo Producto 2 con EAN","MarcaB","Snacks","unidad","2.00","1.20","66.7","50","10"',
    '"PESO-001","Arroz (por kg)","","Granos","kg","1.50","0.90","66.7","25","5"',
    '"","Producto sin código","","","unidad","10.00","6.00","66.7","0","0"',
  ]
  if (products.length) {
    lines.push('', '# TUS PRODUCTOS ACTUALES (solo referencia):')
    products.slice(0, 5).forEach((p) => {
      const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
      lines.push([esc(p.code), esc(p.name), esc(p.brand || ''), esc(p.cat || ''), esc(p.unit || 'unidad'), p.price || 0, p.cost || 0, marginOf(p), p.stock || 0, p.min || 0].join(','))
    })
  }
  downloadBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), 'Plantilla_Importacion_Productos.csv')
}
