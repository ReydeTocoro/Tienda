import { useMemo, useState } from 'react'
import type { Product } from '../../../types/product'
import { useCartStore } from '../../../store/useCartStore'
import { useCartTotals } from '../hooks/useFinalizeSale'
import { useSelectedCustomerLoyalty } from '../hooks/useSelectedCustomerLoyalty'
import { formatMoney } from '../../../shared/lib/currency'
import { unitShortLabel, isMeasuredUnit } from '../../../shared/lib/units'

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

  const [notesOpen, setNotesOpen] = useState(false)
  const { pts: loyaltyPts } = useSelectedCustomerLoyalty()
  const { subtotal, discount, discountLabel, total } = useCartTotals(loyaltyPts)

  const stockByCode = useMemo(() => new Map(products.map((p) => [p.code, p.stock])), [products])
  const totalItems = items.reduce((a, i) => a + i.qty, 0)

  const discLabel = discountLabel === 'manual' ? `Desc. manual (${manualDiscountPct}%)` : discountLabel === 'loyalty' ? `Desc. cliente (${loyaltyPts} pts)` : ''

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-br bg-s1 px-3 py-2 lg:px-4 lg:py-2.5">
        <span className="text-[13px] font-bold lg:text-[14px]">Carrito</span>
        <span className="font-mono text-[11px] text-lime">{totalItems > 0 ? `${totalItems} ítem${totalItems !== 1 ? 's' : ''}` : ''}</span>
      </div>

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
              <div key={i} className="grid grid-cols-[1fr_80px_70px_60px_28px] items-center gap-1.5 border-b border-br px-3 py-2.5">
                <div>
                  <div className="text-[13px] font-semibold">
                    {item.name}
                    {item.isFree && (
                      <span className="ml-1 rounded border border-orange/30 bg-orange/10 px-1 py-px text-[9px] font-bold text-orange">LIBRE</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-muted">
                    {item.isFree ? '🏷️ Sin código' : item.code}
                    {item.brand ? ' · ' + item.brand : ''}
                  </div>
                </div>
                {measured ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="whitespace-nowrap font-mono text-[12px] text-lime">
                      {item.qty} {ul}
                    </span>
                    <button onClick={() => onEditMeasured(i)} className="rounded border border-br2 bg-s3 px-1.5 py-0.5 text-[10px] text-txt2">
                      ✏ editar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1">
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
                <div className="font-mono text-[12px] text-txt2">
                  {formatMoney(item.price)}
                  {measured ? `/${ul}` : ''}
                </div>
                <div className="font-mono text-[13px] font-medium text-lime">{formatMoney(item.price * item.qty)}</div>
                <button onClick={() => removeItem(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] text-muted transition-colors hover:bg-red/10 hover:text-red">
                  ✕
                </button>
              </div>
            )
          })
        )}
      </div>

      {items.length > 0 && (
        <div className="flex-shrink-0 border-t border-br bg-s1">
          <div className="px-3.5 py-3.5">
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
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 border-t border-br pt-3 text-[20px] font-bold">
              <span>TOTAL</span>
              <span className="font-mono text-lime">{formatMoney(total)}</span>
            </div>
          </div>

          <div className="border-t border-br px-3 py-2.5">
            <p className="mb-2 field-label">Método de pago</p>
            <div className="grid grid-cols-3 gap-2">
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
              <div className="mt-2">
                <label className="mb-1 block field-label">Nombre (fiado)</label>
                <input className="input" value={fiadoName} onChange={(e) => setFiadoName(e.target.value)} placeholder="¿A quién le fías?" />
              </div>
            )}
          </div>

          {notesOpen && (
            <div className="border-t border-br px-3 py-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="📝 Nota para esta venta (opcional)..."
                rows={2}
                className="input resize-none text-[12px]"
              />
            </div>
          )}

          <div className="flex gap-2 border-t border-br px-3 py-2.5">
            <button onClick={clear} title="Vaciar carrito" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-red/40 hover:text-red">
              🗑
            </button>
            <button onClick={() => setNotesOpen((o) => !o)} title="Agregar nota" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
              📝
            </button>
            <button onClick={onOpenDiscount} title="Descuento manual" className="rounded-[10px] border border-br2 px-3 py-2.5 text-txt2 transition-colors hover:border-br2 hover:bg-s2">
              %
            </button>
            <button onClick={onCheckout} className="flex-1 rounded-[10px] bg-green py-2.5 text-[14px] font-bold text-black transition-transform hover:brightness-110 active:scale-[0.98]">
              ✓ Cobrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
