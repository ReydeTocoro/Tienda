import { useMemo } from 'react'
import { ClipboardPlus, Pencil } from 'lucide-react'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { formatMoney } from '../../../shared/lib/currency'
import type { SortState } from '../../../shared/lib/sortRows'
import type { Supplier } from '../../../types/supplier'
import type { SupplierRow, SupplierSortKey } from '../lib/supplierRows'
import { termsClass, termsLabel } from '../lib/terms'
import { Pill, PRIMARY, RowButton } from './tableParts'

interface SupplierTableProps {
  rows: SupplierRow[]
  sort: SortState<SupplierSortKey>
  onSort: (key: SupplierSortKey) => void
  /** Changes whenever the visible list is re-queried (search/filter/sort) → scroll back to top. */
  resetKey: string
  onEdit: (s: Supplier) => void
  /** Starts a new order for this supplier. */
  onOrder: (s: Supplier) => void
}

/** Proveedores list on the shared spreadsheet-style `DataTable`: one row per supplier, with what is
 * still open with them (owed, orders on their way). A row opens its form; "Hacer pedido" starts an
 * order already addressed to them. */
export function SupplierTable({ rows, sort, onSort, resetKey, onEdit, onOrder }: SupplierTableProps) {
  const columns = useMemo<DataColumn<SupplierRow, SupplierSortKey>[]>(
    () => [
      {
        key: 'name',
        label: 'Proveedor',
        min: 200,
        grow: true,
        sortKey: 'name',
        cell: (r) => (
          <>
            <span className="max-w-full truncate text-[13px] font-semibold" title={r.name}>
              {r.name}
            </span>
            {r.nit && <span className="max-w-full truncate font-mono text-[11px] text-muted">{r.nit}</span>}
          </>
        ),
      },
      {
        key: 'contact',
        label: 'Contacto',
        min: 140,
        drop: 2,
        sortKey: 'contact',
        cell: (r) => (
          <span className="max-w-full truncate text-txt2" title={r.contact}>
            {r.contact || '—'}
          </span>
        ),
      },
      { key: 'phone', label: 'Teléfono', min: 124, sortKey: 'phone', cell: (r) => <span className="max-w-full truncate font-mono text-[11.5px] text-txt2">{r.phone || '—'}</span> },
      {
        key: 'email',
        label: 'Correo',
        min: 180,
        drop: 1,
        cell: (r) => (
          <span className="max-w-full truncate text-txt2" title={r.email}>
            {r.email || '—'}
          </span>
        ),
      },
      {
        key: 'terms',
        label: 'Condición de pago',
        min: 156,
        align: 'center',
        sortKey: 'terms',
        cell: (r) => <Pill cls={termsClass(r.terms)}>{termsLabel(r.terms)}</Pill>,
      },
      {
        key: 'owed',
        label: 'Les debes',
        min: 124,
        align: 'right',
        sortKey: 'owed',
        cell: (r) => (r.owed > 0 ? <span className="font-mono text-[12.5px] font-bold text-red">{formatMoney(r.owed)}</span> : <span className="text-muted">—</span>),
      },
      {
        key: 'toReceive',
        label: 'Por recibir',
        min: 92,
        align: 'right',
        drop: 3,
        sortKey: 'toReceive',
        cell: (r) => (r.toReceive > 0 ? <span className="font-mono font-bold text-orange">{r.toReceive}</span> : <span className="text-muted">—</span>),
      },
      {
        key: 'status',
        label: 'Estado',
        min: 92,
        align: 'center',
        sortKey: 'status',
        cell: (r) => <Pill cls={r.active ? 'border-green/30 bg-green/10 text-green' : 'border-br2 bg-s2 text-muted'}>{r.active ? 'Activo' : 'Inactivo'}</Pill>,
      },
      {
        key: 'actions',
        label: '',
        min: 88,
        actions: true,
        cell: (r) => (
          <>
            {r.active && (
              <RowButton title={`Hacer un pedido a ${r.name}`} onClick={() => onOrder(r.supplier)} className={PRIMARY}>
                <ClipboardPlus size={14} />
              </RowButton>
            )}
            <RowButton title="Editar proveedor" onClick={() => onEdit(r.supplier)}>
              <Pencil size={14} />
            </RowButton>
          </>
        ),
      },
    ],
    [onEdit, onOrder],
  )

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={onSort}
      resetKey={resetKey}
      onRowClick={(r) => onEdit(r.supplier)}
      rowClassName={(r) => (r.active ? '' : 'opacity-60 hover:opacity-90')}
      bottomSpace={80}
    />
  )
}
