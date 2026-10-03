import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { daysBetween, formatDayKey } from '../../../shared/lib/cash'
import { formatMoney, todayKey } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import { initials } from '../../../shared/lib/text'
import type { FiadoRow, FiadoSortKey } from '../lib/fiadoRows'

/** How long a debt has been open, as a short phrase under its date. */
function ageLabel(days: number): string {
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}

interface FiadoTableProps {
  rows: FiadoRow[]
  sort: SortState<FiadoSortKey>
  onSort: (key: FiadoSortKey) => void
  /** Changes whenever the visible list is re-queried (search/filter/sort) → scroll back to top. */
  resetKey: string
  onOpen: (r: FiadoRow) => void
}

/** Fiados list on the shared spreadsheet-style `DataTable`: one row per debtor. A row opens the
 * detail sheet, where the debt is collected, forgiven or paid off. */
export function FiadoTable({ rows, sort, onSort, resetKey, onOpen }: FiadoTableProps) {
  const today = todayKey()
  const columns = useMemo<DataColumn<FiadoRow, FiadoSortKey>[]>(
    () => [
      {
        key: 'name',
        label: 'Cliente',
        min: 220,
        grow: true,
        sortKey: 'name',
        cell: (r) => (
          <div className="flex max-w-full items-center gap-2.5">
            <span
              className={`flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                r.isPaid ? 'border-green/25 bg-green/10 text-green' : 'border-red/25 bg-red/10 text-red'
              }`}
            >
              {initials(r.name)}
            </span>
            <span className="truncate text-[13px] font-semibold" title={r.name}>
              {r.name}
            </span>
          </div>
        ),
      },
      { key: 'cedula', label: 'Cédula', min: 112, sortKey: 'cedula', cell: (r) => <span className="max-w-full truncate font-mono text-[11.5px] text-txt2">{r.cedula || '—'}</span> },
      { key: 'phone', label: 'Teléfono', min: 112, sortKey: 'phone', cell: (r) => <span className="max-w-full truncate font-mono text-[11.5px] text-txt2">{r.phone || '—'}</span> },
      { key: 'count', label: 'Fiados', min: 72, align: 'right', sortKey: 'count', cell: (r) => <span className="font-mono text-txt2">{r.count}</span> },
      {
        key: 'since',
        label: 'Deuda desde',
        min: 144,
        sortKey: 'since',
        cell: (r) => {
          if (!r.sinceKey) return <span className="text-muted">—</span>
          const age = daysBetween(r.sinceKey, today)
          return (
            <>
              <span className="whitespace-nowrap text-txt2">{formatDayKey(r.sinceKey)}</span>
              <span className={`text-[10px] ${age > 30 ? 'text-orange' : 'text-muted'}`}>{ageLabel(age)}</span>
            </>
          )
        },
      },
      { key: 'total', label: 'Total fiado', min: 116, align: 'right', sortKey: 'total', cell: (r) => <span className="font-mono text-txt2">{formatMoney(r.totalOwed)}</span> },
      {
        key: 'paid',
        label: 'Abonado',
        min: 112,
        align: 'right',
        sortKey: 'paid',
        cell: (r) => <span className={`font-mono ${r.totalPaid > 0 ? 'text-green' : 'text-muted'}`}>{r.totalPaid > 0 ? formatMoney(r.totalPaid) : '—'}</span>,
      },
      {
        key: 'debt',
        label: 'Debe',
        min: 124,
        align: 'right',
        sortKey: 'debt',
        cell: (r) => <span className={`font-mono text-[12.5px] font-bold ${r.isPaid ? 'text-green' : 'text-red'}`}>{formatMoney(r.debt)}</span>,
      },
      {
        key: 'status',
        label: 'Estado',
        min: 108,
        align: 'center',
        sortKey: 'status',
        cell: (r) => (
          <>
            <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${r.isPaid ? 'border-green/30 bg-green/10 text-green' : 'border-red/30 bg-red/10 text-red'}`}>
              {r.isPaid ? 'Pagado' : 'Pendiente'}
            </span>
            {!r.isPaid && r.totalPaid > 0 && (
              <span className="h-1 w-14 overflow-hidden rounded-full bg-s3" title={`${Math.round((r.totalPaid / r.totalOwed) * 100)}% abonado`}>
                <span className="block h-full rounded-full bg-gradient-to-r from-green to-lime" style={{ width: `${(r.totalPaid / r.totalOwed) * 100}%` }} />
              </span>
            )}
          </>
        ),
      },
      {
        key: 'actions',
        label: '',
        min: 56,
        actions: true,
        cell: (r) => (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpen(r)
            }}
            title="Ver detalle y cobrar"
            aria-label="Ver detalle y cobrar"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-br2 text-txt2 transition-colors hover:border-lime/40 hover:text-lime"
          >
            <Eye size={14} />
          </button>
        ),
      },
    ],
    [today, onOpen],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.group.key}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={onOpen}
      rowClassName={(r) => (r.isPaid ? 'opacity-60 hover:opacity-90' : '')}
    />
  )
}
