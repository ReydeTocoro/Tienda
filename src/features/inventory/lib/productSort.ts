import type { Product } from '../../../types/product'

export type SortKey = 'code' | 'name' | 'cat' | 'stock' | 'price' | 'price2' | 'price3' | 'cost' | 'margin' | 'invested'
export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

export const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' }

/** Sort keys that expose cost data — ignored while costs are hidden, so the row order can't
 * leak what the hidden columns would show. */
export const COST_SORT_KEYS = new Set<SortKey>(['cost', 'margin', 'invested'])

function sortValue(p: Product, key: SortKey): string | number {
  switch (key) {
    case 'code':
      return p.code
    case 'name':
      return p.name
    case 'cat':
      return p.cat || ''
    case 'stock':
      return p.stock || 0
    case 'price':
      return p.price || 0
    case 'price2':
      return p.price2 || 0
    case 'price3':
      return p.price3 || 0
    case 'cost':
      return p.cost || 0
    case 'margin':
      return (p.cost ?? 0) > 0 ? (p.price - p.cost!) / p.cost! : -Infinity
    case 'invested':
      return (p.cost || 0) * (p.stock || 0)
  }
}

export function sortProducts(list: Product[], { key, dir }: SortState): Product[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    const cmp = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) : va - vb
    return cmp * sign || a.name.localeCompare(b.name, 'es')
  })
}
