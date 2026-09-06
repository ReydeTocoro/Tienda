import { useCartStore } from '../../../store/useCartStore'
import { useSelectedCustomerLoyalty } from '../hooks/useSelectedCustomerLoyalty'

interface ClientBarProps {
  onOpen: () => void
}

/** Selected-customer bar + loyalty discount banner — legacy `.client-bar`/`#disc-banner`
 * (index.html L972-984, `updateClientBar()` L3542-3559). */
export function ClientBar({ onOpen }: ClientBarProps) {
  const customerName = useCartStore((s) => s.customerName)
  const { pts, tier } = useSelectedCustomerLoyalty()

  return (
    <div className="flex flex-shrink-0 items-center gap-2 px-3 pt-2">
      <button
        onClick={onOpen}
        className={`flex min-w-0 flex-1 items-center justify-between rounded-xl border bg-s2 px-3.5 py-2.5 text-left ${customerName ? 'border-lime' : 'border-br2'}`}
      >
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted">Cliente</div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold">
            {customerName ? `${customerName} · ${tier.label}` : 'Sin cliente'}
          </div>
          {customerName && <div className="mt-0.5 font-mono text-[11px] text-lime">⭐ {pts} puntos</div>}
        </div>
        <span className="flex-shrink-0 text-[18px] text-muted">›</span>
      </button>
      {customerName && pts >= 50 && (
        <div className="flex flex-shrink-0 items-center gap-1.5 rounded-[10px] border border-purple/25 bg-purple/10 px-2.5 py-2 text-[12px] text-purple">
          🎁 Descuento disponible
        </div>
      )}
    </div>
  )
}
