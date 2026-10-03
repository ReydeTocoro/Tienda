import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Customer } from '../../types/customer'
import type { Sale } from '../../types/sale'
import { groupFiados } from './lib/fiadoGrouping'
import { buildFiadoRows, DEFAULT_FIADO_SORT, filterFiados, sortFiados, type FiadoSortKey, type FiadoStatusFilter } from './lib/fiadoRows'
import { FiadoTable } from './components/FiadoTable'
import { FiadoDetailSheet } from './components/FiadoDetailSheet'
import { Chip } from '../../shared/components/Chip'
import { SearchInput } from '../../shared/components/SearchInput'
import { formatMoney } from '../../shared/lib/currency'
import { nextSort, type SortState } from '../../shared/lib/sortRows'

export function FiadosPage() {
  const sales = useLiveQuery(() => db.sales.toArray(), [], []) as Sale[]
  const customers = useLiveQuery(() => db.customers.toArray(), [], []) as Customer[]
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<FiadoStatusFilter>('todos')
  const [sort, setSort] = useState<SortState<FiadoSortKey>>(DEFAULT_FIADO_SORT)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const groups = useMemo(() => groupFiados(sales), [sales])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const all = useMemo(() => buildFiadoRows(groups, customerById), [groups, customerById])

  const pending = useMemo(() => all.filter((r) => !r.isPaid), [all])
  const totalDebt = useMemo(() => pending.reduce((a, r) => a + r.debt, 0), [pending])
  const paidCount = all.length - pending.length

  const rows = useMemo(() => sortFiados(filterFiados(all, search, status), sort), [all, search, status, sort])

  // Looked up among every debtor, not just the visible rows: paying a debt off while the list is
  // filtered to "con deuda" must not slam the sheet shut on its "¡Todo pagado!" screen.
  const selected = all.find((r) => r.group.key === selectedKey) ?? null

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 p-3.5 md:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-[21px] font-bold md:text-[22px]">Fiados</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <Chip tone="red">
              {pending.length} con deuda
            </Chip>
            <Chip tone="orange">Total debido {formatMoney(totalDebt)}</Chip>
            {paidCount > 0 && (
              <Chip tone="green">
                {paidCount} pagado{paidCount !== 1 ? 's' : ''}
              </Chip>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar nombre, cédula o teléfono..." />
          <select value={status} onChange={(e) => setStatus(e.target.value as FiadoStatusFilter)} aria-label="Filtrar por estado" className="input w-auto min-w-[170px] py-2">
            <option value="todos">Todos ({all.length})</option>
            <option value="deuda">Con deuda ({pending.length})</option>
            <option value="pagado">Pagados ({paidCount})</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
            {all.length === 0 ? 'Sin fiados aún — se registran al vender con la opción Fiado.' : 'Ningún fiado coincide con la búsqueda o el filtro.'}
          </div>
        ) : (
          <FiadoTable
            rows={rows}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            resetKey={`${search}|${status}|${sort.key}|${sort.dir}`}
            onOpen={(r) => setSelectedKey(r.group.key)}
          />
        )}
      </div>

      <FiadoDetailSheet group={selected?.group ?? null} customer={selected?.customer ?? null} onClose={() => setSelectedKey(null)} />
    </div>
  )
}
