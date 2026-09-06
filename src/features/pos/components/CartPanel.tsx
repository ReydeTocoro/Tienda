import { useMemo, useState } from 'react'
import type { Product } from '../../../types/product'
import { useCartStore } from '../../../store/useCartStore'
import { useCartTotals } from '../hooks/useFinalizeSale'
import { useSelectedCustomerLoyalty } from '../hooks/useSelectedCustomerLoyalty'
import { formatMoney } from '../../../shared/lib/currency'
import { unitShortLabel, isMeasuredUnit } from '../../../shared/lib/units'
import { BottomSheet } from '../../../shared/components/BottomSheet'

interface CartPanelProps {
  products: Product[]
  onEditMeasured: (index: number) => void
  onOpenDiscount: () => void
  onCheckout: () => void
}

const PAY_METHODS: Array<{ key: 'efectivo' | 'transferencia' | 'fiado'; label: string; icon: string }> = [
  { key: 'efectivo', label: 'Efectivo', icon: '💵' },
  { key: 'transferencia', label: 'Transfer.', icon: '📲' },
  { key: 'fiado', label: 'Fiado', icon: '📋' },
]

const QUICK_BILLS = [5000, 10000, 20000, 50000, 100000]

export function CartPanel({ products, onEditMeasured, onOpenDiscount, onCheckout }: CartPanelProps) {
  const items = useCartStore((s) => s.items)
  const changeQty = useCartStore((s) => s.changeQty)
  const removeItem = useCartStore((s) => s.removeItem)
  const clear = useCartStore((s) => s.clear)
  const payMethod = useCartStore((s) => s.payMethod)
  const setPayMethod = useCartStore((s) => s.setPayMethod)
  const fiadoName = useCartStore((s) => s.fiadoName)
  const setFiadoName = useCartStore((s) => s.setFiadoName)
  const notes = useCartStore((s) => s.notes)
  const setNotes = useCartStore((s) => s.setNotes)
  const manualDiscountPct = useCartStore((s) => s.manualDiscountPct)
  const customerId = useCartStore((s) => s.customerId)
  const chargeOverride = useCartStore((s) => s.chargeOverride)
  const setChargeOverride = useCartStore((s) => s.setChargeOverride)
  const amountReceived = useCartStore((s) => s.amountReceived)
  const setAmountReceived = useCartStore((s) => s.setAmountReceived)

  const [notesOpen, setNotesOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const { pts: loyaltyPts } = useSelectedCustomerLoyalty()
  const { subtotal, discount, discountLabel, total, chargeAmount, roundingAdjustment } = useCartTotals(loyaltyPts)

  const stockByCode = useMemo(() => new Map(products.map((p) => [p.code, p.stock])), [products])
  const totalItems = items.reduce((a, i) => a + i.qty, 0)

  const discLabel = discountLabel === 'manual' ? `Desc. manual (${manualDiscountPct}%)` : discountLabel === 'loyalty' ? `Desc. cliente (${loyaltyPts} pts)` : ''

  const change = amountReceived - chargeAmount
  const insufficientCash = payMethod === 'efectivo' && amountReceived > 0 && change < 0

  function confirmCheckout() {
    if (insufficientCash) return
    setCheckoutOpen(false)
    onCheckout()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-br bg-s1 px-3 py-2 md:px-4 md:py-2.5">
        <span className="text-[13px] font-bold md:text-[14px]">Carrito</span>
        <span className="font-mono text-[11px] text-lime">{totalItems > 0 ? `${totalItems} ítem${totalItems !== 1 ? 's' : ''}` : ''}</span>
      </div>

      {/* Product list always gets the full remaining space — payment details live in a
       * dedicated sheet instead (opened from the Cobrar button below), so this never gets
       * squeezed by the payment-method grid + quick actions like it used to. */}
      <div className="flex-1 overflow-y-auto">
        {!items.length ? (
          <div className="p-8 text-center text-muted">
            <div className="mb-2 text-3xl">🛒</div>
            <p className="text-[13px]">Carrito vacío</p>
          </div>
        ) : (
          items.map((item, i) => {
            const measured = isMeasuredUnit(item.unit)
            const ul = measured ? unitShortLabel(item.unit) : null
            return (
              <div key={i} className="border-b border-br px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">
                      {item.name}
                      {item.isFree && (
                        <span className="ml-1 rounded border border-orange/30 bg-orange/10 px-1 py-px text-[9px] font-bold text-orange">LIBRE</span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted">
                      {item.isFree ? '🏷️ Sin código' : item.code}
                      {item.brand ? ' · ' + item.brand : ''}
                    </div>
                  </div>
                  <button onClick={() => removeItem(i)} className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[13px] text-muted transition-colors hover:bg-red/10 hover:text-red">
                    ✕
                  </button>
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2">
                  {measured ? (
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap font-mono text-[12px] text-lime">
                        {item.qty} {ul}
                      </span>
                      <button onClick={() => onEditMeasured(i)} className="rounded border border-br2 bg-s3 px-1.5 py-0.5 text-[10px] text-txt2">
                        ✏ editar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => changeQty(i, -1)}
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-br2 bg-s3 text-[14px] transition-colors hover:border-lime/40 hover:text-lime"
                      >
                        −
                      </button>
                      <span className="w-[22px] text-center font-mono text-[13px]">{item.qty}</span>
                      <button
                        disabled={item.isFree}
                        onClick={() => changeQty(i, 1, stockByCode.get(item.code))}
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-br2 bg-s3 text-[14px] transition-colors hover:border-lime/40 hover:text-lime disabled:opacity-30 disabled:hover:border-br2 disabled:hover:text-txt"
                      >
                        +
                      </button>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="font-mono text-[10px] text-muted">
                      {formatMoney(item.price)}
                      {measured ? `/${ul}` : ''}
                    </div>
                    <div className="font-mono text-[13px] font-medium text-lime">{formatMoney(item.price * item.qty)}</div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {items.length > 0 && (
        <div className="flex-shrink-0 border-t border-br bg-s1 px-3.5 py-3">
          <button
            onClick={() => setCheckoutOpen(true)}
            className="flex w-full items-center justify-between rounded-[10px] bg-green px-4 py-3 text-black transition-transform hover:brightness-110 active:scale-[0.98]"
          >
            <span className="text-[14px] font-bold">✓ Cobrar</span>
            <span className="font-mono text-[17px] font-bold">{formatMoney(chargeAmount)}</span>
          </button>
        </div>
      )}

      {/* Payment method, discount/notes shortcuts, and the final confirm all live here — pulled
       * out of the cart column so the product list above never has to compete for space. */}
      <BottomSheet open={checkoutOpen} onClose={() => setCheckoutOpen(false)} maxWidthClass="max-w-[440px]">
        <div className="mb-3.5 flex items-center justify-between">
          <span className="font-display text-[19px] font-bold">Cobrar</span>
          <span className="font-mono text-[13px] text-txt2">{totalItems} ítem{totalItems !== 1 ? 's' : ''}</span>
        </div>

        <div className="mb-3.5 rounded-[14px] border border-br bg-s2 px-4 py-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[13px] text-txt2">
            <span>Subtotal</span>
            <span className="font-mono">{formatMoney(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="mb-1.5 flex items-center justify-between text-[13px] text-txt2">
              <span>{discLabel}</span>
              <span className="font-mono text-green">-{formatMoney(discount)}</span>
            </div>
          )}
          <div className="mt-2 border-t border-br pt-3">
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="charge-input" className="text-[13px] font-bold">
                Total a cobrar
              </label>
              {roundingAdjustment !== 0 && <span className="text-[11px] text-orange">ajustado de {formatMoney(total)}</span>}
            </div>
            <input
              id="charge-input"
              type="number"
              inputMode="decimal"
              step="any"
              className="input w-full text-right font-mono text-[22px] font-bold text-lime"
              value={chargeOverride ?? total}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setChargeOverride(e.target.value === '' ? total : Number(e.target.value))}
            />
          </div>
        </div>

        {payMethod === 'efectivo' && (
          <div className="mb-3.5">
            <p className="mb-2 field-label">Efectivo recibido</p>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="0"
              className="input mb-2 w-full text-right font-mono text-[22px] font-bold"
              value={amountReceived || ''}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setAmountReceived(e.target.value === '' ? 0 : Number(e.target.value))}
            />
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {QUICK_BILLS.map((bill) => (
                <button
                  key={bill}
                  onClick={() => setAmountReceived(bill)}
                  className="rounded-lg border border-br2 bg-s2 py-1.5 text-[12px] font-mono text-txt2 transition-colors hover:border-lime/40 hover:text-lime"
                >
                  {formatMoney(bill)}
                </button>
              ))}
              <button
                onClick={() => setAmountReceived(chargeAmount)}
                className="rounded-lg border border-lime/40 bg-lime/10 py-1.5 text-[12px] font-semibold text-lime"
              >
                Exacto
              </button>
            </div>
            {amountReceived > 0 &&
              (change >= 0 ? (
                <div className="flex items-center justify-between rounded-[10px] bg-green/10 px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold text-green">Cambio a devolver</span>
                  <span className="font-mono text-[18px] font-bold text-green">{formatMoney(change)}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-[10px] bg-red/10 px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold text-red">Falta</span>
                  <span className="font-mono text-[18px] font-bold text-red">{formatMoney(-change)}</span>
                </div>
              ))}
          </div>
        )}

        <p className="mb-2 field-label">Método de pago</p>
        <div className="mb-3.5 grid grid-cols-3 gap-2">
          {PAY_METHODS.map((m) => (
            <button
              key={m.key}
              onClick={() => setPayMethod(m.key)}
              className={`rounded-xl border-2 py-2.5 text-center transition-colors ${
                payMethod === m.key ? 'border-lime bg-lime/15 text-lime' : 'border-br2 bg-s2 text-txt2 hover:border-br2 hover:bg-s3 hover:text-txt'
              }`}
            >
              <div className="mb-1 text-[20px]">{m.icon}</div>
              <div className="text-[11px] font-semibold">{m.label}</div>
            </button>
          ))}
        </div>
        {payMethod === 'fiado' && !customerId && (
          <div className="mb-3.5">
            <label className="mb-1 block field-label">Nombre (fiado)</label>
            <input className="input" value={fiadoName} onChange={(e) => setFiadoName(e.target.value)} placeholder="¿A quién le fías?" />
          </div>
        )}

        {notesOpen && (
          <div className="mb-3.5">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="📝 Nota para esta venta (opcional)..."
              rows={2}
              className="input resize-none text-[12px]"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={clear} title="Vaciar carrito" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-red/40 hover:text-red">
            🗑
          </button>
          <button onClick={() => setNotesOpen((o) => !o)} title="Agregar nota" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
            📝
          </button>
          <button onClick={onOpenDiscount} title="Descuento manual" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
            %
          </button>
          <button
            onClick={confirmCheckout}
            disabled={insufficientCash}
            className={`flex-1 rounded-[10px] py-2.5 text-[14px] font-bold transition-transform active:scale-[0.98] ${
              insufficientCash ? 'cursor-not-allowed bg-br2 text-muted' : 'bg-green text-black hover:brightness-110'
            }`}
          >
            {insufficientCash ? `Falta ${formatMoney(-change)}` : '✓ Confirmar cobro'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
