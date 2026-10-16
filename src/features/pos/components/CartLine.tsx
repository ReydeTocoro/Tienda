import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { CartItem } from '../../../types/cartItem'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { lineDiscount } from '../../../shared/lib/discounts'
import type { PriceOption } from '../../../shared/lib/prices'
import { unitShortLabel, isMeasuredUnit } from '../../../shared/lib/units'
import { PricePicker } from './PricePicker'

interface CartLineProps {
  item: CartItem
  /** The product's prices when it has more than one (Precio 1, 2, 3): the price gets a tab to pick
   * another. Absent or a single price = the price is plain text. */
  prices?: PriceOption[]
  onChangePrice?: (price: number) => void
  onChangeQty: (delta: number) => void
  /** The quantity typed by hand in the number between − and +. */
  onSetQty: (qty: number) => void
  onRemove: () => void
  onEditMeasured: () => void
}

/** The number between − and +, which can also be typed over: click it, write 12, Enter (or leave it) and the line has 12.
 * An empty field, 0 or Escape leaves the quantity as it was — taking a line out is the X. */
function QtyField({ qty, name, onCommit }: { qty: number; name: string; onCommit: (qty: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const typed = useRef<string | null>(null)
  const edit = (v: string | null) => {
    typed.current = v
    setDraft(v)
  }
  function finish() {
    const text = typed.current
    edit(null)
    if (text && Number(text) >= 1 && Number(text) !== qty) onCommit(Number(text))
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`Cantidad de ${name}`}
      value={draft ?? formatQty(qty)}
      onFocus={(e) => {
        edit(String(qty))
        e.target.select()
      }}
      onChange={(e) => edit(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          edit(null)
          e.currentTarget.blur()
        }
      }}
      className="w-11 rounded-md border border-transparent bg-transparent px-0.5 py-0.5 text-center font-mono text-[13px] hover:border-br2 focus:border-lime focus:bg-s2 focus:outline-none"
    />
  )
}

/** One cart line, as compact as it can be so a long sale fits without scrolling: name over
 * "unit price · code" on the left, then stepper, line total and remove on the same row (~42px).
 * Sized by the cart card's own width (a container query, the card is the `@container`), not the
 * window's: in a narrow cart — a phone — it falls back to two rows, remove top-right and the
 * stepper with the total underneath. */
export function CartLine({ item, prices, onChangePrice, onChangeQty, onSetQty, onRemove, onEditMeasured }: CartLineProps) {
  const off = lineDiscount(item)
  const measured = isMeasuredUnit(item.unit)
  const ul = measured ? unitShortLabel(item.unit) : null
  const pickable = !!prices && prices.length > 1 && !!onChangePrice

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 border-b border-br px-3 py-1.5 @sm:grid-cols-[1fr_auto_minmax(5.5rem,auto)_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[13px] font-semibold leading-tight">
          <span className="truncate" title={item.name}>
            {item.name}
          </span>
          {item.isFree && <span className="flex-shrink-0 rounded border border-orange/30 bg-orange/10 px-1 py-px text-[9px] font-bold text-orange">LIBRE</span>}
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] leading-tight text-muted">
          {pickable ? (
            <PricePicker current={item.price} options={prices} per={measured ? `/${ul}` : ''} onPick={onChangePrice} />
          ) : (
            <span className="flex-shrink-0">
              {formatMoney(item.price)}
              {measured ? `/${ul}` : ''}
            </span>
          )}
          <span className="min-w-0 truncate">
            · {item.isFree ? 'Sin registrar' : item.code}
            {item.brand ? ' · ' + item.brand : ''}
          </span>
        </div>
        {off > 0 && (
          <div className="font-mono text-[10px] font-semibold leading-tight text-green">Desc. −{formatMoney(off)}</div>
        )}
      </div>

      <button
        onClick={onRemove}
        aria-label="Quitar del carrito"
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-red/10 hover:text-red @sm:order-last"
      >
        <X size={14} />
      </button>

      {measured ? (
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap font-mono text-[12px] text-lime">
            {formatQty(item.qty)} {ul}
          </span>
          <button onClick={onEditMeasured} className="rounded border border-br2 bg-s3 px-1.5 py-0.5 text-[10px] text-txt2">
            editar
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onChangeQty(-1)}
            aria-label="Restar uno"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-br2 bg-s3 text-[14px] transition-colors hover:border-lime/40 hover:text-lime"
          >
            −
          </button>
          <QtyField qty={item.qty} name={item.name} onCommit={onSetQty} />
          <button
            onClick={() => onChangeQty(1)}
            aria-label="Sumar uno"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-br2 bg-s3 text-[14px] transition-colors hover:border-lime/40 hover:text-lime"
          >
            +
          </button>
        </div>
      )}

      <span className="justify-self-end font-mono text-[13px] font-medium text-lime">{formatMoney(item.price * item.qty - off)}</span>
    </div>
  )
}
