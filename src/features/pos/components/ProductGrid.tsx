import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Tag } from 'lucide-react'
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

/** Column count at each breakpoint, mirroring the `grid-cols-*` classes below — read here too
 * since virtualizing rows means we have to slice products into rows ourselves. */
function useColumnCount() {
  const [cols, setCols] = useState(() => columnsForWidth(typeof window === 'undefined' ? 1024 : window.innerWidth))
  useEffect(() => {
    function update() {
      setCols(columnsForWidth(window.innerWidth))
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cols
}

function columnsForWidth(w: number) {
  if (w >= 1536) return 5
  if (w >= 1280) return 4
  if (w >= 768) return 3
  return 2
}

const ROW_HEIGHT = 132

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

  const columns = useColumnCount()
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowCount = Math.ceil(filtered.length / columns)

  // Products in the grid rarely number more than a few thousand even at the largest real
  // inventories, but rendering all of them as DOM nodes at once (no pagination in this app) is
  // what made the grid janky/garbled with 1000+ products — only the rows near the viewport get
  // mounted now.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  })

  const gridColsClass = 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'

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
            <p className="text-[13px]">Sin resultados</p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2.5 md:p-3">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const start = vRow.index * columns
              const rowProducts = filtered.slice(start, start + columns)
              return (
                <div
                  key={vRow.key}
                  className={`grid ${gridColsClass} gap-2 md:gap-2.5`}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vRow.size, transform: `translateY(${vRow.start}px)` }}
                >
                  {rowProducts.map((p) => (
                    <ProductCard key={p.code} product={p} qtyInCart={cart.find((c) => c.code === p.code)?.qty ?? 0} onClick={() => onPick(p)} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <button
        onClick={onOpenFree}
        className="m-2 flex flex-shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-br2 p-2 text-[12px] text-txt2 transition-colors hover:border-br2 hover:bg-s1 hover:text-txt md:m-3"
      >
        <Tag size={14} /> Producto sin registrar
      </button>
    </div>
  )
}
