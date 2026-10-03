import { useMemo } from 'react'
import { Pencil, ShoppingCart } from 'lucide-react'
import type { Customer } from '../../../types/customer'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { formatDate, formatMoney, formatQty } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import type { CustomerWithSpent } from '../hooks/useCustomersWithSpent'
import type { CustomerSortKey } from '../lib/customerSort'
import { CustomerAvatar } from './CustomerAvatar'

interface CustomerTableProps {
  rows: CustomerWithSpent[]
  sort: SortState<CustomerSortKey>
  onSort: (key: CustomerSortKey) => void
  /** Changes whenever the visible list is re-queried (search/filter/sort) → scroll back to top. */
  resetKey: string
  onOpen: (c: Customer) => void
  onEdit: (c: Customer) => void
  onSell: (c: Customer) => void
}

/** Customer list on the shared spreadsheet-style `DataTable`; a row opens the customer's profile. */
export function CustomerTable({ rows, sort, onSort, resetKey, onOpen, onEdit, onSell }: CustomerTableProps) {
  const columns = useMemo<DataColumn<CustomerWithSpent, CustomerSortKey>[]>(
    () => [
      {
        key: 'name',
        label: 'Cliente',
        min: 220,
        grow: true,
        sortKey: 'name',
        cell: ({ customer: c, spent }) => (
          <div className="flex max-w-full items-center gap-2.5">
            <CustomerAvatar name={c.name} spent={spent} size={30} />
            <span className="truncate text-[13px] font-semibold" title={c.name}>
              {c.name}
            </span>
          </div>
        ),
      },
      { key: 'cedula', label: 'Cédula', min: 112, sortKey: 'cedula', cell: ({ customer: c }) => <span className="max-w-full truncate font-mono text-[11.5px] text-txt2">{c.cedula || '—'}</span> },
      { key: 'phone', label: 'Teléfono', min: 112, sortKey: 'phone', cell: ({ customer: c }) => <span className="max-w-full truncate font-mono text-[11.5px] text-txt2">{c.phone || '—'}</span> },
      { key: 'count', label: 'Compras', min: 84, align: 'right', sortKey: 'count', cell: ({ salesCount }) => <span className="font-mono text-txt2">{salesCount}</span> },
      {
        key: 'spent',
        label: 'Total gastado',
        min: 128,
        align: 'right',
        sortKey: 'spent',
        cell: ({ spent }) => <span className="font-mono text-[12.5px] font-bold text-lime">{formatMoney(spent)}</span>,
      },
      { key: 'pts', label: 'Puntos', min: 78, align: 'right', sortKey: 'pts', cell: ({ pts }) => <span className="font-mono text-txt2">{formatQty(pts)}</span> },
      {
        key: 'tier',
        label: 'Nivel',
        min: 92,
        align: 'center',
        sortKey: 'tier',
        cell: ({ tier: t }) => <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${t.badgeClass}`}>{t.label}</span>,
      },
      { key: 'last', label: 'Última compra', min: 140, align: 'right', sortKey: 'last', cell: ({ lastPurchase }) => <span className="whitespace-nowrap text-txt2">{lastPurchase ? formatDate(lastPurchase) : '—'}</span> },
      {
        key: 'actions',
        label: '',
        min: 92,
        actions: true,
        cell: ({ customer: c }) => (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit(c)
              }}
              title="Editar"
              aria-label="Editar"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-br2 text-txt2 transition-colors hover:border-lime/40 hover:text-lime"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onSell(c)
              }}
              title="Vender a este cliente"
              aria-label="Vender a este cliente"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-lime/30 bg-lime/10 text-lime transition-colors hover:bg-lime/20"
            >
              <ShoppingCart size={14} />
            </button>
          </>
        ),
      },
    ],
    [onEdit, onSell],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.customer.id}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={(r) => onOpen(r.customer)}
      bottomSpace={80}
    />
  )
}
