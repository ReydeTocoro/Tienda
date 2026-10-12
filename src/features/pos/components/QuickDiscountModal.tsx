import { useState } from 'react'
import { X } from 'lucide-react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { useActiveCart, useCartStore } from '../../../store/useCartStore'
import { toast } from '../../../store/useToastStore'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { lineDiscount } from '../../../shared/lib/discounts'

interface QuickDiscountModalProps {
  open: boolean
  onClose: () => void
}

/** A discount in money on one product of the cart: pick the product, type how much comes off. */
export function QuickDiscountModal({ open, onClose }: QuickDiscountModalProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[460px]">
      <DiscountForm onClose={onClose} />
    </BottomSheet>
  )
}

function DiscountForm({ onClose }: { onClose: () => void }) {
  const items = useActiveCart((c) => c.items)
  const setItemDiscount = useCartStore((s) => s.setItemDiscount)
  // With a single product there is nothing to choose.
  const [sel, setSel] = useState<number | null>(items.length === 1 ? 0 : null)
  const [amount, setAmount] = useState<number>(items.length === 1 ? lineDiscount(items[0]) : 0)

  const item = sel !== null ? items[sel] : undefined
  const gross = item ? item.price * item.qty : 0
  const valid = !!item && amount > 0 && amount <= gross + 0.005
  const anyDiscount = items.some((i) => lineDiscount(i) > 0)

  function pick(i: number) {
    setSel(i)
    setAmount(lineDiscount(items[i]))
    // The amount is what comes next: leave the cursor on it.
    requestAnimationFrame(() => document.getElementById('discount-amount')?.focus())
  }

  function apply() {
    if (sel === null || !item || !valid) return
    setItemDiscount(sel, Math.min(amount, gross))
    toast(`Descuento de ${formatMoney(Math.min(amount, gross))} en ${item.name}`, 'purple')
    onClose()
  }

  function remove(index: number | null) {
    const targets = index === null ? items.map((_, i) => i) : [index]
    for (const i of targets) setItemDiscount(i, 0)
    toast(index === null ? 'Descuentos eliminados' : 'Descuento eliminado', 'default')
    onClose()
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <div className="font-display text-[18px] font-bold">Descuento en dinero</div>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>
      <div className="mb-3 text-[12px] text-muted">Elige el producto y escribe cuánto se le descuenta.</div>

      <div role="radiogroup" aria-label="Producto al que se le descuenta" className="mb-3.5 max-h-[34vh] overflow-y-auto rounded-[10px] border border-br">
        {items.map((it, i) => {
          const d = lineDiscount(it)
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={sel === i}
              onClick={() => pick(i)}
              className={`flex w-full items-center justify-between gap-3 border-b border-br px-3 py-2 text-left last:border-b-0 ${sel === i ? 'bg-lime/15 shadow-[inset_3px_0_0_var(--color-lime)]' : 'hover:bg-s2'}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{it.name}</span>
                <span className="block font-mono text-[10px] text-muted">
                  {formatQty(it.qty)} × {formatMoney(it.price)}
                </span>
              </span>
              <span className="flex-shrink-0 text-right">
                <span className="block font-mono text-[13px] font-semibold">{formatMoney(it.price * it.qty)}</span>
                {d > 0 && <span className="block font-mono text-[10px] font-semibold text-green">−{formatMoney(d)}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <label htmlFor="discount-amount" className="mb-1 block field-label">
        Valor del descuento
      </label>
      <MoneyInput id="discount-amount" className={`input text-right font-mono text-[20px] font-bold ${item ? 'border-lime' : ''}`} value={amount} onChange={(v) => setAmount(v ?? 0)} placeholder="0" autoFocus={items.length === 1} />
      <div className="mb-3.5 mt-1.5 min-h-[18px] text-[12px]">
        {!item ? (
          <span className="text-muted">Primero elige el producto.</span>
        ) : amount > gross + 0.005 ? (
          <span className="font-semibold text-red">No puede pasar de {formatMoney(gross)}, lo que vale esa línea.</span>
        ) : (
          <span className="text-txt2">
            Esa línea queda en <b className="font-mono">{formatMoney(gross - (amount > 0 ? amount : 0))}</b> (vale {formatMoney(gross)}).
          </span>
        )}
      </div>

      <button data-enter disabled={!valid} onClick={apply} className="w-full rounded-[10px] bg-lime py-2.5 text-[15px] font-extrabold text-on-solid disabled:opacity-50">
        Aplicar descuento
      </button>
      <div className="mt-2 flex justify-center gap-4">
        {item && lineDiscount(item) > 0 && (
          <button onClick={() => remove(sel)} className="py-1.5 text-[13px] text-muted hover:text-red">
            Quitar el de este producto
          </button>
        )}
        {anyDiscount && (
          <button onClick={() => remove(null)} className="py-1.5 text-[13px] text-muted hover:text-red">
            Quitar todos
          </button>
        )}
      </div>
    </>
  )
}
