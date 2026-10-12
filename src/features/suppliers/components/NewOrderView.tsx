import { useMemo, useReducer, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { db } from '../../../db/index'
import { useSecureTable } from '../../../db/secure'
import { useCostMap, withCosts } from '../../../shared/hooks/useSecretFigures'
import { createOrder, updateOrder } from '../../../db/repositories/purchaseOrders'
import { SearchInput } from '../../../shared/components/SearchInput'
import { formatMoney } from '../../../shared/lib/currency'
import { nextSort, type SortState } from '../../../shared/lib/sortRows'
import { toast } from '../../../store/useToastStore'
import type { Product } from '../../../types/product'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import { DEFAULT_CANDIDATE_SORT, filterCandidates, isLowStock, isOrderable, sortCandidates, type Candidate, type CandidateMode, type CandidateSortKey } from '../lib/candidates'
import { draftFromOrder, draftReducer, draftTotal, EMPTY_DRAFT, lineFromProduct } from '../lib/orderDraft'
import { termsLabel } from '../lib/terms'
import { OrderProductTable } from './OrderProductTable'

interface NewOrderViewProps {
  /** A draft being continued; null = a brand-new order. */
  editing: PurchaseOrder | null
  /** The supplier a brand-new order starts addressed to (the "Hacer pedido" button on a supplier's row). */
  supplierId?: string | null
  onDone: () => void
}

/** The columns of an order's lines: product, quantity, cost, line total and the remove button. On a
 * narrow screen each line is two rows instead (the name, then its three figures). */
const LINE_GRID = 'md:grid-cols-[minmax(0,1fr)_68px_88px_88px_28px]'

/** "Solicitud": pick what to ask a supplier for. The left side is the table of what is out of stock
 * or under its minimum (or any product, via search); the right side is the order being built. */
export function NewOrderView({ editing, supplierId = null, onDone }: NewOrderViewProps) {
  const stored = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const costs = useCostMap()
  // With their last purchase price, the default cost of each line.
  const products: Candidate[] = useMemo(() => withCosts(stored, costs), [stored, costs])
  const suppliers = useSecureTable('suppliers')
  const [draft, dispatch] = useReducer(draftReducer, editing, (o) => (o ? draftFromOrder(o) : { ...EMPTY_DRAFT, supplierId }))
  const [mode, setMode] = useState<CandidateMode>('bajo')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<CandidateSortKey>>(DEFAULT_CANDIDATE_SORT)
  const [busy, setBusy] = useState(false)

  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, 'es')), [suppliers])
  const supplier = suppliers.find((s) => s.id === draft.supplierId)
  const selected = useMemo(() => new Set(draft.lines.map((l) => l.code)), [draft.lines])

  const candidates = useMemo(() => sortCandidates(filterCandidates(products, mode, search), sort), [products, mode, search, sort])
  const lowCount = useMemo(() => products.filter((p) => isOrderable(p) && isLowStock(p)).length, [products])
  const allCount = useMemo(() => products.filter(isOrderable).length, [products])
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

  return (
    // Side by side on a wide screen — the table and the order each scroll inside their own half. Narrower,
    // they stack and the whole tab scrolls, the table keeping a fixed height of its own.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:overflow-hidden">
      <section className="flex h-[60dvh] min-h-[320px] flex-shrink-0 flex-col gap-3 lg:h-auto lg:min-h-0">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} historyKey="pedido-productos" placeholder="Buscar producto, código o marca..." />
          <select value={mode} onChange={(e) => setMode(e.target.value as CandidateMode)} aria-label="Qué productos mostrar" className="input w-auto min-w-[230px] py-2">
            <option value="bajo">Stock bajo y agotados ({lowCount})</option>
            <option value="todos">Todos los productos ({allCount})</option>
          </select>
        </div>

        {!candidates.length ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-8 text-center text-[13px] text-muted">
            {mode === 'bajo' && !search.trim() ? 'Nada por pedir: ningún producto está bajo su mínimo.' : 'Sin resultados.'}
          </div>
        ) : (
          <OrderProductTable
            products={candidates}
            selected={selected}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            resetKey={`${search}|${mode}|${sort.key}|${sort.dir}`}
            onToggle={(p) => dispatch({ type: 'toggle', line: lineFromProduct(p) })}
          />
        )}
      </section>

      <section className="flex flex-shrink-0 flex-col rounded-[14px] border border-br bg-s1 p-3.5 shadow-xs lg:min-h-0 lg:flex-shrink lg:overflow-y-auto">
        <div className="mb-3 text-[15px] font-bold">{editing ? 'Editando borrador' : 'Pedido nuevo'}</div>

        <label htmlFor="order-supplier" className="mb-1 block field-label">
          Proveedor *
        </label>
        <select id="order-supplier" className="input mb-1" value={draft.supplierId ?? ''} onChange={(e) => dispatch({ type: 'setSupplier', supplierId: e.target.value || null })}>
          <option value="">Elige un proveedor...</option>
          {activeSuppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {supplier ? (
          <div className="mb-3 text-[12px] text-txt2">{termsLabel(supplier.paymentTerms)}</div>
        ) : !activeSuppliers.length ? (
          <div className="mb-3 text-[12px] text-orange">Primero crea un proveedor en la pestaña Proveedores.</div>
        ) : (
          <div className="mb-3" />
        )}

        <div className="mb-3 flex min-h-[104px] flex-col overflow-hidden rounded-xl border border-br lg:flex-1">
          <div className={`hidden flex-shrink-0 gap-x-1.5 border-b border-br bg-s2 px-2 py-1.5 text-[10.5px] font-semibold text-txt2 md:grid ${LINE_GRID}`}>
            <span>Producto</span>
            <span className="text-right">Cantidad</span>
            <span className="text-right">Costo unit.</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          {!draft.lines.length ? (
            <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[12px] text-muted">Toca productos de la tabla para agregarlos.</div>
          ) : (
            <div className="max-h-[40vh] flex-1 overflow-y-auto lg:max-h-none">
              {draft.lines.map((l) => (
                <div key={l.code} className={`grid grid-cols-[minmax(0,1fr)_28px] items-center gap-x-1.5 gap-y-1 border-b border-br px-2 py-1.5 last:border-b-0 ${LINE_GRID}`}>
                  <span className="truncate text-[12.5px] font-semibold" title={l.name}>
                    {l.name}
                  </span>
                  <button
                    onClick={() => dispatch({ type: 'remove', code: l.code })}
                    title="Quitar"
                    aria-label={`Quitar ${l.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-red/10 hover:text-red md:order-last"
                  >
                    <Trash2 size={13} />
                  </button>
                  <div className="col-span-2 grid grid-cols-[1fr_1fr_auto] items-center gap-1.5 md:contents">
                    <input
                      className="input px-2 py-1.5 text-right font-mono text-[12.5px]"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="Cant."
                      aria-label={`Cantidad de ${l.name}`}
                      value={l.qty || ''}
                      onChange={(e) => dispatch({ type: 'setQty', code: l.code, qty: parseFloat(e.target.value) || 0 })}
                    />
                    <input
                      className="input px-2 py-1.5 text-right font-mono text-[12.5px]"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="Costo"
                      aria-label={`Costo unitario de ${l.name}`}
                      value={l.unitCost || ''}
                      onChange={(e) => dispatch({ type: 'setCost', code: l.code, unitCost: parseFloat(e.target.value) || 0 })}
                    />
                    <span className="min-w-[78px] text-right font-mono text-[12px] font-semibold md:min-w-0">{formatMoney(l.qty * l.unitCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <label htmlFor="order-notes" className="mb-1 block field-label">
          Notas
        </label>
        <textarea id="order-notes" rows={2} className="input mb-3 resize-none" value={draft.notes} onChange={(e) => dispatch({ type: 'setNotes', notes: e.target.value })} placeholder="Opcional" />

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
          <button disabled={busy} onClick={() => save(true)} className="flex-[1.4] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
            Enviar pedido
          </button>
        </div>
      </section>
    </div>
  )
}
