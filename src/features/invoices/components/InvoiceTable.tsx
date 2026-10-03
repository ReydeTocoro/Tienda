import { useMemo, type ReactNode } from 'react'
import { Eye, Pencil } from 'lucide-react'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import type { Sale } from '../../../types/sale'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import { METHOD_LABEL, STATUS_LABEL, type InvoiceMethod, type InvoiceRow, type InvoiceSortKey } from '../lib/invoiceRows'

const KIND_PILL = {
  venta: { label: 'Venta', cls: 'border-lime/30 bg-lime/10 text-lime' },
  compra: { label: 'Compra', cls: 'border-orange/30 bg-orange/10 text-orange' },
}

const METHOD_CLS: Record<InvoiceMethod, string> = {
  efectivo: 'border-green/30 bg-green/10 text-green',
  transferencia: 'border-blue/30 bg-blue/10 text-blue',
  fiado: 'border-red/30 bg-red/10 text-red',
  contado: 'border-br2 bg-s2 text-txt2',
  credito: 'border-purple/30 bg-purple/10 text-purple',
  ninguno: 'border-br2 bg-s2 text-muted',
}

const STATUS_CLS = {
  pagada: 'border-green/30 bg-green/10 text-green',
  'por cobrar': 'border-red/30 bg-red/10 text-red',
  recibida: 'border-green/30 bg-green/10 text-green',
}

const PARTY_CLS = { cliente: 'text-blue', fiado: 'text-red', publico: 'text-muted', proveedor: 'text-txt' }

function Pill({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>{children}</span>
}

interface InvoiceTableProps {
  rows: InvoiceRow[]
  sort: SortState<InvoiceSortKey>
  onSort: (key: InvoiceSortKey) => void
  /** Changes whenever the visible list is re-queried (search/filters/sort) → scroll back to top. */
  resetKey: string
  onViewSale: (s: Sale) => void
  onCorrectSale: (s: Sale) => void
  onViewOrder: (o: PurchaseOrder) => void
}

/** Facturas list on the shared spreadsheet-style `DataTable`: sales and received supplier
 * orders side by side. A row opens its receipt (sale) or its order detail (purchase). */
export function InvoiceTable({ rows, sort, onSort, resetKey, onViewSale, onCorrectSale, onViewOrder }: InvoiceTableProps) {
  const columns = useMemo<DataColumn<InvoiceRow, InvoiceSortKey>[]>(
    () => [
      {
        key: 'number',
        label: 'N°',
        min: 88,
        sortKey: 'number',
        cell: (r) => <span className={`font-mono text-[12px] font-semibold ${r.kind === 'venta' ? 'text-lime' : 'text-orange'}`}>{r.number}</span>,
      },
      { key: 'date', label: 'Fecha', min: 156, sortKey: 'date', cell: (r) => <span className="max-w-full truncate text-txt2">{formatDateTime(r.date)}</span> },
      {
        key: 'kind',
        label: 'Tipo',
        min: 84,
        align: 'center',
        sortKey: 'kind',
        cell: (r) => <Pill cls={KIND_PILL[r.kind].cls}>{KIND_PILL[r.kind].label}</Pill>,
      },
      {
        key: 'party',
        label: 'Cliente / Proveedor',
        min: 178,
        sortKey: 'party',
        cell: (r) => (
          <span className={`max-w-full truncate font-semibold ${PARTY_CLS[r.partyKind]}`} title={r.party}>
            {r.partyKind === 'fiado' ? `Fiado: ${r.party}` : r.party}
          </span>
        ),
      },
      {
        key: 'detail',
        label: 'Detalle',
        min: 220,
        grow: true,
        cell: (r) => (
          <span className="max-w-full truncate text-txt2" title={r.detail}>
            {r.detail || '—'}
          </span>
        ),
      },
      {
        key: 'method',
        label: 'Pago',
        min: 112,
        align: 'center',
        sortKey: 'method',
        cell: (r) => <Pill cls={METHOD_CLS[r.method]}>{METHOD_LABEL[r.method]}</Pill>,
      },
      {
        key: 'total',
        label: 'Total',
        min: 120,
        align: 'right',
        sortKey: 'total',
        cell: (r) => <span className={`font-mono text-[12.5px] font-bold ${r.kind === 'venta' ? 'text-green' : 'text-red'}`}>{formatMoney(r.total)}</span>,
      },
      {
        key: 'status',
        label: 'Estado',
        min: 108,
        align: 'center',
        sortKey: 'status',
        cell: (r) => (
          <>
            <Pill cls={STATUS_CLS[r.status]}>{STATUS_LABEL[r.status]}</Pill>
            {(r.debt > 0 || r.corrected) && (
              <span className="flex items-center gap-1.5 text-[10px]">
                {r.debt > 0 && <span className="font-mono text-red">{formatMoney(r.debt)}</span>}
                {r.corrected && <span className="text-orange">corregida</span>}
              </span>
            )}
          </>
        ),
      },
      {
        key: 'actions',
        label: '',
        min: 84,
        actions: true,
        cell: (r) =>
          r.sale ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onViewSale(r.sale!)
                }}
                title="Ver factura"
                aria-label="Ver factura"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-br2 text-txt2 transition-colors hover:border-lime/40 hover:text-lime"
              >
                <Eye size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCorrectSale(r.sale!)
                }}
                title="Corregir factura"
                aria-label="Corregir factura"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-br2 text-txt2 transition-colors hover:border-orange/40 hover:text-orange"
              >
                <Pencil size={14} />
              </button>
            </>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onViewOrder(r.order!)
              }}
              title="Ver pedido"
              aria-label="Ver pedido"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-br2 text-txt2 transition-colors hover:border-lime/40 hover:text-lime"
            >
              <Eye size={14} />
            </button>
          ),
      },
    ],
    [onViewSale, onCorrectSale, onViewOrder],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={(r) => (r.sale ? onViewSale(r.sale) : onViewOrder(r.order!))}
    />
  )
}
