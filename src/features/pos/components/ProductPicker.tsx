import { useMemo } from 'react'
import type { CartItem } from '../../../types/cartItem'
import type { Product } from '../../../types/product'
import { nextSort, type SortState } from '../../../shared/lib/sortRows'
import { ALL, type SaleList, type SaleSortKey } from '../lib/saleProducts'
import { SaleProductTable } from './SaleProductTable'

interface ProductPickerProps {
  /** The list as built by the page (it also moves around in it with the keyboard). */
  list: SaleList
  /** How many products there are in all. */
  total: number
  cart: CartItem[]
  search: string
  sort: SortState<SaleSortKey>
  onSort: (sort: SortState<SaleSortKey>) => void
  onSetCat: (cat: string) => void
  onPick: (p: Product) => void
  /** The product the arrow keys are on in the search box. */
  activeCode?: string
}

/** The left half of Venta: the products to put in the cart, as a table under its category filter. What is typed in
 * the search box narrows this very table and is marked in yellow in it. */
export function ProductPicker({ list, total, cart, search, sort, onSort, onSetCat, onPick, activeCode }: ProductPickerProps) {
  const { cat, cats, catCounts, rows } = list
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
          <option value={ALL}>Todas ({total})</option>
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
            <p className="text-[13px]">{search.trim() ? `Sin resultados para "${search.trim()}"` : 'Sin resultados'}</p>
          </div>
        </div>
      ) : (
        // The table has the whole height under the filter: nothing else shares the column with it.
        <div className="flex min-h-0 flex-1 flex-col p-2.5 md:p-3">
          <SaleProductTable
            products={rows}
            inCart={inCart}
            sort={sort}
            onSort={(key) => onSort(nextSort(sort, key))}
            resetKey={`${search}|${cat}|${sort.key}|${sort.dir}`}
            onPick={onPick}
            query={search}
            activeCode={activeCode}
          />
        </div>
      )}
    </div>
  )
}
