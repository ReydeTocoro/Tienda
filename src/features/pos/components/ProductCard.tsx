import type { Product } from '../../../types/product'
import { formatMoney } from '../../../shared/lib/currency'

const CAT_EMOJI: Record<string, string> = {
  bebida: '🥤',
  bebidas: '🥤',
  comida: '🍔',
  snack: '🍟',
  snacks: '🍟',
  limpieza: '🧹',
  electrónico: '📱',
  electronico: '📱',
  ropa: '👕',
  herramienta: '🔧',
}

interface ProductCardProps {
  product: Product
  qtyInCart: number
  onClick: () => void
}

export function ProductCard({ product: p, qtyInCart, onClick }: ProductCardProps) {
  const outOfStock = p.stock <= 0
  const lowStock = p.stock > 0 && p.min > 0 && p.stock <= p.min
  const emoji = CAT_EMOJI[(p.cat || '').toLowerCase()] || '📦'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={outOfStock}
      className={`relative flex flex-col gap-0.5 rounded-xl border p-2.5 pb-2 text-left transition active:scale-[0.96] ${
        outOfStock ? 'pointer-events-none opacity-45' : 'active:bg-s2'
      } ${lowStock ? 'border-orange' : 'border-br bg-s1'}`}
    >
      {qtyInCart > 0 && (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-lime px-1.5 py-px font-mono text-[9px] font-extrabold text-black">
          {qtyInCart}
        </span>
      )}
      <div className="text-xl leading-none">{emoji}</div>
      <div className="line-clamp-2 text-[12px] font-bold leading-tight">{p.name}</div>
      <div className="mt-0.5 font-mono text-[14px] font-bold text-lime">{formatMoney(p.price)}</div>
      <div className="text-[10px] text-muted">
        {outOfStock ? <span className="text-red">Sin stock</span> : `Stock: ${p.stock}${lowStock ? ' ⚠' : ''}`}
      </div>
      <span className="absolute bottom-1.5 right-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-md bg-lime text-[14px] font-extrabold leading-none text-black">
        +
      </span>
    </button>
  )
}
