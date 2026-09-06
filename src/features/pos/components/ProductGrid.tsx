import { useMemo } from 'react'
import type { Product } from '../../../types/product'
import type { CartItem } from '../../../types/cartItem'
import { ProductCard } from './ProductCard'

interface ProductGridProps {
  products: Product[]
  cart: CartItem[]
  search: string
  activeCat: string
  onSetCat: (cat: string) => void
  onPick: (p: Product) => void
  onOpenFree: () => void
  lowStockOnly?: boolean
}

export function ProductGrid({ products, cart, search, activeCat, onSetCat, onPick, onOpenFree, lowStockOnly }: ProductGridProps) {
  const cats = useMemo(() => ['__all__', ...Array.from(new Set(products.map((p) => p.cat).filter(Boolean))).sort()], [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = products.filter((p) => {
      if (lowStockOnly) return p.stock > 0 && p.min > 0 && p.stock <= p.min
      if (activeCat !== '__all__' && (p.cat || '') !== activeCat) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)
    })
    list = [...list].sort((a, b) => {
      if (a.stock > 0 && b.stock <= 0) return -1
      if (a.stock <= 0 && b.stock > 0) return 1
      return a.name.localeCompare(b.name)
    })
    return list
  }, [products, search, activeCat, lowStockOnly])

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-br bg-bg">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-br bg-s1 px-3 py-2 md:px-4 md:py-2.5">
        <span className="text-[13px] font-bold md:text-[14px]">Productos</span>
        <span className="font-mono text-[11px] text-muted">{filtered.length}</span>
      </div>
      <div className="flex flex-shrink-0 gap-1.5 overflow-x-auto border-b border-br bg-s1 px-2.5 py-2 [scrollbar-width:none] md:px-4">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => onSetCat(c)}
            className={`flex-shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              activeCat === c ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:border-br2 hover:bg-s2 hover:text-txt'
            }`}
          >
            {c === '__all__' ? 'Todos' : c}
          </button>
        ))}
      </div>
      {!filtered.length ? (
        <div className="flex flex-1 items-center justify-center p-7 text-center text-muted">
          <div>
            <div className="mb-2 text-3xl">🔍</div>
            <p className="text-[13px]">Sin resultados</p>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto p-2 md:grid-cols-3 md:gap-2 md:p-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((p) => (
            <ProductCard key={p.code} product={p} qtyInCart={cart.find((c) => c.code === p.code)?.qty ?? 0} onClick={() => onPick(p)} />
          ))}
        </div>
      )}
      <button
        onClick={onOpenFree}
        className="m-2 flex flex-shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-br2 p-2 text-[12px] text-txt2 transition-colors hover:border-br2 hover:bg-s1 hover:text-txt md:m-3"
      >
        <span>🏷️</span> Producto sin registrar
      </button>
    </div>
  )
}
