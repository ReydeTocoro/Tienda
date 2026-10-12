import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { Product } from '../../../types/product'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { Highlight } from '../../../shared/components/Highlight'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { priceOptions } from '../../../shared/lib/prices'
import type { SortState } from '../../../shared/lib/sortRows'
import { isMeasuredUnit, unitShortLabel } from '../../../shared/lib/units'
import { isLowStock, type SaleSortKey } from '../lib/saleProducts'

interface SaleProductTableProps {
  products: Product[]
  /** What the open cart holds of each product, by code. */
  inCart: Map<string, number>
  sort: SortState<SaleSortKey>
  onSort: (key: SaleSortKey) => void
  /** Changes whenever the visible list is re-queried (search/category/sort) → scroll back to top. */
  resetKey: string
  onPick: (p: Product) => void
  /** What is typed in the search box: marked in yellow wherever it matches. */
  query: string
  /** The product the arrow keys are on (Enter picks it). */
  activeCode?: string
}

/** The products to sell, on the shared spreadsheet-style `DataTable`: a click anywhere on a row puts
 * the product in the cart (a weighed one asks how much first). What the cart already holds is marked
 * on its row, and what is out of stock is dimmed — a click still says so. */
export function SaleProductTable({ products, inCart, sort, onSort, resetKey, onPick, query, activeCode }: SaleProductTableProps) {
  const columns = useMemo<DataColumn<Product, SaleSortKey>[]>(
    () => [
      {
        key: 'code',
        label: 'Código',
        min: 96,
        drop: 2,
        sortKey: 'code',
        cell: (p) => (
          <span className="max-w-full truncate font-mono text-[11px] text-txt2" title={p.code}>
            <Highlight text={p.code} query={query} />
          </span>
        ),
      },
      {
        key: 'name',
        label: 'Producto',
        min: 170,
        grow: true,
        sortKey: 'name',
        cell: (p) => (
          <span className="max-w-full truncate text-[12.5px] font-semibold" title={p.brand ? `${p.name} · ${p.brand}` : p.name}>
            <Highlight text={p.name} query={query} />
            {p.brand && (
              <span className="ml-1.5 text-[11px] font-normal text-muted">
                <Highlight text={p.brand} query={query} />
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'cat',
        label: 'Categoría',
        min: 88,
        drop: 1,
        sortKey: 'cat',
        cell: (p) => (
          <span className="max-w-full truncate text-txt2" title={p.cat}>
            {p.cat || '—'}
          </span>
        ),
      },
      {
        key: 'stock',
        label: 'Stock',
        min: 76,
        align: 'right',
        sortKey: 'stock',
        cell: (p) => {
          const out = p.stock <= 0
          return (
            <span className={`font-mono text-[12px] font-bold ${out ? 'text-red' : isLowStock(p) ? 'text-orange' : 'text-txt'}`}>
              {out ? 'Agotado' : formatQty(p.stock)}
              {!out && <span className="text-[10px] font-normal text-muted"> {isMeasuredUnit(p.unit) ? unitShortLabel(p.unit) : 'uds'}</span>}
            </span>
          )
        },
      },
      {
        key: 'price',
        label: 'Precio',
        min: 140,
        align: 'right',
        sortKey: 'price',
        cell: (p) => {
          const prices = priceOptions(p).length
          return (
            <span className="flex items-baseline gap-1.5 whitespace-nowrap">
              {/* Precio 2 and 3 are picked on the cart line: say they are there. */}
              {prices > 1 && <span className="text-[10px] text-muted">{prices} precios</span>}
              <span className="font-mono text-[12px] font-bold text-lime">
                {formatMoney(p.price)}
                {isMeasuredUnit(p.unit) && <span className="text-[10px] font-normal text-muted">/{unitShortLabel(p.unit)}</span>}
              </span>
            </span>
          )
        },
      },
      {
        key: 'cart',
        label: 'En carrito',
        min: 70,
        align: 'center',
        cell: (p) => {
          const qty = inCart.get(p.code)
          return qty ? <span className="min-w-[18px] rounded-full bg-lime px-1.5 text-center font-mono text-[10.5px] font-extrabold leading-[16px] text-on-solid">{formatQty(qty)}</span> : null
        },
      },
      {
        key: 'add',
        label: '',
        min: 40,
        drop: 3,
        align: 'center',
        cell: (p) =>
          p.stock > 0 ? (
            <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded bg-lime text-on-solid">
              <Plus size={12} strokeWidth={3} />
            </span>
          ) : null,
      },
    ],
    [inCart, query],
  )

  return (
    <DataTable
      columns={columns}
      rows={products}
      rowKey={(p) => p.code}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={onPick}
      activeKey={activeCode}
      rowClassName={(p) => (p.stock <= 0 ? 'opacity-50' : inCart.has(p.code) ? 'shadow-[inset_3px_0_0_var(--color-lime)]' : '')}
      rowHeight={30}
      dense
      compact
    />
  )
}
