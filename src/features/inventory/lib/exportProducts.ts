import * as XLSX from 'xlsx'
import type { Product } from '../../../types/product'
import { HEADERS, excelRow, importTemplateCsv, stockCsv } from './productFiles'

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
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...products.map(excelRow)])
  ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 8 }, { wch: 10 }]
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

export function exportCSV(products: Product[], storeName: string): void {
  downloadBlob(new Blob([stockCsv(products)], { type: 'text/csv;charset=utf-8' }), `Stock_${storeName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`)
}

export function downloadImportTemplate(products: Product[], storeName: string): void {
  downloadBlob(new Blob([importTemplateCsv(products, storeName)], { type: 'text/csv;charset=utf-8' }), 'Plantilla_Importacion_Productos.csv')
}
