import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronUp, PackageOpen, Pencil, Trash2 } from 'lucide-react'
import type { Product } from '../../../types/product'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { isMeasuredUnit, unitFullName, unitShortLabel } from '../../../shared/lib/units'
import type { SortKey, SortState } from '../lib/productSort'

type ColumnKey = 'code' | 'name' | 'cat' | 'unit' | 'stock' | 'min' | 'price' | 'cost' | 'margin' | 'invested' | 'status' | 'actions'

interface Column {
  key: ColumnKey
  label: string
  /** Minimum width in px; the single `grow` column takes whatever space is left over. */
  min: number
  grow?: boolean
  align?: 'right' | 'center'
  sortKey?: SortKey
  /** Cost/margin/investment columns only exist while costs are revealed. */
  costOnly?: boolean
}

const COLUMNS: Column[] = [
  { key: 'code', label: 'Código', min: 126, sortKey: 'code' },
  { key: 'name', label: 'Producto', min: 180, grow: true, sortKey: 'name' },
  { key: 'cat', label: 'Categoría', min: 104, sortKey: 'cat' },
  { key: 'unit', label: 'Unidad', min: 68 },
  { key: 'stock', label: 'Stock', min: 88, align: 'right', sortKey: 'stock' },
  { key: 'min', label: 'Mín.', min: 52, align: 'right' },
  { key: 'price', label: 'Precio', min: 120, align: 'right', sortKey: 'price' },
  { key: 'cost', label: 'Costo', min: 100, align: 'right', sortKey: 'cost', costOnly: true },
  { key: 'margin', label: 'Margen', min: 70, align: 'right', sortKey: 'margin', costOnly: true },
  { key: 'invested', label: 'Invertido', min: 116, align: 'right', sortKey: 'invested', costOnly: true },
  { key: 'status', label: 'Estado', min: 80, align: 'center' },
  { key: 'actions', label: '', min: 156 },
]

const ROW_HEIGHT = 46

type Status = 'out' | 'low' | 'ok'

function statusOf(p: Product): Status {
  if (p.stock <= 0) return 'out'
  if (p.min > 0 && p.stock <= p.min) return 'low'
  return 'ok'
}

const STATUS_PILL: Record<Status, { label: string; cls: string }> = {
  out: { label: 'Agotado', cls: 'border-red/30 bg-red/10 text-red' },
  low: { label: 'Bajo', cls: 'border-orange/30 bg-orange/10 text-orange' },
  ok: { label: 'OK', cls: 'border-green/30 bg-green/10 text-green' },
}

interface ProductTableProps {
  products: Product[]
  /** Every product by code — a package's loose-unit stock lives on a sibling product. */
  byCode: Map<string, Product>
  showCosts: boolean
  sort: SortState
  onSort: (key: SortKey) => void
  /** Changes whenever the visible list is re-queried (search/category/sort) → scroll back to top. */
  resetKey: string
  onEdit: (p: Product) => void
  onDelete: (p: Product) => void
  onQuickStock: (p: Product, delta: number) => void
  onOpenPackage: (p: Product) => void
}

/** Spreadsheet-style product list: sticky header, grid lines, sortable columns. Rows are
 * virtualized — only the ones near the viewport exist in the DOM, which is what keeps a
 * 1000+ product inventory smooth (rendering all of them at once is what made the card grid
 * janky). Built from CSS-grid rows instead of a `<table>` because a table can't absolutely
 * position its rows. */
