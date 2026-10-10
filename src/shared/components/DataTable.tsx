import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { fitColumns } from '../lib/fitColumns'
import type { SortState } from '../lib/sortRows'

export interface DataColumn<T, K extends string = string> {
  key: string
  label: string
  /** Minimum width in px; the one `grow` column takes whatever space is left over. */
  min: number
  grow?: boolean
  align?: 'right' | 'center'
  /** Makes the header a sort button for this key. */
  sortKey?: K
  /** Shows the header as a lock that runs this (e.g. reveals masked data) instead of sorting. */
  lock?: { title: string; onClick: () => void }
  /** A right-aligned row of buttons instead of the default stacked text cell. */
  actions?: boolean
  /** The column goes when the screen is too narrow for all of them (lowest number first), if that avoids scrolling sideways. */
  drop?: number
  cell: (row: T) => ReactNode
}

interface DataTableProps<T, K extends string> {
  columns: DataColumn<T, K>[]
  rows: T[]
  rowKey: (row: T) => string | number
  sort: SortState<K>
  onSort: (key: K) => void
  /** Changes whenever the visible list is re-queried (search/filter/sort) → scroll back to top. */
  resetKey: string
  /** Makes whole rows clickable (buttons inside a row must stop propagation themselves). */
  onRowClick?: (row: T) => void
  /** Extra classes for a row, e.g. to dim the ones that are settled. */
  rowClassName?: (row: T) => string
  rowHeight?: number
  /** Extra room under the last row, to scroll it clear of a floating button. */
  bottomSpace?: number
  /** Tighter cells (8px instead of 10px at each side): for a list with many columns that has to fit a laptop screen without scrolling sideways. */
  dense?: boolean
}

/** Spreadsheet-style list shared by Stock, Clientes, Fiados and Facturas: sticky header, grid lines,
 * sortable columns. Rows are virtualized — only the ones near the viewport exist in the DOM,
 * which keeps a 1000+ row list smooth (rendering all of them at once is what made the old card
 * grids janky). Built from CSS-grid rows instead of a `<table>` because a table can't absolutely
 * position its rows. */
export function DataTable<T, K extends string>({ columns, rows, rowKey, sort, onSort, resetKey, onRowClick, rowClassName, rowHeight = 46, bottomSpace = 0, dense = false }: DataTableProps<T, K>) {
  const px = dense ? 'px-2' : 'px-2.5'
  const scrollRef = useRef<HTMLDivElement>(null)
  // The room the table has (without its own vertical scrollbar), to leave out the columns that don't fit.
  const [room, setRoom] = useState<number | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const watch = new ResizeObserver(() => setRoom(el.clientWidth))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const shown = useMemo(() => fitColumns(columns, room), [columns, room])
  const template = useMemo(() => shown.map((c) => (c.grow ? `minmax(${c.min}px,1fr)` : `${c.min}px`)).join(' '), [shown])
  const minWidth = useMemo(() => shown.reduce((sum, c) => sum + c.min, 0), [shown])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 14,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

  function cellClass(col: DataColumn<T, K>) {
    const base = `flex min-w-0 border-r border-br/70 ${px} last:border-r-0`
    if (col.actions) return `${base} flex-row items-center justify-end gap-1`
    const align = col.align === 'right' ? 'items-end text-right' : col.align === 'center' ? 'items-center text-center' : 'items-start'
    return `${base} flex-col justify-center ${align}`
  }

  return (
    <div ref={scrollRef} role="table" aria-rowcount={rows.length + 1} className="min-h-0 flex-1 overflow-auto rounded-xl border border-br bg-s1 shadow-xs">
      <div style={{ minWidth }}>
        <div role="row" aria-rowindex={1} className="sticky top-0 z-10 grid border-b border-br bg-s2" style={{ gridTemplateColumns: template }}>
          {shown.map((col) => {
            const active = !col.lock && !!col.sortKey && sort.key === col.sortKey
            const justify = col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'
            return (
              <div
                key={col.key}
                role="columnheader"
                aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className="flex min-w-0 border-r border-br last:border-r-0"
              >
                {col.lock ? (
                  <button
                    onClick={col.lock.onClick}
                    title={col.lock.title}
                    className={`flex w-full items-center gap-1 ${px} py-2 text-[11px] font-semibold text-txt2 transition-colors hover:text-txt ${justify}`}
                  >
                    <Lock size={11} />
                    {col.label}
                  </button>
                ) : col.sortKey ? (
                  <button
                    onClick={() => onSort(col.sortKey!)}
                    className={`flex w-full items-center gap-1 ${px} py-2 text-[11px] font-semibold transition-colors hover:text-txt ${justify} ${active ? 'text-lime' : 'text-txt2'}`}
                  >
                    {col.label}
                    {active && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </button>
                ) : (
                  <span className={`flex w-full items-center ${px} py-2 text-[11px] font-semibold text-txt2 ${justify}`}>{col.label}</span>
                )}
              </div>
            )
          })}
        </div>

        <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index]
            if (!row) return null
            return (
              <div
                key={rowKey(row)}
                role="row"
                aria-rowindex={vRow.index + 2}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={`absolute left-0 right-0 grid border-b border-br text-[12px] transition-colors hover:bg-s3/60 ${vRow.index % 2 ? 'bg-s2' : ''} ${
                  onRowClick ? 'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lime' : ''
                } ${rowClassName?.(row) ?? ''}`}
                style={{ height: rowHeight, transform: `translateY(${vRow.start}px)`, gridTemplateColumns: template }}
              >
                {shown.map((col) => (
                  <div key={col.key} role="cell" className={cellClass(col)}>
                    {col.cell(row)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        {bottomSpace > 0 && <div style={{ height: bottomSpace }} />}
      </div>
    </div>
  )
}
