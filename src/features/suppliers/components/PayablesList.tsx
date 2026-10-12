import { useMemo, useState } from 'react'
import { SearchInput } from '../../../shared/components/SearchInput'
import { nextSort, type SortState } from '../../../shared/lib/sortRows'
import { countPayables, DEFAULT_PAYABLE_SORT, filterPayables, sortPayables, type PayableFilter, type PayableRow, type PayableSortKey } from '../lib/payableRows'
import { PayablesTable } from './PayablesTable'
import { PayPayableSheet } from './PayPayableSheet'

const FILTERS: Array<{ key: PayableFilter; label: string; empty: string }> = [
  { key: 'pendientes', label: 'Pendientes', empty: 'No debes nada a proveedores.' },
  { key: 'vencidas', label: 'Vencidas', empty: 'No tienes cuentas vencidas.' },
  { key: 'semana', label: 'Vencen en 7 días', empty: 'Nada vence en los próximos 7 días.' },
  { key: 'pagadas', label: 'Pagadas', empty: 'Aún no has pagado ninguna cuenta completa.' },
  { key: 'todas', label: 'Todas', empty: '' },
]

interface PayablesListProps {
  rows: PayableRow[]
}

/** The Por pagar tab: what is owed to suppliers for goods received on credit, the most urgent first. */
export function PayablesList({ rows: all }: PayablesListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PayableFilter>('pendientes')
  const [sort, setSort] = useState<SortState<PayableSortKey>>(DEFAULT_PAYABLE_SORT)
  const [paying, setPaying] = useState<number | null>(null)

  const counts = useMemo(() => countPayables(all), [all])
  const rows = useMemo(() => sortPayables(filterPayables(all, search, filter), sort), [all, search, filter, sort])
  // Looked up live so the sheet shows the updated balance after each payment.
  const payable = paying !== null ? (all.find((r) => r.id === paying)?.payable ?? null) : null
  const emptyText = FILTERS.find((f) => f.key === filter)?.empty

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} historyKey="por-pagar" placeholder="Buscar proveedor o pedido..." />
        <select value={filter} onChange={(e) => setFilter(e.target.value as PayableFilter)} aria-label="Filtrar por estado" className="input w-auto min-w-[190px] py-2">
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} ({counts[f.key]})
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
          {all.length === 0
            ? 'Sin cuentas por pagar aún — se crean al recibir un pedido a crédito.'
            : !search.trim() && emptyText
              ? emptyText
              : 'Ninguna cuenta coincide con la búsqueda o el filtro.'}
        </div>
      ) : (
        <PayablesTable
          rows={rows}
          sort={sort}
          onSort={(key) => setSort((s) => nextSort(s, key))}
          resetKey={`${search}|${filter}|${sort.key}|${sort.dir}`}
          onOpen={(p) => setPaying(p.id ?? null)}
        />
      )}

      <PayPayableSheet payable={payable} onClose={() => setPaying(null)} />
    </>
  )
}
