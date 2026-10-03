import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer } from '../../types/customer'
import type { TierKey } from '../../shared/lib/loyalty'
import { useCustomersWithSpent } from './hooks/useCustomersWithSpent'
import { CustomerTable } from './components/CustomerTable'
import { ClientFormSheet } from './components/ClientFormSheet'
import { ClientProfileSheet } from './components/ClientProfileSheet'
import { DEFAULT_CUSTOMER_SORT, sortCustomers, type CustomerSortKey } from './lib/customerSort'
import { AddFab } from '../../shared/components/AddFab'
import { Chip } from '../../shared/components/Chip'
import { SearchInput } from '../../shared/components/SearchInput'
import { formatMoney } from '../../shared/lib/currency'
import { nextSort, type SortState } from '../../shared/lib/sortRows'
import { useCartStore } from '../../store/useCartStore'

const TIERS: Array<{ key: TierKey; label: string }> = [
  { key: 'nuevo', label: 'Nuevo' },
  { key: 'bronce', label: 'Bronce' },
  { key: 'plata', label: 'Plata' },
  { key: 'oro', label: 'Oro' },
]

export function ClientesPage() {
  const list = useCustomersWithSpent()
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<TierKey | 'todos'>('todos')
  const [sort, setSort] = useState<SortState<CustomerSortKey>>(DEFAULT_CUSTOMER_SORT)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [profile, setProfile] = useState<Customer | null>(null)
  const navigate = useNavigate()
  const setCartCustomer = useCartStore((s) => s.setCustomer)

  const totalRevenue = useMemo(() => list.reduce((a, c) => a + c.spent, 0), [list])
  const top = useMemo(() => (list.length ? list.reduce((a, c) => (c.spent > a.spent ? c : a), list[0]) : null), [list])
  const tierCounts = useMemo(() => {
    const m = new Map<TierKey, number>()
    for (const r of list) m.set(r.tier.key, (m.get(r.tier.key) ?? 0) + 1)
    return m
  }, [list])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = list.filter(
      ({ customer: c, tier: t }) =>
        (tierFilter === 'todos' || t.key === tierFilter) && (!q || c.name.toLowerCase().includes(q) || (c.cedula && c.cedula.includes(q)) || (c.phone && c.phone.includes(q))),
    )
    return sortCustomers(filtered, sort)
  }, [list, search, tierFilter, sort])

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(c: Customer) {
    setEditing(c)
    setFormOpen(true)
    setProfile(null)
  }

  function sell(c: Customer) {
    setCartCustomer(c.id, c.name)
    setProfile(null)
    navigate('/')
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 p-3.5 md:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-[21px] font-bold md:text-[22px]">Clientes</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <Chip>
              {list.length} cliente{list.length !== 1 ? 's' : ''}
            </Chip>
            <Chip tone="lime">Facturado {formatMoney(totalRevenue)}</Chip>
            {top && top.spent > 0 && <Chip tone="blue">Top: {top.customer.name.split(' ')[0]}</Chip>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar nombre, cédula o teléfono..." />
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as TierKey | 'todos')} aria-label="Filtrar por nivel" className="input w-auto min-w-[170px] py-2">
            <option value="todos">Todos los niveles ({list.length})</option>
            {TIERS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} ({tierCounts.get(t.key) ?? 0})
              </option>
            ))}
          </select>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
            {list.length === 0 ? 'Sin clientes aún — usa el botón + para agregar el primero.' : 'Ningún cliente coincide con la búsqueda o el nivel.'}
          </div>
        ) : (
          <CustomerTable
            rows={rows}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            resetKey={`${search}|${tierFilter}|${sort.key}|${sort.dir}`}
            onOpen={setProfile}
            onEdit={openEdit}
            onSell={sell}
          />
        )}
      </div>

      <AddFab label="Agregar cliente" onClick={openNew} />

      <ClientFormSheet
        open={formOpen}
        customer={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />
      <ClientProfileSheet customer={profile} onClose={() => setProfile(null)} onEdit={() => profile && openEdit(profile)} onSell={() => profile && sell(profile)} />
    </div>
  )
}
