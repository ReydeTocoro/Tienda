import { useMemo, useState } from 'react'
import { Banknote, Smartphone, Handshake, Trash2, FileText, ShoppingCart, X } from 'lucide-react'
import type { Product } from '../../../types/product'
import { useActiveCart, useCartStore } from '../../../store/useCartStore'
import { toast } from '../../../store/useToastStore'
import { useCartTotals } from '../hooks/useFinalizeSale'
import { useSelectedCustomerLoyalty } from '../hooks/useSelectedCustomerLoyalty'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { CartTabs } from './CartTabs'
import { ClientBar } from './ClientBar'
import { CartLine } from './CartLine'
import { BILLS } from '../../../shared/lib/bills'
import { usePermission } from '../../pin/usePermission'
import { countItems } from '../lib/cartCount'

interface CartPanelProps {
  products: Product[]
  onEditMeasured: (index: number) => void
  onOpenDiscount: () => void
  onCheckout: () => void
}

const PAY_METHODS: Array<{ key: 'efectivo' | 'transferencia' | 'fiado'; label: string; icon: typeof Banknote }> = [
  { key: 'efectivo', label: 'Efectivo', icon: Banknote },
  { key: 'transferencia', label: 'Transfer.', icon: Smartphone },
  { key: 'fiado', label: 'Fiado', icon: Handshake },
]

