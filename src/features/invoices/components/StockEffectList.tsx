import { formatQty } from '../../../shared/lib/currency'
import type { StockEffect } from '../../../shared/lib/saleStock'

/** What a change to an invoice does to the inventory, product by product — spelled out before saving, because it is
 * the thing nobody wants to get wrong. The server applies exactly this list (`stockEffect`). */
export function StockEffectList({ effect }: { effect: StockEffect[] }) {
  if (!effect.length) return <div className="text-txt2">El inventario no cambia.</div>
  return (
    <ul className="space-y-0.5">
      {effect.map((e) => (
        <li key={e.code} className="flex justify-between gap-3">
          <span className="min-w-0 truncate" title={e.name}>
            {e.name}
          </span>
          <span className={`flex-shrink-0 font-mono font-semibold ${e.delta > 0 ? 'text-green' : 'text-orange'}`}>
            {e.delta > 0 ? `+${formatQty(e.delta)} vuelve al inventario` : `−${formatQty(-e.delta)} sale del inventario`}
          </span>
        </li>
      ))}
    </ul>
  )
}
