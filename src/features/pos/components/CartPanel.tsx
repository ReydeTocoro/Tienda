import { useMemo, useState } from 'react'
import { Banknote, Smartphone, Handshake, Tag, Trash2, FileText, ShoppingCart, X, PackagePlus } from 'lucide-react'
import type { Product } from '../../../types/product'
import { selectActiveCart, useActiveCart, useCartStore } from '../../../store/useCartStore'
import { toast } from '../../../store/useToastStore'
import { useCartTotals } from '../hooks/useFinalizeSale'
import { formatMoney } from '../../../shared/lib/currency'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { AccountPicker } from '../../../shared/components/AccountPicker'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { CartTabs } from './CartTabs'
import { ClientBar } from './ClientBar'
import { CartLine } from './CartLine'
import { FreeProductModal } from './FreeProductModal'
import { BILLS } from '../../../shared/lib/bills'
import { usePermission } from '../../pin/usePermission'
import { countItems } from '../lib/cartCount'
import { priceOptions } from '../../../shared/lib/prices'

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
  const setQty = useCartStore((s) => s.setQty)
  const setItemPrice = useCartStore((s) => s.setItemPrice)
  const removeItem = useCartStore((s) => s.removeItem)
  const clear = useCartStore((s) => s.clear)
  const payMethod = useActiveCart((c) => c.payMethod)
  const setPayMethod = useCartStore((s) => s.setPayMethod)
  const transferAccount = useActiveCart((c) => c.transferAccount)
  const setTransferAccount = useCartStore((s) => s.setTransferAccount)
  const fiadoName = useActiveCart((c) => c.fiadoName)
  const setFiadoName = useCartStore((s) => s.setFiadoName)
  const notes = useActiveCart((c) => c.notes)
  const setNotes = useCartStore((s) => s.setNotes)
  const customerId = useActiveCart((c) => c.customerId)
  const chargeOverride = useActiveCart((c) => c.chargeOverride)
  const setChargeOverride = useCartStore((s) => s.setChargeOverride)
  const amountReceived = useActiveCart((c) => c.amountReceived)
  const cartName = useActiveCart((c) => c.name)
  const manyCarts = useCartStore((s) => s.carts.length > 1)
  const setAmountReceived = useCartStore((s) => s.setAmountReceived)

  const [notesOpen, setNotesOpen] = useState(false)
  const [freeOpen, setFreeOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  // "Cambiar el total" approved by someone allowed, for this one charge.
  const [totalUnlocked, setTotalUnlocked] = useState(false)
  const { can, requirePermission } = usePermission()
  const canEditTotal = can('ventas.cambiarTotal') || totalUnlocked
  const { subtotal, discount, total, chargeAmount, roundingAdjustment } = useCartTotals()

  const productByCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products])
  const totalItems = countItems(items)


  const change = amountReceived - chargeAmount
  // A cash sale can't be charged until the cashier has said what the customer paid with — and it must cover the total.
  // (A sale that costs nothing needs no cash.)
  const cashShort = payMethod === 'efectivo' && chargeAmount > 0 && change < 0
  // A transfer says which account it came into, so the day's close can tell them apart.
  const accountMissing = payMethod === 'transferencia' && chargeAmount > 0 && !transferAccount

  /** A bill pressed adds to what was already received; read from the store so two quick taps never use a stale figure. */
  const addBill = (value: number) => setAmountReceived(selectActiveCart(useCartStore.getState()).amountReceived + value)

  function startCheckout() {
    if (!items.length) {
      toast('Agrega productos al carrito para cobrar', 'orange')
      return
    }
    setTotalUnlocked(false)
    // Starts from nothing every time: the bills add up, so what a previous try left would be added to.
    setAmountReceived(0)
    setTransferAccount(null)
    setCheckoutOpen(true)
  }

  async function unlockTotal() {
    if (await requirePermission('ventas.cambiarTotal', 'Cambiar el total', 'Ajustar el total a cobrar requiere autorización de alguien con permiso.')) setTotalUnlocked(true)
  }

  async function choosePayMethod(m: (typeof PAY_METHODS)[number]['key']) {
    if (m === 'fiado' && !(await requirePermission('ventas.fiar', 'Vender fiado', 'Fiar requiere autorización de alguien con permiso.'))) return
    setPayMethod(m)
  }

  async function openFree() {
    if (await requirePermission('ventas.productoLibre', 'Producto sin registrar', 'Cobrar algo que no está en el inventario requiere autorización de alguien con permiso.')) setFreeOpen(true)
  }

  async function openDiscount() {
    if (await requirePermission('ventas.descuentos', 'Descuento manual', 'Dar un descuento requiere autorización de alguien con permiso.')) onOpenDiscount()
  }

  function confirmCheckout() {
    if (cashShort || accountMissing) return
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
          // The last product added on top, where the eye is; each line keeps its index in the cart (the sale and its
          // receipt keep the order they were added in).
          [...items.keys()].reverse().map((i) => {
            const item = items[i]
            const product = productByCode.get(item.code)
            return (
              <CartLine
                key={i}
                item={item}
                // The product's own prices as they are now: a line can be charged at any of them.
                prices={product ? priceOptions(product) : undefined}
                onChangePrice={(price) => setItemPrice(i, price)}
                onChangeQty={(delta) => changeQty(i, delta, product?.stock)}
                onSetQty={(qty) => setQty(i, qty, product?.stock)}
                onRemove={() => removeItem(i)}
                onEditMeasured={() => onEditMeasured(i)}
              />
            )
          })
        )}
      </div>

      <div className="flex-shrink-0 border-t border-br px-2.5 py-3 sm:px-3.5">
        <button
          type="button"
          onClick={openFree}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-br2 py-2 text-[12px] font-semibold text-txt2 transition-colors hover:bg-s2 hover:text-txt"
        >
          <PackagePlus size={15} /> Producto sin registrar
        </button>
        <button
          onClick={startCheckout}
          aria-disabled={!items.length}
          className={`flex w-full items-center justify-between gap-2 rounded-[10px] bg-lime px-3 py-3 text-on-solid transition active:scale-[0.98] sm:px-4 ${items.length ? 'hover:brightness-110' : 'opacity-50'}`}
        >
          <span className="text-[13px] font-bold sm:text-[14px]">Cobrar</span>
          <span className="font-mono text-[14px] font-bold sm:text-[17px]">{formatMoney(chargeAmount)}</span>
        </button>
      </div>

      <FreeProductModal open={freeOpen} onClose={() => setFreeOpen(false)} />

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
              <span className="rounded-md bg-yellow px-1.5 py-0.5 text-[11px] font-semibold text-on-yellow">Descuento</span>
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
            <div className="mb-2 flex items-center justify-between">
              <p className="field-label">Efectivo recibido</p>
              {amountReceived > 0 ? (
                <button type="button" onClick={() => setAmountReceived(0)} className="text-[12px] font-semibold text-txt2 hover:text-red">
                  Borrar
                </button>
              ) : (
                <span className="text-[11px] text-muted">Toca los billetes: se van sumando</span>
              )}
            </div>
            <MoneyInput
              autoFocus placeholder="0"
              className="input mb-2 text-right font-mono text-[22px] font-bold"
              value={amountReceived}
              onChange={(v) => setAmountReceived(v ?? 0)}
            />
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {BILLS.map(({ value, img }) => (
                <button
                  key={value}
                  onClick={() => addBill(value)}
                  aria-label={formatMoney(value)}
                  title={formatMoney(value)}
                  className="overflow-hidden rounded-md shadow-xs ring-1 ring-br2 transition hover:ring-lime/50 active:scale-[0.96]"
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
        {payMethod === 'transferencia' && (
          <div className="mb-3.5">
            <p className="mb-2 field-label">¿A qué cuenta llegó?</p>
            <AccountPicker value={transferAccount} onChange={setTransferAccount} />
          </div>
        )}
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
          <button onClick={openDiscount} title="Descuento en dinero" aria-label="Descuento en dinero" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
            <Tag size={16} />
          </button>
          <button
            data-enter onClick={confirmCheckout}
            disabled={cashShort || accountMissing}
            className={`flex-1 rounded-[10px] py-2.5 text-[14px] font-bold transition-transform active:scale-[0.98] ${
              cashShort || accountMissing ? 'cursor-not-allowed bg-br2 text-muted' : 'bg-lime text-on-solid hover:brightness-110'
            }`}
          >
            {accountMissing ? 'Elige la cuenta' : cashShort ? (amountReceived > 0 ? `Falta ${formatMoney(-change)}` : 'Indica con cuánto paga') : 'Confirmar cobro'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
