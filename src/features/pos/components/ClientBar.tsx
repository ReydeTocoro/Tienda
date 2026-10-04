import { useState } from 'react'
import { ChevronRight, UserRound } from 'lucide-react'
import { useCartStore } from '../../../store/useCartStore'
import { useSelectedCustomerLoyalty } from '../hooks/useSelectedCustomerLoyalty'
import { CustomerAvatar } from '../../customers/components/CustomerAvatar'
import { formatQty } from '../../../shared/lib/currency'
import { ClientPickerSheet } from './ClientPickerSheet'

/** Customer row of the cart: the first section under the cart title, so who the sale is for is
 * decided inside the cart itself. Shows the picked customer (tier-colored avatar, tier, points
 * and whether the points discount is already available) and opens the picker on tap.
 * Legacy `.client-bar`/`#disc-banner` (index.html L972-984, `updateClientBar()` L3542-3559). */
export function ClientBar() {
  const customerName = useCartStore((s) => s.customerName)
  const setCustomer = useCartStore((s) => s.setCustomer)
  const { spent, pts, tier } = useSelectedCustomerLoyalty()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex-shrink-0 border-y border-br">
      <button onClick={() => setOpen(true)} title="Seleccionar cliente" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-s2">
        {customerName ? (
          <CustomerAvatar name={customerName} spent={spent} size={34} />
        ) : (
          <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border border-dashed border-br2 text-muted">
            <UserRound size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {customerName ? (
            <>
              <div className="truncate text-[13px] font-semibold">{customerName}</div>
              <div className="truncate text-[11px] text-muted">
                {tier.label}
                {pts >= 50 && <span className="text-purple"> · Descuento disponible</span>}
              </div>
            </>
          ) : (
            <>
              <div className="field-label">Cliente</div>
              <div className="text-[13px] font-semibold text-txt2">Sin cliente</div>
            </>
          )}
        </div>
        {customerName && <span className="hidden flex-shrink-0 font-mono text-[12px] font-bold text-lime sm:inline">{formatQty(pts)} pts</span>}
        <ChevronRight size={16} className="flex-shrink-0 text-muted" />
      </button>
      <ClientPickerSheet open={open} onClose={() => setOpen(false)} onPick={setCustomer} onClear={() => setCustomer(null, null)} />
    </div>
  )
}
