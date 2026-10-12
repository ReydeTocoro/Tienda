import { useMemo, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import type { Sale } from '../../../types/sale'
import type { CartItem } from '../../../types/cartItem'
import type { Product } from '../../../types/product'
import { db } from '../../../db/index'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { Highlight } from '../../../shared/components/Highlight'
import { correctSale, getFiadoDebt } from '../../../db/repositories/sales'
import { toast } from '../../../store/useToastStore'
import { CAJA_LABEL } from '../../../shared/lib/cash'
import { formatSaleId } from '../../../shared/lib/id'
import { formatDateTime, formatMoney, formatQty } from '../../../shared/lib/currency'
import { isTracked, stockEffect } from '../../../shared/lib/saleStock'
import { ALL, DEFAULT_SALE_SORT, filterSaleProducts, sortSaleProducts } from '../../pos/lib/saleProducts'
import { StockEffectList } from './StockEffectList'

interface CorrectionModalProps {
  sale: Sale | null
  onClose: () => void
  onCorrected: () => void
}

const SUGGESTIONS = 8

/** Units of one product that are on a list of lines. */
const unitsOf = (items: CartItem[], code: string) => items.filter((i) => isTracked(i) && i.code === code).reduce((a, i) => a + i.qty, 0)

/** legacy `abrirCorreccionVenta()`/`confirmarCorreccion()` (index.html L6924-7073). */
export function CorrectionModal({ sale, onClose, onCorrected }: CorrectionModalProps) {
  if (!sale) return null
  return (
    <BottomSheet open onClose={onClose} maxWidthClass="max-w-[640px]">
      <CorrectionForm sale={sale} onClose={onClose} onCorrected={onCorrected} />
    </BottomSheet>
  )
}

/** Fixing an invoice: change a quantity or a price, take a line out, add products from the inventory (the search
 * suggests them as you type). Before saving it says what each change does to the inventory and to the caja; the
 * server does exactly that, in one transaction. */
function CorrectionForm({ sale, onClose, onCorrected }: { sale: Sale; onClose: () => void; onCorrected: () => void }) {
  const [items, setItems] = useState<CartItem[]>(() => sale.items.map((i) => ({ ...i })))
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [hi, setHi] = useState(0)
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[])
  const byCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products])

  const query = search.trim()
  const suggestions = useMemo(() => (query ? sortSaleProducts(filterSaleProducts(products, { search: query, cat: ALL }), DEFAULT_SALE_SORT).slice(0, SUGGESTIONS) : []), [products, query])
  /** What can still be put on this invoice of a product: what is on the shelf plus what the invoice already took, minus what its lines hold now. */
  const available = (code: string) => (byCode.get(code)?.stock ?? 0) + unitsOf(sale.items, code) - unitsOf(items, code)
  /** Short of stock for what the lines ask (a hair of float noise is not "short"). */
  const lacking = (code: string) => available(code) < -0.00005

  function updateItem(i: number, field: 'qty' | 'price', value: string) {
    const num = value === '' ? 0 : parseFloat(value)
    if (isNaN(num) || num < 0) return
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, [field]: num } : it)))
  }

  function removeItem(i: number) {
    setItems((s) => s.filter((_, idx) => idx !== i))
  }

  function addProduct(p: Product) {
    setItems((s) => {
      const at = s.findIndex((i) => isTracked(i) && i.code === p.code)
      if (at >= 0) return s.map((it, idx) => (idx === at ? { ...it, qty: it.qty + 1 } : it))
      return [...s, { code: p.code, name: p.name, price: p.price, qty: 1, brand: p.brand || '', unit: p.unit || 'unidad', isFree: false }]
    })
    setSearch('')
    setHi(0)
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(0, Math.min(suggestions.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter' && query) {
      // Enter here picks the suggestion — it must never press "Guardar corrección" (the dialog's Enter).
      e.preventDefault()
      const p = suggestions[Math.min(hi, suggestions.length - 1)]
      if (p && available(p.code) > 0) addProduct(p)
    }
  }

  const newSub = items.reduce((a, i) => a + i.price * i.qty, 0)
  const newTotal = Math.max(0, newSub - (sale.discount || 0) + (sale.roundingAdjustment ?? 0))
  const diff = newTotal - sale.total
  const effect = useMemo(() => stockEffect(sale.items, items), [sale.items, items])
  const paid = (sale.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
  const changed = items.length !== sale.items.length || items.some((it, i) => it.code !== sale.items[i].code || it.qty !== sale.items[i].qty || it.price !== sale.items[i].price)

  // What stops the correction, said where the person can read it (the server checks all of it again).
  const blockers: string[] = []
  if (!items.length) blockers.push('La factura no puede quedar sin productos: para cancelarla usa "Anular factura".')
  if (items.some((i) => !(i.qty > 0))) blockers.push('Hay una cantidad en 0: ponla o quita el producto con la X.')
  const short = effect.filter((e) => e.delta < 0 && byCode.has(e.code) && lacking(e.code))
  for (const e of short) blockers.push(`No alcanza el stock de "${e.name}": solo hay ${formatQty(available(e.code) + unitsOf(items, e.code))} para esta factura.`)
  if (sale.payMethod === 'fiado' && newTotal + 0.01 < paid) blockers.push(`Esta factura fiada ya tiene abonos por ${formatMoney(paid)}: el total no puede quedar por debajo (si hace falta, anúlala).`)

  async function confirm() {
    if (blockers.length) return
    if (!reason.trim()) {
      toast('Escribe el motivo de la corrección', 'orange')
      return
    }
    if (!changed) {
      toast('No cambiaste nada en la factura', 'orange')
      return
    }
    await correctSale(sale.id!, items, reason.trim())
    toast(`Factura ${formatSaleId(sale.id)} corregida`, 'orange')
    onCorrected()
  }

  const caja = sale.payMethod === 'transferencia' ? CAJA_LABEL.mayor : CAJA_LABEL.menor

  return (
    <>
      <div className="mb-1">
        <div className="font-display text-[18px] font-bold">Corregir Factura</div>
        <div className="text-[11px] text-muted">
          {formatSaleId(sale.id)} · {formatDateTime(sale.date)}
        </div>
      </div>
      <div className="my-3.5 rounded-[10px] border border-orange/25 bg-orange/10 px-3 py-2.5 text-[12px] text-orange">
        Los cambios quedan en el historial de auditoría. El reporte se recalcula automáticamente y el inventario y la caja se ajustan solos.
      </div>

      <div className="mb-2 field-label">Productos en la factura</div>
      <div className="max-h-[34vh] overflow-y-auto">
        {items.map((it, i) => {
          const tracked = isTracked(it)
          const gone = tracked && !byCode.has(it.code)
          const over = tracked && !gone && lacking(it.code)
          return (
            <div key={i} className="mb-1.5 border-b border-br pb-1.5">
              <div className="grid grid-cols-[1fr_80px_80px_28px] items-center gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{it.name}</div>
                  <div className="font-mono text-[10px] text-muted">{it.code || '—'}</div>
                </div>
                <input
                  type="number"
                  min={0}
                  value={it.qty}
                  onChange={(e) => updateItem(i, 'qty', e.target.value)}
                  aria-label={`Cantidad de ${it.name}`}
                  className={`input py-1.5 text-right font-mono text-[13px] ${over || !(it.qty > 0) ? 'border-red' : ''}`}
                />
                <input type="number" min={0} step="0.01" value={it.price} onChange={(e) => updateItem(i, 'price', e.target.value)} aria-label={`Precio de ${it.name}`} className="input py-1.5 text-right font-mono text-[13px]" />
                <button onClick={() => removeItem(i)} title="Quitar de la factura" aria-label={`Quitar ${it.name}`} className="flex justify-center text-red">
                  <X size={15} />
                </button>
              </div>
              {over && <div className="mt-0.5 text-[11px] text-red">Solo hay {formatQty(available(it.code) + unitsOf(items, it.code))} disponibles para esta factura.</div>}
              {gone && <div className="mt-0.5 text-[11px] text-muted">Este producto ya no está en el inventario: su cantidad no mueve stock.</div>}
              {!tracked && <div className="mt-0.5 text-[11px] text-muted">Línea libre de una venta antigua: no mueve stock.</div>}
            </div>
          )
        })}
      </div>

      <div className="mb-1 mt-3 field-label">Agregar producto del inventario</div>
      <input
        className="input"
        placeholder="Escribe el nombre, el código o la marca..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setHi(0)
        }}
        onKeyDown={onSearchKey}
        role="combobox"
        aria-expanded={!!query}
        aria-controls="correccion-sugerencias"
        autoComplete="off"
      />
      {query && (
        <div id="correccion-sugerencias" role="listbox" className="mt-1 max-h-[232px] overflow-y-auto rounded-[10px] border border-br2 bg-s1">
          {!suggestions.length ? (
            <div className="px-3 py-2.5 text-[12px] text-muted">No hay productos con "{query}" en el inventario.</div>
          ) : (
            suggestions.map((p, idx) => {
              const left = available(p.code)
              return (
                <button
                  key={p.code}
                  role="option"
                  aria-selected={idx === hi}
                  disabled={left <= 0}
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => addProduct(p)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-br px-3 py-2 text-left last:border-b-0 disabled:opacity-50 ${idx === hi ? 'bg-s2' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">
                      <Highlight text={p.name} query={query} />
                    </span>
                    <span className="block font-mono text-[10px] text-muted">
                      <Highlight text={p.code} query={query} />
                      {p.brand ? ' · ' : ''}
                      {p.brand ? <Highlight text={p.brand} query={query} /> : null}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className="block font-mono text-[12px] font-semibold">{formatMoney(p.price)}</span>
                    <span className={`block text-[10px] ${left <= 0 ? 'font-semibold text-red' : 'text-muted'}`}>{left <= 0 ? 'Agotado' : `Stock ${formatQty(left)}`}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}

      <div className="mb-1.5 mt-3.5 field-label">Qué pasará al guardar</div>
      <div className="mb-3.5 rounded-[10px] border border-br bg-s2 p-2.5 text-[12px]">
        <StockEffectList effect={effect} />
        <div className="mt-2 space-y-0.5 border-t border-br pt-2 text-txt2">
          <div>
            Total de la factura: <b className="font-mono">{formatMoney(sale.total)}</b> → <b className="font-mono">{formatMoney(newTotal)}</b>
          </div>
          {sale.payMethod === 'fiado' ? (
            <div>
              Deuda del cliente: <b className="font-mono">{formatMoney(getFiadoDebt(sale))}</b> → <b className="font-mono">{formatMoney(Math.max(0, newTotal - paid))}</b>
            </div>
          ) : (
            <div>{Math.abs(diff) < 0.005 ? 'La caja no cambia.' : `La ${caja} ${diff > 0 ? 'recibe' : 'devuelve'} ${formatMoney(Math.abs(diff))}.`}</div>
          )}
          {sale.closedInCierreId !== undefined && <div className="text-orange">Es de un día que ya tuvo Cierre Z: ese cierre guardado no cambia, y el ajuste de dinero se registra hoy.</div>}
        </div>
      </div>

      <div className="mb-1.5 field-label">Motivo de la corrección *</div>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ej: Se facturó precio equivocado, cliente devolvió un ítem..."
        className="input resize-none border-lime"
      />

      {blockers.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-[10px] border border-red/25 bg-red/10 px-3 py-2 text-[12px] text-red">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button data-enter disabled={blockers.length > 0} onClick={confirm} className="flex-[2] rounded-[10px] bg-orange py-2.5 text-[14px] font-extrabold text-on-solid disabled:opacity-50">
          Guardar corrección
        </button>
      </div>
    </>
  )
}
