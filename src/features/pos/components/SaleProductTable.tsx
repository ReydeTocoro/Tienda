import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { Product } from '../../../types/product'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
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
}

/** The products to sell, on the shared spreadsheet-style `DataTable`: a click anywhere on a row puts
 * the product in the cart (a weighed one asks how much first). What the cart already holds is marked
 * on its row, and what is out of stock is dimmed — a click still says so. */
export function SaleProductTable({ products, inCart, sort, onSort, resetKey, onPick }: SaleProductTableProps) {
  const columns = useMemo<DataColumn<Product, SaleSortKey>[]>(
    () => [
      {
        key: 'code',
        label: 'Código',
        min: 104,
        drop: 2,
        sortKey: 'code',
        cell: (p) => (
          <span className="max-w-full truncate font-mono text-[11.5px] text-txt2" title={p.code}>
            {p.code}
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
          <>
            <span className="max-w-full truncate text-[13px] font-semibold" title={p.name}>
              {p.name}
            </span>
            {p.brand && <span className="max-w-full truncate text-[11px] text-muted">{p.brand}</span>}
          </>
        ),
      },
      {
        key: 'cat',
        label: 'Categoría',
        min: 96,
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
        min: 88,
        align: 'right',
        sortKey: 'stock',
        cell: (p) => {
          const out = p.stock <= 0
          return (
            <span className={`font-mono text-[13px] font-bold ${out ? 'text-red' : isLowStock(p) ? 'text-orange' : 'text-txt'}`}>
              {out ? 'Agotado' : formatQty(p.stock)}
              {!out && <span className="text-[10px] font-normal text-muted"> {isMeasuredUnit(p.unit) ? unitShortLabel(p.unit) : 'uds'}</span>}
            </span>
          )
        },
      },
      {
        key: 'price',
        label: 'Precio',
        min: 116,
        align: 'right',
        sortKey: 'price',
        cell: (p) => {
          const prices = priceOptions(p).length
          return (
            <>
              <span className="font-mono text-[13px] font-bold text-lime">
                {formatMoney(p.price)}
                {isMeasuredUnit(p.unit) && <span className="text-[10px] font-normal text-muted">/{unitShortLabel(p.unit)}</span>}
              </span>
              {/* Precio 2 and 3 are picked on the cart line: say they are there. */}
              {prices > 1 && <span className="text-[10px] text-muted">{prices} precios</span>}
            </>
          )
        },
      },
      {
        key: 'cart',
        label: 'En carrito',
        min: 76,
        align: 'center',
        cell: (p) => {
          const qty = inCart.get(p.code)
          return qty ? <span className="min-w-[22px] rounded-full bg-lime px-1.5 text-center font-mono text-[11px] font-extrabold leading-[20px] text-on-solid">{formatQty(qty)}</span> : null
        },
      },
      {
        key: 'add',
        label: '',
        min: 52,
        drop: 3,
        align: 'center',
        cell: (p) =>
          p.stock > 0 ? (
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-md bg-lime text-on-solid">
              <Plus size={15} strokeWidth={3} />
            </span>
          ) : null,
      },
    ],
    [inCart],
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
      rowClassName={(p) => (p.stock <= 0 ? 'opacity-50' : inCart.has(p.code) ? 'shadow-[inset_3px_0_0_var(--color-lime)]' : '')}
      rowHeight={48}
      dense
    />
  )
}
