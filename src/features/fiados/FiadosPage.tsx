import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import { groupFiados, groupTotals } from './lib/fiadoGrouping'
import { FiadoDetailSheet } from './components/FiadoDetailSheet'
import { formatMoney } from '../../shared/lib/currency'
import { initials } from '../../shared/lib/text'

export function FiadosPage() {
  const sales = useLiveQuery(() => db.sales.toArray(), [], []) as Sale[]
  const customers = useLiveQuery(() => db.customers.toArray(), [], [])
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const groups = useMemo(() => groupFiados(sales), [sales])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => {
      const c = g.customerId ? customerById.get(g.customerId) : null
      return g.name.toLowerCase().includes(q) || (c?.cedula && c.cedula.includes(search)) || (c?.phone && c.phone.includes(search))
    })
  }, [groups, search, customerById])

  const pendingGroups = groups.filter((g) => groupTotals(g).totalDebt > 0)
  const totalDebt = pendingGroups.reduce((a, g) => a + groupTotals(g).totalDebt, 0)

  const selectedGroup = filtered.find((g) => g.key === selectedKey) ?? null
  const selectedCustomer = selectedGroup?.customerId ? customerById.get(selectedGroup.customerId) ?? null : null

  return (
    <div className="p-3.5 md:mx-auto md:max-w-[1400px] md:p-5">
      <p className="mb-3.5 font-display text-[21px] font-bold md:mb-2.5 md:text-[22px]">Fiados</p>

      <div className="mb-3.5 grid grid-cols-3 gap-2 md:max-w-lg md:gap-3">
        <StatBox label="Deudas" value={String(pendingGroups.length)} color="text-red" />
        <StatBox label="Total debido" value={formatMoney(totalDebt)} color="text-orange" small />
        <StatBox label="Personas" value={String(pendingGroups.length)} color="text-blue" />
      </div>

      <input className="search-input md:max-w-md" placeholder="Buscar por nombre o cédula..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {!filtered.length ? (
        <div className="p-10 text-center text-muted">
          <p className="text-[13px]">Sin fiados pendientes</p>
        </div>
      ) : (
        <div className="md:grid md:grid-cols-2 md:gap-3 xl:grid-cols-3">
          {filtered.map((g) => {
            const { totalOwed, totalDebt: debt, totalPaid, isPaid } = groupTotals(g)
            const pct = totalOwed > 0 ? (totalPaid / totalOwed) * 100 : 0
            const c = g.customerId ? customerById.get(g.customerId) : null
            return (
              <button
                key={g.key}
                onClick={() => setSelectedKey(g.key)}
                className={`mb-2.5 block w-full rounded-[14px] border p-3.5 text-left transition-colors md:mb-0 ${isPaid ? 'border-green/30 opacity-60 hover:opacity-80' : 'border-br hover:border-br2 hover:bg-s2'} bg-s1`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[15px] font-bold">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-red/25 bg-red/10 text-[12px] text-red">
                        {initials(g.name)}
                      </span>
                      {g.name}
                    </div>
                    {c && (
                      <div className="ml-10 mt-0.5 text-[11px] text-muted">
                        {c.cedula ? c.cedula + ' · ' : ''}
                        {c.phone || ''}
                      </div>
                    )}
                    <div className="ml-10 mt-0.5 text-[12px] text-txt2">
                      {g.sales.length} fiado{g.sales.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className={`font-mono text-[19px] font-bold ${isPaid ? 'text-green' : 'text-red'}`}>{isPaid ? '¡Pagado!' : formatMoney(debt)}</div>
                    {!isPaid && totalPaid > 0 && <div className="mt-0.5 text-[11px] text-green">Abonado: {formatMoney(totalPaid)}</div>}
                    {!isPaid && <div className="mt-0.5 text-[11px] text-muted">Total: {formatMoney(totalOwed)}</div>}
                  </div>
                </div>
                {!isPaid && totalPaid > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-s3">
                    <div className="h-full rounded-full bg-gradient-to-r from-green to-lime" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      <FiadoDetailSheet group={selectedGroup} customer={selectedCustomer} onClose={() => setSelectedKey(null)} />
    </div>
  )
}

function StatBox({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-br bg-s1 p-3 text-center">
      <div className={`font-mono font-bold ${small ? 'text-[15px]' : 'text-[19px]'} ${color}`}>{value}</div>
      <div className="mt-0.5 field-label">{label}</div>
    </div>
  )
}
