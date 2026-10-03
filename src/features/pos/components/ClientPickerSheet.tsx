import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { CustomerAvatar } from '../../customers/components/CustomerAvatar'
import { useCustomersWithSpent } from '../../customers/hooks/useCustomersWithSpent'
import { useCartStore } from '../../../store/useCartStore'
import { formatQty } from '../../../shared/lib/currency'

interface ClientPickerSheetProps {
  open: boolean
  onClose: () => void
}

/** Pick a customer for the cart — legacy `openPicker()`/`renderPicker()` (index.html L3508-3541). */
export function ClientPickerSheet({ open, onClose }: ClientPickerSheetProps) {
  const [q, setQ] = useState('')
  const list = useCustomersWithSpent()
  const setCustomer = useCartStore((s) => s.setCustomer)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const f = !query
      ? list
      : list.filter(
          ({ customer: c }) => c.name.toLowerCase().includes(query) || (c.cedula && c.cedula.includes(q)) || (c.phone && c.phone.includes(q)),
        )
    return [...f].sort((a, b) => b.spent - a.spent)
  }, [list, q])

  function pick(id: string, name: string) {
    setCustomer(id, name)
    onClose()
  }

  function clear() {
    setCustomer(null, null)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-[18px] font-bold">Seleccionar Cliente</p>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>
      <input className="search-input" placeholder="Nombre, cédula o teléfono..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />

      {!filtered.length ? (
        <div className="p-6 text-center text-muted">
          <p className="text-[13px]">Sin clientes registrados</p>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          {filtered.map(({ customer: c, spent, pts, tier: t }) => (
            <div key={c.id} onClick={() => pick(c.id, c.name)} className="flex cursor-pointer items-center gap-2.5 rounded-xl p-2.5 active:bg-s2">
              <CustomerAvatar name={c.name} spent={spent} size={38} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{c.name}</div>
                <div className="text-[11px] text-muted">
                  {c.cedula ? c.cedula + (c.phone ? ' · ' : '') : ''}
                  {c.phone || ''}
                </div>
                <div className="font-mono text-[11px] text-lime">
                  {formatQty(pts)} pts · {t.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={clear} className="mt-2.5 w-full rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
        Sin cliente / Público general
      </button>
    </BottomSheet>
  )
}
