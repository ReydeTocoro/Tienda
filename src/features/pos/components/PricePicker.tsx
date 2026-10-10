import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { formatMoney } from '../../../shared/lib/currency'
import { samePrice, type PriceOption } from '../../../shared/lib/prices'

interface PricePickerProps {
  /** What the line is charged at now. */
  current: number
  /** The product's prices — two or more, or there is nothing to pick. */
  options: PriceOption[]
  /** "/kg" and the like, for a product sold by weight or measure. */
  per?: string
  onPick: (price: number) => void
}

const MENU_WIDTH = 216
const ROW_HEIGHT = 36
const MENU_CHROME = 44 // the title row plus the menu's padding and border
const GAP = 4
const EDGE = 8

interface Anchor {
  left: number
  top: number
  bottom: number
}

/** The small tab beside a cart line's price: the price the line is charged at, with a chevron that
 * opens the product's other prices (Precio 1, 2, 3) to charge instead. The list is drawn on `body`
 * at the button's position, so the cart's scrolling box can't clip it; it closes by itself on any
 * outside click, Escape, scrolling or resizing — its anchor would have moved. */
export function PricePicker({ current, options, per = '', onPick }: PricePickerProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  /** Opened with the keyboard: then the focus moves into the list (a mouse or a finger doesn't need it, and would only get a focus ring). */
  const byKeyboard = useRef(false)
  const isOpen = anchor !== null
  const selected = options.find((o) => samePrice(o.price, current))
  /** Charged at Precio 2 or 3 — worth seeing at a glance. */
  const alternate = !!selected && selected.slot !== 1
  /** Not any of the product's prices any more (an administrator changed them): the sale would be refused. */
  const stale = !selected

  function toggle(e: ReactMouseEvent) {
    if (isOpen) return setAnchor(null)
    byKeyboard.current = e.detail === 0
    const r = buttonRef.current?.getBoundingClientRect()
    if (r) setAnchor({ left: r.left, top: r.top, bottom: r.bottom })
  }

  useEffect(() => {
    if (!isOpen) return
    // Opened with the keyboard, the price in force (else the first) gets the focus, so it works from the first moment.
    const menu = menuRef.current
    const first = menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]')
    if (byKeyboard.current) first?.focus({ preventScroll: true })
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setAnchor(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAnchor(null)
      buttonRef.current?.focus()
    }
    const away = () => setAnchor(null)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [isOpen])

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab') {
      setAnchor(null)
      buttonRef.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])
    const at = rows.indexOf(document.activeElement as HTMLElement)
    rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
  }

  function pick(price: number) {
    setAnchor(null)
    if (byKeyboard.current) buttonRef.current?.focus()
    onPick(price)
  }

  let position: CSSProperties | undefined
  if (anchor) {
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - EDGE))
    const height = options.length * ROW_HEIGHT + MENU_CHROME
    // Below the price unless it doesn't fit there and does above.
    const fitsBelow = window.innerHeight - anchor.bottom - GAP - EDGE >= height
    position = fitsBelow || anchor.top < height + GAP + EDGE ? { left, top: anchor.bottom + GAP } : { left, bottom: window.innerHeight - anchor.top + GAP }
  }

  const tone = stale
    ? 'border-orange/40 bg-orange/10 text-orange'
    : alternate
      ? 'border-lime/40 bg-lime/10 text-lime'
      : 'border-br2 bg-s2 text-txt2 hover:border-lime/40 hover:text-lime'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Elegir otro precio (ahora ${formatMoney(current)}${selected ? `, ${selected.label}` : ''})`}
        title={stale ? 'Este precio ya no es de este producto: elige uno de la lista' : `${selected.label} · toca para elegir otro precio`}
        className={`relative flex flex-shrink-0 items-center gap-0.5 rounded-md border py-px pl-1 pr-0.5 text-[10px] font-medium leading-tight transition-colors before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] ${tone}`}
      >
        {formatMoney(current)}
        {per}
        <ChevronDown size={11} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Precios de venta de este producto"
            onKeyDown={onMenuKeyDown}
            style={{ ...position, width: MENU_WIDTH }}
            className="fixed z-[400] rounded-xl border border-br bg-s1 p-1 text-txt shadow-lg"
          >
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Cobrar a</div>
            {options.map((o) => {
              const on = selected?.slot === o.slot
              return (
                <button
                  key={o.slot}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => pick(o.price)}
                  className={`flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-[12px] transition-colors ${on ? 'bg-lime/10 font-bold text-lime' : 'font-medium hover:bg-s2'}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="flex h-3.5 w-3.5 items-center justify-center">{on && <Check size={13} strokeWidth={3} />}</span>
                    {o.label}
                  </span>
                  <span className="font-mono">
                    {formatMoney(o.price)}
                    {per}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
