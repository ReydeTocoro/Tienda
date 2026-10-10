import { create } from 'zustand'
import type { CartItem } from '../types/cartItem'
import type { PayMethod } from '../types/sale'
import { generateId } from '../shared/lib/id'
import { samePrice } from '../shared/lib/prices'
import { toast } from './useToastStore'

interface AddUnitSource {
  code: string
  name: string
  price: number
  brand: string
  unit: string
  stock: number
}

/** What one cart holds. */
export interface CartData {
  items: CartItem[]
  customerId: string | null
  customerName: string | null
  payMethod: PayMethod
  fiadoName: string
  manualDiscountPct: number
  notes: string
  /** Cash-register tender: null = charge the computed total as-is. Set when the cashier types a
   * different "Total a cobrar" (e.g. rounding cash to the nearest bill). */
  chargeOverride: number | null
  /** Cash received from the customer — used to compute change for `payMethod === 'efectivo'`. */
  amountReceived: number
}

/** One open sale. Several can be open at once (customers who arrive together): each keeps its own
 * lines, customer, discount and tender, and only the active one is on screen. */
export interface Cart extends CartData {
  id: string
  /** Tab label: "Carrito 2" until the cashier renames it ("Doña Marta", "Mesa 3"...). */
  name: string
}

interface CartState {
  /** Never empty, in tab order. */
  carts: Cart[]
  /** Always the id of one of `carts`. */
  activeId: string

  // Everything below edits the ACTIVE cart.
  addUnitItem: (p: AddUnitSource, qty?: number) => void
  addWeightedItem: (item: CartItem, stock: number, editIndex?: number | null) => void
  addFreeItem: (desc: string, price: number, qty: number) => void
  changeQty: (index: number, delta: number, maxStock?: number) => void
  /** Charges a line at another of its product's prices (Precio 1, 2 or 3 — the caller offers only
   * those); free lines keep the price they were typed at. */
  setItemPrice: (index: number, price: number) => void
  removeItem: (index: number) => void
  setCustomer: (id: string | null, name: string | null) => void
  setPayMethod: (m: PayMethod) => void
  setFiadoName: (n: string) => void
  setManualDiscountPct: (p: number) => void
  setNotes: (n: string) => void
  setChargeOverride: (n: number | null) => void
  setAmountReceived: (n: number) => void
  /** "Vaciar carrito": empties the active cart but keeps its tab and its name. */
  clear: () => void

  /** Opens a new empty cart and switches to it. */
  openCart: () => void
  selectCart: (id: string) => void
  /** A blank name is ignored (the cart keeps the one it had). */
  renameCart: (id: string, name: string) => void
  /** Drops a cart, by id — not "the active one": charging a sale takes a moment and the cashier
   * may have switched carts meanwhile. Closing the only cart leaves a fresh empty one instead, so
   * there is always a cart to sell on. */
  closeCart: (id: string) => void
}

export const MAX_CART_NAME = 24

const emptyData = (): CartData => ({
  items: [],
  customerId: null,
  customerName: null,
  payMethod: 'efectivo',
  fiadoName: '',
  manualDiscountPct: 0,
  notes: '',
  chargeOverride: null,
  amountReceived: 0,
})

// Not `generateId()`: the first cart is built when this module loads, and `crypto.randomUUID`
// only exists on secure pages (https/localhost) — over plain http the whole app would fail to start.
let cartSeq = 0
const newCart = (name: string): Cart => ({ id: `c${Date.now().toString(36)}${(++cartSeq).toString(36)}`, name, ...emptyData() })

/** "Carrito N" with the lowest N no open cart is using, so closing "Carrito 2" and opening another
 * brings "Carrito 2" back instead of counting up forever. */
export function nextCartName(carts: Cart[]): string {
  const taken = new Set(carts.map((c) => c.name))
  let n = 1
  while (taken.has(`Carrito ${n}`)) n++
  return `Carrito ${n}`
}

/** The cart on screen. Read the cart's data through this (or `useActiveCart` in a component), never
 * off the store's top level. */
export const selectActiveCart = (s: Pick<CartState, 'carts' | 'activeId'>): Cart => s.carts.find((c) => c.id === s.activeId) ?? s.carts[0]

const firstCart = newCart('Carrito 1')

