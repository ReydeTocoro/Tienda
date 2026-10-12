import { useMemo } from 'react'
import { Check } from 'lucide-react'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import { unitShortLabel } from '../../../shared/lib/units'
import type { Candidate, CandidateSortKey } from '../lib/candidates'
import { suggestedQty } from '../lib/orderDraft'

interface OrderProductTableProps {
  products: Candidate[]
  /** Codes of the products already on the order. */
  selected: Set<string>
  sort: SortState<CandidateSortKey>
  onSort: (key: CandidateSortKey) => void
  /** Changes whenever the visible list is re-queried (search/mode/sort) → scroll back to top. */
  resetKey: string
  onToggle: (p: Candidate) => void
}

/** The products to pick from when building an order, on the shared spreadsheet-style `DataTable`
 * (so the whole catalog scrolls smoothly, not just a first page of it). A row adds the product to
 * the order, or takes it off again; the ones already on it are marked. */
export function OrderProductTable({ products, selected, sort, onSort, resetKey, onToggle }: OrderProductTableProps) {
  const columns = useMemo<DataColumn<Candidate, CandidateSortKey>[]>(
    () => [
      {
        key: 'pick',
        label: '',
        min: 44,
        align: 'center',
        cell: (p) => {
          const on = selected.has(p.code)
          return (
            <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded border ${on ? 'border-lime bg-lime text-on-solid' : 'border-br2'}`}>
              {on && <Check size={13} strokeWidth={3} />}
            </span>
          )
        },
      },
      {
        key: 'name',
        label: 'Producto',
        min: 180,
        grow: true,
        sortKey: 'name',
        cell: (p) => (
          <>
            <span className="max-w-full truncate text-[13px] font-semibold" title={p.name}>
              {p.name}
              {selected.has(p.code) && <span className="sr-only"> (en el pedido)</span>}
            </span>
            <span className="max-w-full truncate font-mono text-[11px] text-muted">
              {p.code}
              {p.brand ? ` · ${p.brand}` : ''}
            </span>
          </>
        ),
      },
      {
        key: 'cat',
        label: 'Categoría',
        min: 100,
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
        min: 84,
        align: 'right',
        sortKey: 'stock',
        cell: (p) => (
          <span className={`font-mono text-[13px] font-bold ${p.stock <= 0 ? 'text-red' : p.stock <= p.min ? 'text-orange' : 'text-txt'}`}>
            {formatQty(p.stock)} <span className="text-[10px] font-normal text-muted">{p.esPaquete ? 'paq' : unitShortLabel(p.unit || 'unidad')}</span>
          </span>
        ),
      },
      { key: 'min', label: 'Mín.', min: 56, align: 'right', drop: 3, sortKey: 'min', cell: (p) => <span className="font-mono text-txt2">{formatQty(p.min)}</span> },
      {
        key: 'suggest',
        label: 'Sugerido',
        min: 84,
        align: 'right',
        drop: 2,
        sortKey: 'suggest',
        cell: (p) => <span className="font-mono text-txt2">{formatQty(suggestedQty(p))}</span>,
      },
      {
        key: 'cost',
        label: 'Últ. compra',
        min: 104,
        align: 'right',
        sortKey: 'cost',
        cell: (p) => <span className="font-mono text-txt2">{p.cost > 0 ? formatMoney(p.cost) : '—'}</span>,
      },
    ],
    [selected],
  )

  return (
    <DataTable
      columns={columns}
      rows={products}
      rowKey={(p) => p.code}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={onToggle}
      rowClassName={(p) => (selected.has(p.code) ? 'shadow-[inset_3px_0_0_var(--color-lime)]' : '')}
      dense
    />
  )
}
