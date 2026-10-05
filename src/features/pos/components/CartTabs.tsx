import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { MAX_CART_NAME, useCartStore, type Cart } from '../../../store/useCartStore'
import { useConfirm } from '../../../store/useConfirmStore'
import { countItems } from '../lib/cartCount'

/** The open carts as tabs across the top of the cart card — one per customer being served at the
 * same time — plus "+" for another. Each keeps its own lines, customer and tender while another
 * is on screen. The active tab carries the rename (pencil) and close (x) buttons; double-clicking
 * any tab renames it too. The strip scrolls sideways: a phone's cart column only fits a tab or two. */
export function CartTabs() {
  const carts = useCartStore((s) => s.carts)
  const activeId = useCartStore((s) => s.activeId)
  const selectCart = useCartStore((s) => s.selectCart)
  const openCart = useCartStore((s) => s.openCart)
  const renameCart = useCartStore((s) => s.renameCart)
  const closeCart = useCartStore((s) => s.closeCart)
  const confirm = useConfirm()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // A new cart opens past the right edge of a crowded strip: bring the whole active tab (its
  // rename and close buttons too, not just the name) into view.
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, carts.length])

  async function close(cart: Cart) {
    const n = countItems(cart.items)
    if (n > 0) {
      const ok = await confirm({
        title: 'Cerrar carrito',
        message: `«${cart.name}» tiene ${n} ítem${n !== 1 ? 's' : ''} sin cobrar. Si lo cierras se pierden.`,
        confirmLabel: 'Cerrar carrito',
        danger: true,
      })
      if (!ok) return
    }
    closeCart(cart.id)
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1 pr-2.5">
      <div ref={listRef} role="tablist" aria-label="Carritos abiertos" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none]">
        {carts.map((cart) => {
          const active = cart.id === activeId
          const renaming = cart.id === renamingId
          const count = countItems(cart.items)
          return (
            <div
              key={cart.id}
              data-active={active || undefined}
              className={`flex flex-shrink-0 items-center rounded-lg border text-[13px] font-semibold transition-colors ${
                active ? 'border-lime/40 bg-lime/10 text-lime' : 'border-transparent text-txt2 hover:bg-s2 hover:text-txt'
              }`}
            >
              {renaming ? (
                <RenameField
                  initial={cart.name}
                  onDone={(name) => {
                    if (name) renameCart(cart.id, name)
                    setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  role="tab"
                  aria-selected={active}
                  title={cart.name}
                  onClick={() => selectCart(cart.id)}
                  onDoubleClick={() => setRenamingId(cart.id)}
                  className={`flex items-center gap-1.5 rounded-lg py-1 pl-2.5 ${active ? 'pr-1' : 'pr-2.5'}`}
                >
                  <span className="max-w-[5.5rem] truncate @sm:max-w-[8.5rem]">{cart.name}</span>
                  {/* The active tab drops its count in a narrow cart column (a phone) to leave room for its buttons. */}
                  {count > 0 && (
                    <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[16px] ${active ? 'hidden bg-lime text-on-solid @sm:block' : 'bg-s3 text-txt2'}`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              )}
              {active && !renaming && (
                <>
                  <button
                    onClick={() => setRenamingId(cart.id)}
                    title="Cambiar nombre"
                    aria-label="Cambiar nombre del carrito"
                    className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-lime/15"
                  >
                    <Pencil size={12} />
                  </button>
                  {carts.length > 1 && (
                    <button
                      onClick={() => close(cart)}
                      title="Cerrar carrito"
                      aria-label="Cerrar carrito"
                      className="mr-0.5 flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-red/10 hover:text-red"
                    >
                      <X size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={openCart}
        title="Nuevo carrito"
        aria-label="Nuevo carrito"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-br2 text-lime transition-colors hover:border-lime/50 hover:bg-lime/10"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

/** The tab's name, editable in place: Enter or leaving the field saves, Escape cancels. */
function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  // Enter unmounts the field, which can fire a blur as well: settle once.
  function settle(name: string | null) {
    if (settled.current) return
    settled.current = true
    onDone(name)
  }

  return (
    <input
      ref={ref}
      defaultValue={initial}
      maxLength={MAX_CART_NAME}
      aria-label="Nombre del carrito"
      onBlur={(e) => settle(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') settle(e.currentTarget.value)
        else if (e.key === 'Escape') settle(null)
      }}
      className="w-32 rounded-md border border-lime bg-s1 px-2 py-0.5 text-[13px] font-semibold text-txt outline-none"
    />
  )
}
