import { useMemo } from 'react'
import { PackageOpen, Pencil, Trash2 } from 'lucide-react'
import type { Product } from '../../../types/product'
import { DataTable, type DataColumn } from '../../../shared/components/DataTable'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { isMeasuredUnit, unitFullName, unitShortLabel } from '../../../shared/lib/units'
import type { SortKey, SortState } from '../lib/productSort'

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
  /** Reveals the costs — what the locked "Precio de compra" header does. Absent for someone who may
   * not see purchase prices: then there's no such column. */
  onRevealCosts?: () => void
  sort: SortState
  onSort: (key: SortKey) => void
  /** Changes whenever the visible list is re-queried (search/category/sort) → scroll back to top. */
  resetKey: string
  onEdit: (p: Product) => void
  onDelete: (p: Product) => void
  onQuickStock: (p: Product, delta: number) => void
  onOpenPackage: (p: Product) => void
}

/** Stock list on the shared spreadsheet-style `DataTable`. For whoever may see purchase prices the
 * column is listed but masked (the header is a lock) until revealed; margin and investment only
 * exist while revealed. */
export function ProductTable({ products, byCode, showCosts, onRevealCosts, sort, onSort, resetKey, onEdit, onDelete, onQuickStock, onOpenPackage }: ProductTableProps) {
  const columns = useMemo<DataColumn<Product, SortKey>[]>(() => {
    const unitLabel = (p: Product) => (p.esPaquete ? 'paq' : unitShortLabel(p.unit || 'unidad'))

    const all: DataColumn<Product, SortKey>[] = [
      {
        key: 'code',
        label: 'Código',
        min: 118,
        sortKey: 'code',
        cell: (p) => (
          <span className="max-w-full truncate font-mono text-[11.5px] text-txt2" title={p.code}>
            {p.code}
          </span>
        ),
      },
      {
        key: 'name',
        label: 'Producto',
        min: 180,
        grow: true,
        sortKey: 'name',
        cell: (p) => (
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
        ),
      },
      {
        key: 'cat',
        label: 'Categoría',
        min: 96,
        sortKey: 'cat',
        cell: (p) => (
          <span className="max-w-full truncate text-txt2" title={p.cat}>
            {p.cat || '—'}
          </span>
        ),
      },
      { key: 'unit', label: 'Unidad', min: 60, cell: (p) => <span className="max-w-full truncate text-txt2">{unitFullName(p.unit || 'unidad')}</span> },
      {
        key: 'stock',
        label: 'Stock',
        min: 84,
        align: 'right',
        sortKey: 'stock',
        cell: (p) => {
          const status = statusOf(p)
          const loose = p.esPaquete && p.codigoSuelta ? (byCode.get(p.codigoSuelta)?.stock ?? 0) : null
          return (
            <>
              <span className={`font-mono text-[13px] font-bold ${status === 'out' ? 'text-red' : status === 'low' ? 'text-orange' : 'text-txt'}`}>
                {formatQty(p.stock)} <span className="text-[10px] font-normal text-muted">{unitLabel(p)}</span>
              </span>
              {loose !== null && <span className="text-[10px] text-muted">+ {formatQty(loose)} sueltas</span>}
            </>
          )
        },
      },
      { key: 'min', label: 'Mín.', min: 48, align: 'right', cell: (p) => <span className="font-mono text-txt2">{formatQty(p.min)}</span> },
      // Only for someone who may see purchase prices: listed but masked (the header is a lock, not a
      // sort) until they reveal them — so the price has a place without showing on a shared screen.
      ...(onRevealCosts ? [{
        key: 'cost',
        label: 'Precio de compra',
        min: 128,
        align: 'right',
        sortKey: 'cost',
        lock: showCosts ? undefined : { title: 'Ver precios de compra', onClick: onRevealCosts },
        cell: (p) =>
          showCosts ? (
            <span className="font-mono text-txt2">
              {formatMoney(p.cost)}
              {isMeasuredUnit(p.unit) && <span className="text-[10px] font-normal text-muted">/{unitLabel(p)}</span>}
            </span>
          ) : (
            <span title="Oculto: toca el candado del encabezado para verlos" className="select-none font-mono text-muted/60">
              ••••
            </span>
          ),
      } satisfies DataColumn<Product, SortKey>] : []),
      {
        key: 'price',
        label: 'Precio de venta',
        min: 120,
        align: 'right',
        sortKey: 'price',
        cell: (p) => (
          <span className="font-mono text-[12.5px] font-bold text-lime">
            {formatMoney(p.price)}
            {isMeasuredUnit(p.unit) && <span className="text-[10px] font-normal text-muted">/{unitLabel(p)}</span>}
          </span>
        ),
      },
      {
        key: 'margin',
        label: 'Margen',
        min: 70,
        align: 'right',
        sortKey: 'margin',
        cell: (p) => <span className="font-mono text-green">{(p.cost ?? 0) > 0 ? `${(((p.price - p.cost!) / p.cost!) * 100).toFixed(1)}%` : '—'}</span>,
      },
      {
        key: 'invested',
        label: 'Invertido',
        min: 116,
        align: 'right',
        sortKey: 'invested',
        cell: (p) => <span className="font-mono font-semibold text-orange">{formatMoney((p.cost || 0) * (p.stock || 0))}</span>,
      },
      {
        key: 'status',
        label: 'Estado',
        min: 80,
        align: 'center',
        cell: (p) => {
          const pill = STATUS_PILL[statusOf(p)]
          return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${pill.cls}`}>{pill.label}</span>
        },
      },
      {
        key: 'actions',
        label: '',
        min: 156,
        actions: true,
        cell: (p) => (
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
        ),
      },
    ]
    // Margin/investment columns only exist while costs are revealed.
    return all.filter((c) => showCosts || (c.key !== 'margin' && c.key !== 'invested'))
  }, [showCosts, byCode, onRevealCosts, onEdit, onDelete, onQuickStock, onOpenPackage])

  return <DataTable columns={columns} rows={products} rowKey={(p) => p.code} sort={sort} onSort={onSort} resetKey={resetKey} bottomSpace={80} />
}
