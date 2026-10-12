import { useMemo, useState } from 'react'
import { AddFab } from '../../../shared/components/AddFab'
import { SearchInput } from '../../../shared/components/SearchInput'
import { nextSort, type SortState } from '../../../shared/lib/sortRows'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import { countByStatus, DEFAULT_ORDER_SORT, filterOrders, sortOrders, type OrderRow, type OrderSortKey, type OrderStatusFilter } from '../lib/orderRows'
import { OrderDetailSheet } from './OrderDetailSheet'
import { OrderTable } from './OrderTable'
import { ReceiveOrderSheet } from './ReceiveOrderSheet'

const FILTERS: Array<{ key: OrderStatusFilter; label: string; empty: string }> = [
  { key: 'pedido', label: 'Por recibir', empty: 'No hay pedidos por recibir.' },
  { key: 'borrador', label: 'Borradores', empty: 'No hay borradores.' },
  { key: 'recibido', label: 'Recibidos', empty: 'Aún no has recibido ningún pedido.' },
  { key: 'cancelado', label: 'Cancelados', empty: 'No hay pedidos cancelados.' },
  { key: 'todos', label: 'Todos', empty: '' },
]

interface OrderListProps {
  rows: OrderRow[]
  /** Opens the new-order tab (the floating "+"). */
  onNew: () => void
  onEditDraft: (o: PurchaseOrder) => void
}

/** The Pedidos tab: every purchase order in a table, by default the ones still to arrive. */
export function OrderList({ rows: all, onNew, onEditDraft }: OrderListProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderStatusFilter>('pedido')
  const [sort, setSort] = useState<SortState<OrderSortKey>>(DEFAULT_ORDER_SORT)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)

  const counts = useMemo(() => countByStatus(all), [all])
  const rows = useMemo(() => sortOrders(filterOrders(all, search, status), sort), [all, search, status, sort])
  // Looked up live so the sheet reflects changes (e.g. just received) instead of a stale copy.
  const detail = detailId !== null ? (all.find((r) => r.id === detailId)?.order ?? null) : null
  const emptyText = FILTERS.find((f) => f.key === status)?.empty

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} historyKey="pedidos" placeholder="Buscar pedido, proveedor o producto..." />
        <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatusFilter)} aria-label="Filtrar por estado" className="input w-auto min-w-[170px] py-2">
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} ({counts[f.key]})
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
          {all.length === 0
            ? 'Aún no hay pedidos — usa el botón + para hacer el primero.'
            : !search.trim() && emptyText
              ? emptyText
              : 'Ningún pedido coincide con la búsqueda o el filtro.'}
        </div>
      ) : (
        <OrderTable
          rows={rows}
          sort={sort}
          onSort={(key) => setSort((s) => nextSort(s, key))}
          resetKey={`${search}|${status}|${sort.key}|${sort.dir}`}
          onOpen={(o) => setDetailId(o.id ?? null)}
          onReceive={setReceiving}
          onEdit={onEditDraft}
        />
      )}

      <AddFab label="Nuevo pedido" onClick={onNew} />

      <OrderDetailSheet
        order={detail}
        onClose={() => setDetailId(null)}
        onEditDraft={(o) => {
          setDetailId(null)
          onEditDraft(o)
        }}
        onReceive={(o) => {
          setDetailId(null)
          setReceiving(o)
        }}
      />
      <ReceiveOrderSheet order={receiving} onClose={() => setReceiving(null)} onReceived={() => setReceiving(null)} />
    </>
  )
}
