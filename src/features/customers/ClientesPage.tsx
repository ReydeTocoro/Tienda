import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer } from '../../types/customer'
import { useCustomersWithSpent } from './hooks/useCustomersWithSpent'
import { CustomerAvatar } from './components/CustomerAvatar'
import { ClientFormSheet } from './components/ClientFormSheet'
import { ClientProfileSheet } from './components/ClientProfileSheet'
import { formatMoney } from '../../shared/lib/currency'
import { useCartStore } from '../../store/useCartStore'

export function ClientesPage() {
  const list = useCustomersWithSpent()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [profile, setProfile] = useState<Customer | null>(null)
  const navigate = useNavigate()
  const setCartCustomer = useCartStore((s) => s.setCustomer)

  const totalRevenue = useMemo(() => list.reduce((a, c) => a + c.spent, 0), [list])
  const top = useMemo(() => (list.length ? list.reduce((a, c) => (c.spent > a.spent ? c : a), list[0]) : null), [list])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const f = !q
      ? list
      : list.filter(
          ({ customer: c }) => c.name.toLowerCase().includes(q) || (c.cedula && c.cedula.includes(search)) || (c.phone && c.phone.includes(search)),
        )
    return [...f].sort((a, b) => b.spent - a.spent)
  }, [list, search])

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
    <div className="p-3.5">
      <p className="mb-3.5 font-display text-[21px] font-bold">Clientes</p>

      <div className="mb-3.5 grid grid-cols-3 gap-2">
        <StatBox label="Total" value={String(list.length)} color="text-blue" />
        <StatBox label="Facturado" value={formatMoney(totalRevenue)} color="text-lime" small />
        <StatBox label="Top" value={top ? top.customer.name.split(' ')[0] : '—'} color="text-purple" small />
      </div>

      <button onClick={openNew} className="mb-3 w-full rounded-[10px] bg-lime py-3 text-[15px] font-bold text-black">
        + Agregar Cliente
      </button>

      <input className="search-input" placeholder="🔍 Nombre, cédula o teléfono..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {!filtered.length ? (
        <div className="p-10 text-center text-muted">
          <div className="mb-2.5 text-4xl">👥</div>
          <p className="text-[13px]">Sin clientes aún</p>
        </div>
      ) : (
        filtered.map(({ customer: c, spent, pts, salesCount, tier: t }) => (
          <button key={c.id} onClick={() => setProfile(c)} className="mb-2 flex w-full items-center gap-3 rounded-[14px] border border-br bg-s1 p-3.5 text-left">
            <CustomerAvatar name={c.name} spent={spent} size={46} />
            <div className="min-w-0 flex-1">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-bold">{c.name}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {c.cedula ? '🪪 ' + c.cedula + ' · ' : ''}
                {c.phone || 'Sin teléfono'} · {salesCount} compra{salesCount !== 1 ? 's' : ''}
              </div>
              <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${t.badgeClass}`}>{t.label}</span>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="font-mono text-[14px] text-lime">{formatMoney(spent)}</div>
              <div className="text-[11px] text-muted">⭐ {pts} pts</div>
            </div>
          </button>
        ))
      )}

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

function StatBox({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-br bg-s1 p-3 text-center">
      <div className={`font-mono font-bold ${small ? 'text-[15px]' : 'text-[19px]'} ${color}`}>{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  )
}
