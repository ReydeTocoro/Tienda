import { useMemo, useReducer, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Search, Trash2 } from 'lucide-react'
import { db } from '../../../db/index'
import { createOrder, updateOrder } from '../../../db/repositories/purchaseOrders'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import type { Product } from '../../../types/product'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import type { Supplier } from '../../../types/supplier'
import { draftFromOrder, draftReducer, draftTotal, EMPTY_DRAFT, lineFromProduct } from '../lib/orderDraft'
import { termsLabel } from '../lib/terms'

const MAX_ROWS = 200

interface NewOrderViewProps {
  /** A draft being continued; null = a brand-new order. */
  editing: PurchaseOrder | null
  onDone: () => void
}

/** "Solicitud": pick what to ask a supplier for. The left side lists what is out of stock or
 * under its minimum (or any product, via search); the right side is the order being built. */
export function NewOrderView({ editing, onDone }: NewOrderViewProps) {
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], [] as Supplier[])
  const [draft, dispatch] = useReducer(draftReducer, editing, (o) => (o ? draftFromOrder(o) : EMPTY_DRAFT))
  const [mode, setMode] = useState<'bajo' | 'todos'>('bajo')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, 'es')), [suppliers])
  const supplier = suppliers.find((s) => s.id === draft.supplierId)
  const selected = useMemo(() => new Set(draft.lines.map((l) => l.code)), [draft.lines])

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = products.filter((p) => !p.esUnidadSuelta && (mode === 'todos' || p.stock <= p.min))
    const filtered = q ? base.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)) : base
    return filtered.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'es'))
  }, [products, mode, search])
  const lowCount = useMemo(() => products.filter((p) => !p.esUnidadSuelta && p.stock <= p.min).length, [products])
  const total = draftTotal(draft.lines)

  async function save(send: boolean) {
    if (!draft.supplierId) {
      toast('Elige el proveedor', 'orange')
      return
    }
    if (!draft.lines.length) {
      toast('Agrega al menos un producto', 'orange')
      return
    }
    if (draft.lines.some((l) => !(l.qty > 0))) {
      toast('Todas las cantidades deben ser mayores a 0', 'orange')
      return
    }
    setBusy(true)
    try {
      const input = { supplierId: draft.supplierId, lines: draft.lines.map(({ code, qty, unitCost }) => ({ code, qty, unitCost })), notes: draft.notes, send }
      const saved = editing?.id ? await updateOrder(editing.id, input) : await createOrder(input)
      toast(send ? `Pedido enviado a ${saved.supplierName}` : 'Borrador guardado', 'green')
      dispatch({ type: 'clear' })
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const seg = (is: boolean) => `rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${is ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s2'}`

  return (
    <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,420px)] md:items-start md:gap-5">
      <section className="mb-5 md:mb-0">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <button onClick={() => setMode('bajo')} className={seg(mode === 'bajo')}>
            Stock bajo y agotados ({lowCount})
          </button>
          <button onClick={() => setMode('todos')} className={seg(mode === 'todos')}>
            Todos los productos
          </button>
        </div>
        <div className="relative mb-2.5">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input py-2 pl-9" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {!candidates.length ? (
          <div className="rounded-xl border border-dashed border-br2 p-8 text-center text-[13px] text-muted">
            {mode === 'bajo' && !search ? 'Nada por pedir: ningún producto está bajo su mínimo.' : 'Sin resultados.'}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-br bg-s1">
            {candidates.slice(0, MAX_ROWS).map((p) => {
              const isSel = selected.has(p.code)
              return (
                <button
                  key={p.code}
                  onClick={() => dispatch({ type: 'toggle', line: lineFromProduct(p) })}
                  className={`flex w-full items-center gap-3 border-b border-br px-3 py-2 text-left last:border-b-0 hover:bg-s2 ${isSel ? 'bg-lime/10' : ''}`}
                >
                  <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${isSel ? 'border-lime bg-lime text-bg' : 'border-br2'}`}>{isSel && <Check size={13} strokeWidth={3} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted">
                      {p.code}
                      {p.cat ? ` · ${p.cat}` : ''}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className={`block font-mono text-[13px] font-bold ${p.stock <= 0 ? 'text-red' : 'text-orange'}`}>{formatQty(p.stock)}</span>
                    <span className="block text-[10px] text-muted">mín {formatQty(p.min)}</span>
                  </span>
                </button>
              )
            })}
            {candidates.length > MAX_ROWS && <div className="p-2.5 text-center text-[12px] text-muted">Mostrando {MAX_ROWS} de {candidates.length}: usa el buscador para afinar.</div>}
          </div>
        )}
      </section>

      <section className="rounded-[14px] border border-br bg-s1 p-3.5 md:sticky md:top-4">
        <div className="mb-3 text-[15px] font-bold">{editing ? 'Editando borrador' : 'Pedido nuevo'}</div>

        <label className="mb-1 block field-label">Proveedor *</label>
        <select className="input mb-1" value={draft.supplierId ?? ''} onChange={(e) => dispatch({ type: 'setSupplier', supplierId: e.target.value || null })}>
          <option value="">Elige un proveedor...</option>
          {activeSuppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {supplier ? <div className="mb-3 text-[12px] text-txt2">{termsLabel(supplier.paymentTerms)}</div> : !activeSuppliers.length ? <div className="mb-3 text-[12px] text-orange">Primero crea un proveedor en la pestaña Proveedores.</div> : <div className="mb-3" />}

        {!draft.lines.length ? (
          <div className="mb-3 rounded-lg bg-s2 px-3 py-6 text-center text-[12px] text-muted">Toca productos de la lista para agregarlos.</div>
        ) : (
          <div className="mb-3 max-h-[40vh] overflow-y-auto">
            {draft.lines.map((l) => (
              <div key={l.code} className="border-b border-br py-2 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-[13px] font-semibold">{l.name}</div>
                  <button onClick={() => dispatch({ type: 'remove', code: l.code })} title="Quitar" aria-label="Quitar" className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-red/10 hover:text-red">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="text-[10px] text-muted">
                    Cantidad
                    <input className="input mt-0.5 px-2 py-1.5 text-right font-mono text-[13px]" type="number" min={0} step="any" value={l.qty || ''} onChange={(e) => dispatch({ type: 'setQty', code: l.code, qty: parseFloat(e.target.value) || 0 })} />
                  </label>
                  <label className="text-[10px] text-muted">
                    Costo unitario
                    <input className="input mt-0.5 px-2 py-1.5 text-right font-mono text-[13px]" type="number" min={0} step="any" value={l.unitCost || ''} onChange={(e) => dispatch({ type: 'setCost', code: l.code, unitCost: parseFloat(e.target.value) || 0 })} />
                  </label>
                  <div className="pb-1.5 text-right font-mono text-[12px] font-semibold">{formatMoney(l.qty * l.unitCost)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="mb-1 block field-label">Notas</label>
        <textarea rows={2} className="input mb-3 resize-none" value={draft.notes} onChange={(e) => dispatch({ type: 'setNotes', notes: e.target.value })} placeholder="Opcional" />

        <div className="mb-3 flex items-center justify-between rounded-lg bg-s2 px-3 py-2.5">
          <span className="text-[13px] text-txt2">
            Total ({draft.lines.length} producto{draft.lines.length !== 1 ? 's' : ''})
          </span>
          <span className="font-mono text-[18px] font-bold text-lime">{formatMoney(total)}</span>
        </div>

        <div className="flex gap-2">
          <button disabled={busy} onClick={() => save(false)} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] font-semibold text-txt2 hover:bg-s2 disabled:opacity-60">
            Guardar borrador
          </button>
          <button disabled={busy} onClick={() => save(true)} className="flex-[1.4] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-bg disabled:opacity-60">
            Enviar pedido
          </button>
        </div>
      </section>
    </div>
  )
}
