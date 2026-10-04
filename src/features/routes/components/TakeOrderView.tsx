import { useReducer, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Trash2, Users } from 'lucide-react'
import { db } from '../../../db/index'
import { createRouteOrder, updateRouteOrder } from '../../../db/repositories/routeOrders'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import type { Product } from '../../../types/product'
import type { RouteOrder } from '../../../types/routeOrder'
import { ProductGrid } from '../../pos/components/ProductGrid'
import { ClientPickerSheet } from '../../pos/components/ClientPickerSheet'
import { draftFromRouteOrder, draftTotal, EMPTY_ROUTE_DRAFT, routeDraftReducer } from '../lib/routeOrderDraft'

interface TakeOrderViewProps {
  /** A pedido being continued (still 'tomado'/'preparado'); null = a brand-new one. */
  editing: RouteOrder | null
  onDone: () => void
}

/** "Tomar pedido": pick the business and what they want, from the same product grid as the POS
 * screen — but into a local draft (not the global cart), so taking a pedido never disturbs
 * whatever's in the register's cart. Nothing is real, and stock is untouched, until "Guardar".
 * Fills whatever height `RutasPage` hands it and never scrolls the page: the product grid and the
 * draft panel each own an internal scroll region, with "Tomar pedido" pinned at the panel's
 * bottom — the exact same `flex` shape as VentaPage's product grid + `CartPanel`. */
export function TakeOrderView({ editing, onDone }: TakeOrderViewProps) {
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const [draft, dispatch] = useReducer(routeDraftReducer, editing, (o) => (o ? draftFromRouteOrder(o) : EMPTY_ROUTE_DRAFT))
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState('__all__')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const total = draftTotal(draft.items)
  const totalQty = draft.items.reduce((a, i) => a + i.qty, 0)

  async function save() {
    const customerName = draft.customerName.trim()
    if (!customerName) {
      toast('Escribe o elige el negocio/cliente', 'orange')
      return
    }
    if (!draft.items.length) {
      toast('Agrega al menos un producto', 'orange')
      return
    }
    if (draft.items.some((i) => !(i.qty > 0))) {
      toast('Todas las cantidades deben ser mayores a 0', 'orange')
      return
    }
    setBusy(true)
    try {
      const input = { customerId: draft.customerId, customerName, items: draft.items, notes: draft.notes }
      const saved = editing?.id ? await updateRouteOrder(editing.id, input) : await createRouteOrder(input)
      toast(editing?.id ? 'Pedido actualizado' : `Pedido tomado para ${saved.customerName}`, 'green')
      dispatch({ type: 'clear' })
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 md:flex-row">
      <section className="flex min-h-0 flex-[0.42] flex-col md:flex-1">
        <div className="relative mb-2 flex-shrink-0">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input py-2 pl-9" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-br">
          <ProductGrid
            products={products}
            cart={draft.items}
            search={search}
            activeCat={activeCat}
            onSetCat={setActiveCat}
            onPick={(p) => dispatch({ type: 'pick', product: p })}
          />
        </div>
      </section>

      {/* Header (customer) pinned top, items+notes scroll in the middle, total+button pinned
       * bottom — same three-zone shape as CartPanel, so the button is always one tap away. */}
      <section className="flex min-h-0 flex-[0.58] flex-col overflow-hidden rounded-[14px] border border-br bg-s1 shadow-xs md:w-[360px] md:flex-none">
        <div className="flex-shrink-0 border-b border-br p-3">
          <div className="mb-2 text-[13px] font-bold">{editing ? 'Editando pedido' : 'Pedido nuevo'}</div>
          <label className="mb-1 block field-label">Negocio / Cliente *</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Nombre del negocio o cliente"
              value={draft.customerName}
              onChange={(e) => dispatch({ type: 'setCustomer', customerId: null, customerName: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              title="Elegir cliente registrado"
              className="flex flex-shrink-0 items-center justify-center rounded-[10px] border border-br2 bg-s1 px-3 text-txt2 transition-colors hover:border-lime/40 hover:bg-s2"
            >
              <Users size={17} />
            </button>
          </div>
          {draft.customerId && <div className="mt-1 text-[11px] text-lime">Cliente registrado seleccionado</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!draft.items.length ? (
            <div className="rounded-lg bg-s2 px-3 py-5 text-center text-[12px] text-muted">Toca productos de la lista para agregarlos.</div>
          ) : (
            draft.items.map((i) => (
              <div key={i.code} className="border-b border-br py-2 first:pt-0 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-[13px] font-semibold">{i.name}</div>
                  <button
                    onClick={() => dispatch({ type: 'remove', code: i.code })}
                    title="Quitar"
                    aria-label="Quitar"
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-red/10 hover:text-red"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="text-[10px] text-muted">
                    Cant. ({i.unit})
                    <input
                      className="input mt-0.5 px-2 py-1.5 text-right font-mono text-[13px]"
                      type="number"
                      min={0}
                      step="any"
                      value={i.qty || ''}
                      onChange={(e) => dispatch({ type: 'setQty', code: i.code, qty: parseFloat(e.target.value) || 0 })}
                    />
                  </label>
                  <label className="text-[10px] text-muted">
                    Precio
                    <input
                      className="input mt-0.5 px-2 py-1.5 text-right font-mono text-[13px]"
                      type="number"
                      min={0}
                      step="any"
                      value={i.price || ''}
                      onChange={(e) => dispatch({ type: 'setPrice', code: i.code, price: parseFloat(e.target.value) || 0 })}
                    />
                  </label>
                  <div className="pb-1.5 text-right font-mono text-[12px] font-semibold">{formatMoney(i.price * i.qty)}</div>
                </div>
              </div>
            ))
          )}

          <label className="mb-1 mt-2.5 block field-label">Notas</label>
          <textarea rows={2} className="input resize-none" value={draft.notes} onChange={(e) => dispatch({ type: 'setNotes', notes: e.target.value })} placeholder="Opcional" />
        </div>

        <div className="flex-shrink-0 border-t border-br p-3">
          <div className="mb-2 flex items-center justify-between rounded-lg bg-s2 px-3 py-2">
            <span className="text-[12px] text-txt2">
              Total ({draft.items.length} prod., {formatQty(totalQty)} uds)
            </span>
            <span className="font-mono text-[17px] font-bold text-lime">{formatMoney(total)}</span>
          </div>
          <button disabled={busy} onClick={save} className="w-full rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
            {editing ? 'Guardar cambios' : 'Tomar pedido'}
          </button>
        </div>
      </section>

      <ClientPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(id, name) => dispatch({ type: 'setCustomer', customerId: id, customerName: name })}
        onClear={() => dispatch({ type: 'setCustomer', customerId: null, customerName: '' })}
      />
    </div>
  )
}
