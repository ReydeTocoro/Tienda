import { useMemo, useState } from 'react'
import { AddFab } from '../../../shared/components/AddFab'
import { SearchInput } from '../../../shared/components/SearchInput'
import { nextSort, type SortState } from '../../../shared/lib/sortRows'
import type { Supplier } from '../../../types/supplier'
import { countSuppliers, DEFAULT_SUPPLIER_SORT, filterSuppliers, sortSuppliers, type SupplierFilter, type SupplierRow, type SupplierSortKey } from '../lib/supplierRows'
import { SupplierFormSheet } from './SupplierFormSheet'
import { SupplierTable } from './SupplierTable'

const FILTERS: Array<{ key: SupplierFilter; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'activos', label: 'Activos' },
  { key: 'inactivos', label: 'Inactivos' },
  { key: 'deuda', label: 'Con saldo por pagar' },
]

interface SupplierListProps {
  rows: SupplierRow[]
  /** Starts a new order addressed to this supplier. */
  onOrder: (s: Supplier) => void
}

/** The Proveedores tab: who the shop buys from, with what is owed and what is on its way. */
export function SupplierList({ rows: all, onOrder }: SupplierListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SupplierFilter>('todos')
  const [sort, setSort] = useState<SortState<SupplierSortKey>>(DEFAULT_SUPPLIER_SORT)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const counts = useMemo(() => countSuppliers(all), [all])
  const rows = useMemo(() => sortSuppliers(filterSuppliers(all, search, filter), sort), [all, search, filter, sort])

  function openForm(s: Supplier | null) {
    setEditing(s)
    setFormOpen(true)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} historyKey="proveedores" placeholder="Buscar nombre, NIT, contacto o teléfono..." />
        <select value={filter} onChange={(e) => setFilter(e.target.value as SupplierFilter)} aria-label="Filtrar proveedores" className="input w-auto min-w-[190px] py-2">
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} ({counts[f.key]})
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
          {all.length === 0 ? 'Aún no tienes proveedores — usa el botón + para crear el primero y poder hacerle pedidos.' : 'Ningún proveedor coincide con la búsqueda o el filtro.'}
        </div>
      ) : (
        <SupplierTable
          rows={rows}
          sort={sort}
          onSort={(key) => setSort((s) => nextSort(s, key))}
          resetKey={`${search}|${filter}|${sort.key}|${sort.dir}`}
          onEdit={openForm}
          onOrder={onOrder}
        />
      )}

      <AddFab label="Nuevo proveedor" onClick={() => openForm(null)} />

      <SupplierFormSheet open={formOpen} supplier={editing} onClose={() => setFormOpen(false)} />
    </>
  )
}
