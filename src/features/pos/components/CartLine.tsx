import { X } from 'lucide-react'
import type { CartItem } from '../../../types/cartItem'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
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
  onRemove: () => void
  onEditMeasured: () => void
}

/** One cart line, as compact as it can be so a long sale fits without scrolling: name over
 * "unit price · code" on the left, then stepper, line total and remove on the same row (~42px).
 * Sized by the cart card's own width (a container query, the card is the `@container`), not the
 * window's: in a narrow cart — a phone — it falls back to two rows, remove top-right and the
 * stepper with the total underneath. */
export function CartLine({ item, prices, onChangePrice, onChangeQty, onRemove, onEditMeasured }: CartLineProps) {
  const measured = isMeasuredUnit(item.unit)
  const ul = measured ? unitShortLabel(item.unit) : null
  const pickable = !item.isFree && !!prices && prices.length > 1 && !!onChangePrice

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
            · {item.isFree ? 'Sin código' : item.code}
            {item.brand ? ' · ' + item.brand : ''}
          </span>
        </div>
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
          <span className="min-w-6 px-0.5 text-center font-mono text-[13px]">{formatQty(item.qty)}</span>
          <button
            disabled={item.isFree}
            onClick={() => onChangeQty(1)}
            aria-label="Sumar uno"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-br2 bg-s3 text-[14px] transition-colors hover:border-lime/40 hover:text-lime disabled:opacity-30 disabled:hover:border-br2 disabled:hover:text-txt"
          >
            +
          </button>
        </div>
      )}

      <span className="justify-self-end font-mono text-[13px] font-medium text-lime">{formatMoney(item.price * item.qty)}</span>
    </div>
  )
}
