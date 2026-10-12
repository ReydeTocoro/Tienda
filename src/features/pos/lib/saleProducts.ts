import type { Product } from '../../../types/product'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'

/** The "all categories" choice of the category filter. */
export const ALL = '__all__'

/** Still in stock, but at or under its minimum — what the "Stock bajo" tally and filter count. */
export const isLowStock = (p: Product): boolean => p.stock > 0 && p.min > 0 && p.stock <= p.min

export interface SaleProductFilters {
  search: string
  /** A category name ('' = products without one), or `ALL`. */
  cat: string
  lowStockOnly: boolean
}

/** The products the cashier is looking at: all the filters at once — search (name, code or brand),
 * category, and low stock only. */
export function filterSaleProducts(products: Product[], { search, cat, lowStockOnly }: SaleProductFilters): Product[] {
  const q = search.trim().toLowerCase()
  return products.filter(
    (p) =>
      (!lowStockOnly || isLowStock(p)) &&
      (cat === ALL || (p.cat || '') === cat) &&
      (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)),
  )
}

export type SaleSortKey = 'code' | 'name' | 'cat' | 'stock' | 'price'

/** A to Z, which is how the screen opens. */
export const DEFAULT_SALE_SORT: SortState<SaleSortKey> = { key: 'name', dir: 'asc' }

function sortValue(p: Product, key: SaleSortKey): string | number {
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
  }
}

export function sortSaleProducts(products: Product[], { key, dir }: SortState<SaleSortKey>): Product[] {
  const sorted = sortRows(products, (p) => sortValue(p, key), dir, (a, b) => a.name.localeCompare(b.name, 'es'))
  // Sorted by name, what can't be sold goes to the end rather than among what can; every other
  // column sorts exactly what it says.
  return key === 'name' ? [...sorted.filter((p) => p.stock > 0), ...sorted.filter((p) => p.stock <= 0)] : sorted
}