export function ProductTable({ products, byCode, showCosts, sort, onSort, resetKey, onEdit, onDelete, onQuickStock, onOpenPackage }: ProductTableProps) {
  const cols = useMemo(() => COLUMNS.filter((c) => showCosts || !c.costOnly), [showCosts])
  const template = useMemo(() => cols.map((c) => (c.grow ? `minmax(${c.min}px,1fr)` : `${c.min}px`)).join(' '), [cols])
  const minWidth = useMemo(() => cols.reduce((sum, c) => sum + c.min, 0), [cols])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

  function cellClass(col: Column) {
    const base = 'flex min-w-0 border-r border-br/70 px-2.5 last:border-r-0'
    if (col.key === 'actions') return `${base} flex-row items-center justify-end gap-1`
    const align = col.align === 'right' ? 'items-end text-right' : col.align === 'center' ? 'items-center text-center' : 'items-start'
    return `${base} flex-col justify-center ${align}`
  }

  function renderCell(key: ColumnKey, p: Product): ReactNode {
    const measured = isMeasuredUnit(p.unit)
    const ul = p.esPaquete ? 'paq' : unitShortLabel(p.unit || 'unidad')
    const status = statusOf(p)
    switch (key) {
      case 'code':
        return (
          <span className="max-w-full truncate font-mono text-[11.5px] text-txt2" title={p.code}>
            {p.code}
          </span>
        )
      case 'name':
        return (
          <>
            <span className="max-w-full truncate text-[13px] font-semibold" title={p.name}>
              {p.name}
            </span>
            {(p.brand || p.esPaquete) && (
              <span className="flex max-w-full items-center gap-1.5 text-[11px] text-muted">
                {p.esPaquete && <span className="flex-shrink-0 rounded border border-purple/25 bg-purple/10 px-1 text-[10px] font-bold text-purple">Paq ×{p.unidadesPor}</span>}
                {p.brand && <span className="truncate">{p.brand}</span>}
              </span>
            )}
          </>
        )
      case 'cat':
        return (
          <span className="max-w-full truncate text-txt2" title={p.cat}>
            {p.cat || '—'}
          </span>
        )
      case 'unit':
        return <span className="max-w-full truncate text-txt2">{unitFullName(p.unit || 'unidad')}</span>
      case 'stock': {
        const loose = p.esPaquete && p.codigoSuelta ? (byCode.get(p.codigoSuelta)?.stock ?? 0) : null
        return (
          <>
            <span className={`font-mono text-[13px] font-bold ${status === 'out' ? 'text-red' : status === 'low' ? 'text-orange' : 'text-txt'}`}>
              {formatQty(p.stock)} <span className="text-[10px] font-normal text-muted">{ul}</span>
            </span>
            {loose !== null && <span className="text-[10px] text-muted">+ {formatQty(loose)} sueltas</span>}
          </>
        )
      }
      case 'min':
        return <span className="font-mono text-txt2">{formatQty(p.min)}</span>
      case 'price':
        return (
          <span className="font-mono text-[12.5px] font-bold text-lime">
            {formatMoney(p.price)}
            {measured && <span className="text-[10px] font-normal text-muted">/{ul}</span>}
          </span>
        )
      case 'cost':
        return <span className="font-mono text-txt2">{formatMoney(p.cost)}</span>
      case 'margin':
        return <span className="font-mono text-green">{p.cost > 0 ? `${(((p.price - p.cost) / p.cost) * 100).toFixed(1)}%` : '—'}</span>
      case 'invested':
        return <span className="font-mono font-semibold text-orange">{formatMoney((p.cost || 0) * (p.stock || 0))}</span>
      case 'status':
        return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_PILL[status].cls}`}>{STATUS_PILL[status].label}</span>
      case 'actions':
        return (
          <>
            <button onClick={() => onQuickStock(p, -1)} title="Descontar 1" className="h-7 min-w-7 rounded-md border border-br2 px-1.5 text-[11px] font-semibold text-txt2 transition-colors hover:border-orange/40 hover:text-orange">
              −1
            </button>
            <button onClick={() => onQuickStock(p, 1)} title="Sumar 1" className="h-7 min-w-7 rounded-md border border-br2 px-1.5 text-[11px] font-semibold text-txt2 transition-colors hover:border-green/40 hover:text-green">
              +1
            </button>
            {p.esPaquete && (
              <button onClick={() => onOpenPackage(p)} title="Abrir / vender paquete" aria-label="Abrir o vender paquete" className="flex h-7 w-7 items-center justify-center rounded-md border border-purple/30 bg-purple/10 text-purple transition-colors hover:bg-purple/20">
                <PackageOpen size={14} />
              </button>
            )}
            <button onClick={() => onEdit(p)} title="Editar" aria-label="Editar" className="flex h-7 w-7 items-center justify-center rounded-md border border-br2 text-txt2 transition-colors hover:border-lime/40 hover:text-lime">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDelete(p)} title="Eliminar" aria-label="Eliminar" className="flex h-7 w-7 items-center justify-center rounded-md border border-red/30 text-red transition-colors hover:bg-red/10">
              <Trash2 size={14} />
            </button>
          </>
        )
    }
  }

  return (
    <div ref={scrollRef} role="table" aria-rowcount={products.length + 1} className="min-h-0 flex-1 overflow-auto rounded-xl border border-br bg-s1">
      <div style={{ minWidth }}>
        <div role="row" aria-rowindex={1} className="sticky top-0 z-10 grid border-b border-br2 bg-s3" style={{ gridTemplateColumns: template }}>
          {cols.map((col) => {
            const active = !!col.sortKey && sort.key === col.sortKey
            const justify = col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'
            return (
              <div
                key={col.key}
                role="columnheader"
                aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className="flex min-w-0 border-r border-br2/60 last:border-r-0"
              >
                {col.sortKey ? (
                  <button
                    onClick={() => onSort(col.sortKey!)}
                    className={`flex w-full items-center gap-1 px-2.5 py-2 text-[11px] font-semibold transition-colors hover:text-txt ${justify} ${active ? 'text-lime' : 'text-txt2'}`}
                  >
                    {col.label}
                    {active && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </button>
                ) : (
                  <span className={`flex w-full items-center px-2.5 py-2 text-[11px] font-semibold text-txt2 ${justify}`}>{col.label}</span>
                )}
              </div>
            )
          })}
        </div>

        <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const p = products[vRow.index]
            if (!p) return null
            return (
              <div
                key={p.code}
                role="row"
                aria-rowindex={vRow.index + 2}
                className={`absolute left-0 right-0 grid border-b border-br text-[12px] transition-colors hover:bg-s3/60 ${vRow.index % 2 ? 'bg-s2/40' : ''}`}
                style={{ height: ROW_HEIGHT, transform: `translateY(${vRow.start}px)`, gridTemplateColumns: template }}
              >
                {cols.map((col) => (
                  <div key={col.key} role="cell" className={cellClass(col)}>
                    {renderCell(col.key, p)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        {/* Room to scroll the last rows clear of the floating "+" button. */}
        <div className="h-20" />
      </div>
    </div>
  )
}
