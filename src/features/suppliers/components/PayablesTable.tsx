import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { formatDayKey } from '../../../shared/lib/cash'
import { formatMoney } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import type { Payable } from '../../../types/purchaseOrder'
import type { PayableRow, PayableSortKey } from '../lib/payableRows'
import { Pill, RowButton } from './tableParts'

/** The pill of an account: how close it is to its due date, or that it is settled. */
function statusPill(r: PayableRow): { label: string; cls: string } {
  switch (r.status) {
    case 'pagada':
      return { label: 'Pagada', cls: 'border-green/30 bg-green/10 text-green' }
    case 'vencida':
      return { label: `Vencida hace ${-r.daysLeft} día${r.daysLeft === -1 ? '' : 's'}`, cls: 'border-red/30 bg-red/10 text-red' }
    case 'hoy':
      return { label: 'Vence hoy', cls: 'border-orange/30 bg-orange/10 text-orange' }
    case 'proxima':
      return { label: `Vence en ${r.daysLeft} día${r.daysLeft === 1 ? '' : 's'}`, cls: 'border-orange/30 bg-orange/10 text-orange' }
    case 'vigente':
      return { label: `Vence en ${r.daysLeft} días`, cls: 'border-br2 bg-s2 text-txt2' }
  }
}

interface PayablesTableProps {
  rows: PayableRow[]
  sort: SortState<PayableSortKey>
  onSort: (key: PayableSortKey) => void
  /** Changes whenever the visible list is re-queried (search/filter/sort) → scroll back to top. */
  resetKey: string
  /** Opens the account: to pay it, or — once it is settled — to see its payments. */
  onOpen: (p: Payable) => void
}

/** Por pagar list on the shared spreadsheet-style `DataTable`: one row per account payable. The
 * overdue ones carry a red bar on their left edge, and "Pagar" is a click away on each row. */
export function PayablesTable({ rows, sort, onSort, resetKey, onOpen }: PayablesTableProps) {
  const columns = useMemo<DataColumn<PayableRow, PayableSortKey>[]>(
    () => [
      {
        key: 'supplier',
        label: 'Proveedor',
        min: 190,
        grow: true,
        sortKey: 'supplier',
        cell: (r) => (
          <span className="max-w-full truncate text-[13px] font-semibold" title={r.supplier}>
            {r.supplier}
          </span>
        ),
      },
      { key: 'order', label: 'Pedido', min: 88, sortKey: 'order', cell: (r) => <span className="font-mono text-[12px] font-semibold text-lime">{r.orderNumber}</span> },
      { key: 'issued', label: 'Recibido', min: 136, drop: 1, sortKey: 'issued', cell: (r) => <span className="whitespace-nowrap text-txt2">{formatDayKey(r.issuedKey)}</span> },
      { key: 'due', label: 'Vence', min: 136, sortKey: 'due', cell: (r) => <span className="whitespace-nowrap text-txt2">{formatDayKey(r.dueKey)}</span> },
      { key: 'amount', label: 'Total', min: 116, align: 'right', sortKey: 'amount', cell: (r) => <span className="font-mono text-txt2">{formatMoney(r.amount)}</span> },
      {
        key: 'paid',
        label: 'Pagado',
        min: 112,
        align: 'right',
        drop: 2,
        sortKey: 'paid',
        cell: (r) => <span className={`font-mono ${r.paid > 0 ? 'text-green' : 'text-muted'}`}>{r.paid > 0 ? formatMoney(r.paid) : '—'}</span>,
      },
      {
        key: 'balance',
        label: 'Saldo',
        min: 124,
        align: 'right',
        sortKey: 'balance',
        cell: (r) => <span className={`font-mono text-[12.5px] font-bold ${r.status === 'pagada' ? 'text-green' : 'text-red'}`}>{formatMoney(r.balance)}</span>,
      },
      {
        key: 'status',
        label: 'Estado',
        min: 164,
        align: 'center',
        sortKey: 'status',
        cell: (r) => {
          const pill = statusPill(r)
          return (
            <>
              <Pill cls={pill.cls}>{pill.label}</Pill>
              {r.status !== 'pagada' && r.paid > 0 && (
                <span className="mt-0.5 h-1 w-14 overflow-hidden rounded-full bg-s3" title={`${Math.round((r.paid / r.amount) * 100)}% pagado`}>
                  <span className="block h-full rounded-full bg-gradient-to-r from-green to-lime" style={{ width: `${Math.min(100, (r.paid / r.amount) * 100)}%` }} />
                </span>
              )}
            </>
          )
        },
      },
      {
        key: 'actions',
        label: '',
        min: 88,
        actions: true,
        cell: (r) =>
          r.status === 'pagada' ? (
            <RowButton title="Ver pagos" onClick={() => onOpen(r.payable)}>
              <Eye size={14} />
            </RowButton>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen(r.payable)
              }}
              className="flex h-7 items-center rounded-md bg-lime px-3 text-[11px] font-bold text-on-solid transition hover:brightness-110"
            >
              Pagar
            </button>
          ),
      },
    ],
    [onOpen],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={(r) => onOpen(r.payable)}
      rowClassName={(r) => (r.status === 'pagada' ? 'opacity-60 hover:opacity-90' : r.status === 'vencida' ? 'shadow-[inset_3px_0_0_var(--color-red)]' : '')}
    />
  )
}