export function CartPanel({ products, onEditMeasured, onOpenDiscount, onCheckout }: CartPanelProps) {
  const items = useActiveCart((c) => c.items)
  const changeQty = useCartStore((s) => s.changeQty)
  const removeItem = useCartStore((s) => s.removeItem)
  const clear = useCartStore((s) => s.clear)
  const payMethod = useActiveCart((c) => c.payMethod)
  const setPayMethod = useCartStore((s) => s.setPayMethod)
  const fiadoName = useActiveCart((c) => c.fiadoName)
  const setFiadoName = useCartStore((s) => s.setFiadoName)
  const notes = useActiveCart((c) => c.notes)
  const setNotes = useCartStore((s) => s.setNotes)
  const manualDiscountPct = useActiveCart((c) => c.manualDiscountPct)
  const customerId = useActiveCart((c) => c.customerId)
  const chargeOverride = useActiveCart((c) => c.chargeOverride)
  const setChargeOverride = useCartStore((s) => s.setChargeOverride)
  const amountReceived = useActiveCart((c) => c.amountReceived)
  const cartName = useActiveCart((c) => c.name)
  const manyCarts = useCartStore((s) => s.carts.length > 1)
  const setAmountReceived = useCartStore((s) => s.setAmountReceived)

  const [notesOpen, setNotesOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  // "Cambiar el total" approved by someone allowed, for this one charge.
  const [totalUnlocked, setTotalUnlocked] = useState(false)
  const { can, requirePermission } = usePermission()
  const canEditTotal = can('ventas.cambiarTotal') || totalUnlocked
  const { pts: loyaltyPts } = useSelectedCustomerLoyalty()
  const { subtotal, discount, discountLabel, total, chargeAmount, roundingAdjustment } = useCartTotals(loyaltyPts)

  const stockByCode = useMemo(() => new Map(products.map((p) => [p.code, p.stock])), [products])
  const totalItems = countItems(items)

  const discLabel = discountLabel === 'manual' ? `Desc. manual (${manualDiscountPct}%)` : discountLabel === 'loyalty' ? `Desc. cliente (${formatQty(loyaltyPts)} pts)` : ''

  const change = amountReceived - chargeAmount
  const insufficientCash = payMethod === 'efectivo' && amountReceived > 0 && change < 0

  function startCheckout() {
    if (!items.length) {
      toast('Agrega productos al carrito para cobrar', 'orange')
      return
    }
    setTotalUnlocked(false)
    setCheckoutOpen(true)
  }

  async function unlockTotal() {
    if (await requirePermission('ventas.cambiarTotal', 'Cambiar el total', 'Ajustar el total a cobrar requiere autorización de alguien con permiso.')) setTotalUnlocked(true)
  }

  async function choosePayMethod(m: (typeof PAY_METHODS)[number]['key']) {
    if (m === 'fiado' && !(await requirePermission('ventas.fiar', 'Vender fiado', 'Fiar requiere autorización de alguien con permiso.'))) return
    setPayMethod(m)
  }

  async function openDiscount() {
    if (await requirePermission('ventas.descuentos', 'Descuento manual', 'Dar un descuento requiere autorización de alguien con permiso.')) onOpenDiscount()
  }

  function confirmCheckout() {
    if (insufficientCash) return
    setCheckoutOpen(false)
    onCheckout()
  }

  return (
    // The cart is one self-contained card — title, customer, lines and the Cobrar button all belong
    // to it, so nothing reads as page chrome — and it never changes shape: an empty cart keeps the
    // same header, customer row and Cobrar button, there is just nothing to charge yet.
    <div className="@container flex h-full flex-col overflow-hidden rounded-2xl border border-br bg-s1 shadow-sm">
      <CartTabs />

      <ClientBar />

      {/* Product list always gets the full remaining space — payment details live in a
       * dedicated sheet instead (opened from the Cobrar button below), so this never gets
       * squeezed by the payment-method grid + quick actions like it used to. */}
      <div className="flex-1 overflow-y-auto">
        {!items.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-8 text-center text-muted">
            <ShoppingCart size={28} strokeWidth={1.5} />
            <p className="text-[13px] font-semibold text-txt2">Carrito vacío</p>
            <p className="text-[11px]">Toca un producto o escanea un código</p>
          </div>
        ) : (
          items.map((item, i) => (
            <CartLine
              key={i}
              item={item}
              onChangeQty={(delta) => changeQty(i, delta, stockByCode.get(item.code))}
              onRemove={() => removeItem(i)}
              onEditMeasured={() => onEditMeasured(i)}
            />
          ))
        )}
      </div>

      <div className="flex-shrink-0 border-t border-br px-2.5 py-3 sm:px-3.5">
        <button
          onClick={startCheckout}
          aria-disabled={!items.length}
          className={`flex w-full items-center justify-between gap-2 rounded-[10px] bg-lime px-3 py-3 text-on-solid transition active:scale-[0.98] sm:px-4 ${items.length ? 'hover:brightness-110' : 'opacity-50'}`}
        >
          <span className="text-[13px] font-bold sm:text-[14px]">Cobrar</span>
          <span className="font-mono text-[14px] font-bold sm:text-[17px]">{formatMoney(chargeAmount)}</span>
        </button>
      </div>

      {/* Payment method, discount/notes shortcuts, and the final confirm all live here — pulled
       * out of the cart column so the product list above never has to compete for space. */}
      <BottomSheet open={checkoutOpen} onClose={() => setCheckoutOpen(false)} maxWidthClass="max-w-[500px]">
        <div className="mb-3.5 flex items-center gap-3">
          <span className="font-display text-[19px] font-bold">Cobrar</span>
          {manyCarts && <span className="min-w-0 truncate text-[13px] font-semibold text-txt2">· {cartName}</span>}
          <span className="ml-auto flex-shrink-0 font-mono text-[13px] text-txt2">{totalItems} ítem{totalItems !== 1 ? 's' : ''}</span>
          <button onClick={() => setCheckoutOpen(false)} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
            <X size={16} />
          </button>
        </div>

        <div className="mb-3.5 rounded-[14px] border border-br bg-s2 px-4 py-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[13px] text-txt2">
            <span>Subtotal</span>
            <span className="font-mono">{formatMoney(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="rounded-md bg-yellow px-1.5 py-0.5 text-[11px] font-semibold text-on-yellow">{discLabel}</span>
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
            {canEditTotal ? (
              <MoneyInput
                id="charge-input"
                className="input text-right font-mono text-[22px] font-bold text-lime"
                value={chargeOverride ?? total}
                onChange={setChargeOverride}
              />
            ) : (
              <div className="flex items-center gap-2">
                <output id="charge-input" className="input block flex-1 text-right font-mono text-[22px] font-bold text-lime">
                  {formatMoney(chargeAmount)}
                </output>
                <button
                  type="button"
                  onClick={unlockTotal}
                  className="flex-shrink-0 rounded-[10px] border border-br2 px-3 py-3 text-[12px] font-semibold text-txt2 transition-colors hover:bg-s2"
                >
                  Cambiar
                </button>
              </div>
            )}
          </div>
        </div>

        {payMethod === 'efectivo' && (
          <div className="mb-3.5">
            <p className="mb-2 field-label">Efectivo recibido</p>
            <MoneyInput
              placeholder="0"
              className="input mb-2 text-right font-mono text-[22px] font-bold"
              value={amountReceived}
              onChange={(v) => setAmountReceived(v ?? 0)}
            />
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {BILLS.map(({ value, img }) => (
                <button
                  key={value}
                  onClick={() => setAmountReceived(value)}
                  aria-label={formatMoney(value)}
                  title={formatMoney(value)}
                  className={`overflow-hidden rounded-md shadow-xs transition active:scale-[0.96] ${
                    amountReceived === value ? 'ring-2 ring-lime' : 'ring-1 ring-br2 hover:ring-lime/50'
                  }`}
                >
                  <img src={img} alt="" draggable={false} className="block aspect-[2.2/1] w-full bg-s2 object-contain" />
                </button>
              ))}
              <button
                onClick={() => setAmountReceived(chargeAmount)}
                className="flex aspect-[2.2/1] items-center justify-center rounded-md border border-lime/40 bg-lime/10 text-[12px] font-semibold text-lime"
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
              onClick={() => choosePayMethod(m.key)}
              className={`rounded-xl border-2 py-2.5 text-center transition-colors ${
                payMethod === m.key ? 'border-lime bg-lime/15 text-lime' : 'border-br bg-s1 text-txt2 hover:border-br2 hover:bg-s2 hover:text-txt'
              }`}
            >
              <m.icon size={20} className="mx-auto mb-1" />
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
              placeholder="Nota para esta venta (opcional)..."
              rows={2}
              className="input resize-none text-[12px]"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={clear} title="Vaciar carrito" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-red/40 hover:text-red">
            <Trash2 size={16} />
          </button>
          <button onClick={() => setNotesOpen((o) => !o)} title="Agregar nota" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
            <FileText size={16} />
          </button>
          <button onClick={openDiscount} title="Descuento manual" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
            %
          </button>
          <button
            onClick={confirmCheckout}
            disabled={insufficientCash}
            className={`flex-1 rounded-[10px] py-2.5 text-[14px] font-bold transition-transform active:scale-[0.98] ${
              insufficientCash ? 'cursor-not-allowed bg-br2 text-muted' : 'bg-lime text-on-solid hover:brightness-110'
            }`}
          >
            {insufficientCash ? `Falta ${formatMoney(-change)}` : 'Confirmar cobro'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
