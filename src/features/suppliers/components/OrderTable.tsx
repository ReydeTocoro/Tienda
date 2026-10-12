import { useMemo } from 'react'
import { Eye, PackageCheck, Pencil } from 'lucide-react'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { daysBetween } from '../../../shared/lib/cash'
import { dayKeyOf, formatDateTime, formatMoney, todayKey } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import type { OrderRow, OrderSortKey } from '../lib/orderRows'
import { ORDER_STATUS } from '../lib/orderStatus'
import { termsClass, termsLabel } from '../lib/terms'
import { Pill, PRIMARY, RowButton } from './tableParts'

/** A sent order that has taken longer than this to arrive is worth a call to the supplier. */
const LATE_DAYS = 7

/** How long ago, as a short phrase under a date. */
function ago(days: number): string {
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}

interface OrderTableProps {
  rows: OrderRow[]
  sort: SortState<OrderSortKey>
  onSort: (key: OrderSortKey) => void
  /** Changes whenever the visible list is re-queried (search/filter/sort) → scroll back to top. */
  resetKey: string
  onOpen: (o: PurchaseOrder) => void
  onReceive: (o: PurchaseOrder) => void
  onEdit: (o: PurchaseOrder) => void
}

/** Pedidos list on the shared spreadsheet-style `DataTable`: one row per purchase order. A row opens
 * its detail; the row's own buttons receive a sent order or edit a draft without opening it first. */
export function OrderTable({ rows, sort, onSort, resetKey, onOpen, onReceive, onEdit }: OrderTableProps) {
  const today = todayKey()
  const columns = useMemo<DataColumn<OrderRow, OrderSortKey>[]>(
    () => [
      { key: 'number', label: 'N°', min: 88, sortKey: 'number', cell: (r) => <span className="font-mono text-[12px] font-semibold text-lime">{r.number}</span> },
      {
        key: 'date',
        label: 'Fecha',
        min: 156,
        sortKey: 'date',
        cell: (r) => {
          const age = daysBetween(dayKeyOf(r.date), today)
          return (
            <>
              <span className="max-w-full truncate text-txt2">{formatDateTime(r.date)}</span>
              <span className={`text-[10px] ${r.status === 'pedido' && age > LATE_DAYS ? 'text-orange' : 'text-muted'}`}>
                {r.dateLabel} {ago(age)}
              </span>
            </>
          )
        },
      },
      {
        key: 'supplier',
        label: 'Proveedor',
        min: 160,
        sortKey: 'supplier',
        cell: (r) => (
          <span className="max-w-full truncate text-[13px] font-semibold" title={r.supplier}>
            {r.supplier}
          </span>
        ),
      },
      {
        key: 'detail',
        label: 'Productos',
        min: 180,
        grow: true,
        cell: (r) => (
          <span className="max-w-full truncate text-txt2" title={r.detail}>
            {r.detail || '—'}
          </span>
        ),
      },
      { key: 'items', label: 'Ítems', min: 64, align: 'right', drop: 1, sortKey: 'items', cell: (r) => <span className="font-mono text-txt2">{r.items}</span> },
      {
        key: 'terms',
        label: 'Pago',
        min: 136,
        align: 'center',
        drop: 2,
        sortKey: 'terms',
        cell: (r) => <Pill cls={termsClass(r.terms)}>{termsLabel(r.terms)}</Pill>,
      },
      {
        key: 'total',
        label: 'Total',
        min: 116,
        align: 'right',
        sortKey: 'total',
        cell: (r) => (
          <>
            <span className="font-mono text-[12.5px] font-bold">{formatMoney(r.total)}</span>
            {/* A received order that cost less (or more) than it was ordered for: the old total, struck through. */}
            {r.orderedTotal !== undefined && (
              <span className="whitespace-nowrap font-mono text-[10px] text-muted line-through" title={`Se pidió por ${formatMoney(r.orderedTotal)}`}>
                {formatMoney(r.orderedTotal)}
              </span>
            )}
          </>
        ),
      },
      {
        key: 'status',
        label: 'Estado',
        min: 120,
        align: 'center',
        sortKey: 'status',
        cell: (r) => <Pill cls={ORDER_STATUS[r.status].cls}>{ORDER_STATUS[r.status].label}</Pill>,
      },
      {
        key: 'actions',
        label: '',
        min: 88,
        actions: true,
        cell: (r) => (
          <>
            {r.status === 'pedido' && (
              <RowButton title="Marcar como recibido" onClick={() => onReceive(r.order)} className={PRIMARY}>
                <PackageCheck size={14} />
              </RowButton>
            )}
            {r.status === 'borrador' && (
              <RowButton title="Editar borrador" onClick={() => onEdit(r.order)}>
                <Pencil size={14} />
              </RowButton>
            )}
            <RowButton title="Ver pedido" onClick={() => onOpen(r.order)}>
              <Eye size={14} />
            </RowButton>
          </>
        ),
      },
    ],
    [today, onOpen, onReceive, onEdit],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={(r) => onOpen(r.order)}
      rowClassName={(r) => (r.status === 'cancelado' ? 'opacity-60 hover:opacity-90' : '')}
      bottomSpace={80}
    />
  )
}