/** Replaces the legacy global `cart`/`selClient`/`payMethod` variables (index.html L1769-1772). */
export const useCartStore = create<CartState>((set, get) => {
  /** Every edit of "the cart" goes through here, so it always lands in the active one. */
  const patchActive = (patch: Partial<CartData>) =>
    set((s) => ({ carts: s.carts.map((c) => (c.id === s.activeId ? { ...c, ...patch } : c)) }))
  const active = () => selectActiveCart(get())

  return {
    carts: [firstCart],
    activeId: firstCart.id,

    addUnitItem: (p, qty = 1) => {
      const items = active().items
      const idx = items.findIndex((i) => i.code === p.code)
      if (idx >= 0) {
        const existing = items[idx]
        if (existing.qty + qty > p.stock) {
          toast('Stock insuficiente', 'orange')
          return
        }
        const next = [...items]
        next[idx] = { ...existing, qty: existing.qty + qty }
        patchActive({ items: next })
      } else {
        if (qty > p.stock) {
          toast('Stock insuficiente', 'orange')
          return
        }
        patchActive({
          items: [...items, { code: p.code, name: p.name, price: p.price, qty, brand: p.brand, unit: p.unit || 'unidad', isFree: false }],
        })
      }
    },

    addWeightedItem: (item, stock, editIndex = null) => {
      const items = active().items
      if (editIndex !== null && editIndex !== undefined) {
        if (item.qty > stock) {
          toast('Stock insuficiente', 'orange')
          return
        }
        const next = [...items]
        next[editIndex] = item
        patchActive({ items: next })
        return
      }
      const idx = items.findIndex((i) => i.code === item.code)
      if (idx >= 0) {
        const merged = parseFloat((items[idx].qty + item.qty).toFixed(4))
        if (merged > stock) {
          toast('Stock insuficiente', 'orange')
          return
        }
        const next = [...items]
        next[idx] = { ...next[idx], qty: merged, price: item.price }
        patchActive({ items: next })
      } else {
        if (item.qty > stock) {
          toast('Stock insuficiente', 'orange')
          return
        }
        patchActive({ items: [...items, item] })
      }
    },

    addFreeItem: (desc, price, qty) => {
      const item: CartItem = {
        code: 'FREE_' + generateId(),
        name: desc,
        price,
        qty,
        brand: '',
        unit: 'unidad',
        isFree: true,
      }
      patchActive({ items: [...active().items, item] })
    },

    changeQty: (index, delta, maxStock) => {
      const items = active().items
      const item = items[index]
      if (!item) return
      if (delta > 0 && !item.isFree && maxStock !== undefined && item.qty + delta > maxStock) {
        toast('Stock máximo alcanzado', 'orange')
        return
      }
      const nextQty = item.qty + delta
      if (nextQty <= 0) {
        patchActive({ items: items.filter((_, i) => i !== index) })
        return
      }
      const next = [...items]
      next[index] = { ...item, qty: nextQty }
      patchActive({ items: next })
    },

    setItemPrice: (index, price) => {
      const items = active().items
      const item = items[index]
      if (!item || item.isFree || !Number.isFinite(price) || price < 0 || samePrice(item.price, price)) return
      const next = [...items]
      next[index] = { ...item, price }
      patchActive({ items: next })
    },

    removeItem: (index) => patchActive({ items: active().items.filter((_, i) => i !== index) }),

    setCustomer: (customerId, customerName) => patchActive({ customerId, customerName }),
    setPayMethod: (payMethod) => patchActive({ payMethod }),
    setFiadoName: (fiadoName) => patchActive({ fiadoName }),
    setManualDiscountPct: (manualDiscountPct) => patchActive({ manualDiscountPct }),
    setNotes: (notes) => patchActive({ notes }),
    setChargeOverride: (chargeOverride) => patchActive({ chargeOverride }),
    setAmountReceived: (amountReceived) => patchActive({ amountReceived }),

    clear: () => patchActive(emptyData()),

    openCart: () =>
      set((s) => {
        const cart = newCart(nextCartName(s.carts))
        return { carts: [...s.carts, cart], activeId: cart.id }
      }),

    selectCart: (id) => set((s) => (s.activeId === id || !s.carts.some((c) => c.id === id) ? s : { activeId: id })),

    renameCart: (id, name) => {
      const clean = name.trim().slice(0, MAX_CART_NAME).trimEnd()
      if (!clean) return
      set((s) => ({ carts: s.carts.map((c) => (c.id === id ? { ...c, name: clean } : c)) }))
    },

    closeCart: (id) =>
      set((s) => {
        const idx = s.carts.findIndex((c) => c.id === id)
        if (idx < 0) return s
        if (s.carts.length === 1) {
          const fresh = newCart('Carrito 1')
          return { carts: [fresh], activeId: fresh.id }
        }
        const carts = s.carts.filter((c) => c.id !== id)
        // Closing the cart on screen moves to the one that takes its place in the strip (the next
        // customer in line), or to the last one if it was the last.
        const activeId = s.activeId === id ? carts[Math.min(idx, carts.length - 1)].id : s.activeId
        return { carts, activeId }
      }),
  }
})

/** A field of the active cart, as a store subscription: `useActiveCart((c) => c.items)`. */
export function useActiveCart<T>(pick: (cart: Cart) => T): T {
  return useCartStore((s) => pick(selectActiveCart(s)))
}
