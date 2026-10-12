import { useMemo, useState } from 'react'
import { Tag } from 'lucide-react'
import type { Product } from '../../../types/product'
import type { CartItem } from '../../../types/cartItem'
import { nextSort, type SortState } from '../../../shared/lib/sortRows'
import { ALL, DEFAULT_SALE_SORT, filterSaleProducts, sortSaleProducts, type SaleSortKey } from '../lib/saleProducts'
import { SaleProductTable } from './SaleProductTable'

interface ProductPickerProps {
  products: Product[]
  cart: CartItem[]
  search: string
  activeCat: string
  onSetCat: (cat: string) => void
  onPick: (p: Product) => void
  /** Absent in contexts with no "producto sin registrar" concept. */
  onOpenFree?: () => void
  lowStockOnly?: boolean
}

/** The left half of Venta: the products to put in the cart, as a table under its category filter. */
export function ProductPicker({ products, cart, search, activeCat, onSetCat, onPick, onOpenFree, lowStockOnly = false }: ProductPickerProps) {
  const [sort, setSort] = useState<SortState<SaleSortKey>>(DEFAULT_SALE_SORT)

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) m.set(p.cat || '', (m.get(p.cat || '') ?? 0) + 1)
    return m
  }, [products])
  const cats = useMemo(() => [...catCounts.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'es'))), [catCounts])
  // The chosen category can vanish (its last product recategorized or deleted from another device):
  // fall back to "all" rather than an empty table under a blank selector.
  const cat = activeCat === ALL || catCounts.has(activeCat) ? activeCat : ALL

  const rows = useMemo(() => sortSaleProducts(filterSaleProducts(products, { search, cat, lowStockOnly }), sort), [products, search, cat, lowStockOnly, sort])
  const inCart = useMemo(() => new Map(cart.map((i) => [i.code, i.qty])), [cart])

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-br bg-bg">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-br bg-s1 px-3 py-2 md:px-4">
        <span className="text-[13px] font-bold md:text-[14px]">Productos</span>
        <select
          value={cat}
          onChange={(e) => onSetCat(e.target.value)}
          aria-label="Filtrar por categoría"
          className={`input w-auto min-w-0 max-w-[230px] py-1 text-[12px] ${cat !== ALL ? 'border-lime' : ''}`}
        >
          <option value={ALL}>Todas ({products.length})</option>
          {cats.map((c) => (
            <option key={c || '__none__'} value={c}>
              {c || 'Sin categoría'} ({catCounts.get(c)})
            </option>
          ))}
        </select>
        <span className="ml-auto hidden font-mono text-[11px] text-muted sm:inline">{rows.length}</span>
      </div>
      {!rows.length ? (
        <div className="flex flex-1 items-center justify-center p-7 text-center text-muted">
          <div>
            <p className="text-[13px]">Sin resultados</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-2.5 md:p-3">
          <SaleProductTable
            products={rows}
            inCart={inCart}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            resetKey={`${search}|${cat}|${lowStockOnly}|${sort.key}|${sort.dir}`}
            onPick={onPick}
          />
        </div>
      )}
      {onOpenFree && (
        <button
          onClick={onOpenFree}
          className="m-2 flex flex-shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-br2 p-2 text-[12px] text-txt2 transition-colors hover:border-br2 hover:bg-s1 hover:text-txt md:m-3"
        >
          <Tag size={14} /> Producto sin registrar
        </button>
      )}
    </div>
  )
}
