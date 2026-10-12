import type { Product } from '../../../types/product'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'

/** The "all categories" choice of the category filter. */
export const ALL = '__all__'

/** Still in stock, but at or under its minimum — the stock figure turns orange. */
export const isLowStock = (p: Product): boolean => p.stock > 0 && p.min > 0 && p.stock <= p.min

export interface SaleProductFilters {
  search: string
  /** A category name ('' = products without one), or `ALL`. */
  cat: string
}

/** The products the cashier is looking at: both filters at once — search (name, code or brand)
 * and category. */
export function filterSaleProducts(products: Product[], { search, cat }: SaleProductFilters): Product[] {
  const q = search.trim().toLowerCase()
  return products.filter(
    (p) =>
      (cat === ALL || (p.cat || '') === cat) &&
      (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)),
  )
}

export type SaleSortKey = 'code' | 'name' | 'cat' | 'stock' | 'price'

/** What Venta shows: the products under both filters, sorted, with the categories to choose from. */
export interface SaleList {
  /** How many products each category has ('' = without one). */
  catCounts: Map<string, number>
  cats: string[]
  /** The category in force: the chosen one, or `ALL` when it has vanished (its last product recategorized or deleted from
   * another device) rather than an empty table under a blank selector. */
  cat: string
  rows: Product[]
}

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

export function buildSaleList(products: Product[], search: string, activeCat: string, sort: SortState<SaleSortKey>): SaleList {
  const catCounts = new Map<string, number>()
  for (const p of products) catCounts.set(p.cat || '', (catCounts.get(p.cat || '') ?? 0) + 1)
  const cats = [...catCounts.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'es')))
  const cat = activeCat === ALL || catCounts.has(activeCat) ? activeCat : ALL
  return { catCounts, cats, cat, rows: sortSaleProducts(filterSaleProducts(products, { search, cat }), sort) }
}

export function sortSaleProducts(products: Product[], { key, dir }: SortState<SaleSortKey>): Product[] {
  const sorted = sortRows(products, (p) => sortValue(p, key), dir, (a, b) => a.name.localeCompare(b.name, 'es'))
  // Sorted by name, what can't be sold goes to the end rather than among what can; every other
  // column sorts exactly what it says.
  return key === 'name' ? [...sorted.filter((p) => p.stock > 0), ...sorted.filter((p) => p.stock <= 0)] : sorted
}
