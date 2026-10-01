import { memo } from 'react'
import { Plus } from 'lucide-react'
import type { Product } from '../../../types/product'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { unitShortLabel, isMeasuredUnit } from '../../../shared/lib/units'

interface ProductCardProps {
  product: Product
  qtyInCart: number
  onClick: () => void
}

/** Memoized so an unrelated cart change doesn't re-render every card in a 1000+ product grid
 * (the grid itself is virtualized in ProductGrid, so this only has to handle in-place updates). */
export const ProductCard = memo(function ProductCard({ product: p, qtyInCart, onClick }: ProductCardProps) {
  const outOfStock = p.stock <= 0
  const lowStock = p.stock > 0 && p.min > 0 && p.stock <= p.min
  const measured = isMeasuredUnit(p.unit)
  const ul = measured ? unitShortLabel(p.unit) : ''
  const priceDisplay = measured ? `${formatMoney(p.price)}/${ul}` : formatMoney(p.price)
  const stockLabel = outOfStock ? 'Sin stock' : `${formatQty(p.stock)} ${measured ? ul : 'uds'}`

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={outOfStock}
      className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition active:scale-[0.97] ${
        outOfStock ? 'pointer-events-none opacity-45' : 'hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-lg active:bg-s2'
      } ${lowStock ? 'border-orange/50' : 'border-br bg-s1'}`}
    >
      {qtyInCart > 0 && (
        <span className="absolute right-2 top-2 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-lime px-1 font-mono text-[10px] font-extrabold text-black">
          {formatQty(qtyInCart)}
        </span>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 min-h-[2.3em] text-[12.5px] font-semibold leading-tight">{p.name}</div>
        <div className="font-mono text-[15px] font-bold text-lime">{priceDisplay}</div>
      </div>
      <div
        className={`flex items-center justify-between gap-2 border-t px-3 py-2 ${
          outOfStock ? 'border-red/15 bg-red/5' : lowStock ? 'border-orange/15 bg-orange/5' : 'border-br bg-s2/60'
        }`}
      >
        <span className={`text-[10.5px] font-semibold ${outOfStock ? 'text-red' : lowStock ? 'text-orange' : 'text-muted'}`}>{stockLabel}</span>
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-lime text-black transition-transform group-hover:scale-110">
          <Plus size={14} strokeWidth={3} />
        </span>
      </div>
    </button>
  )
})
