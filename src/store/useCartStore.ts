import { create } from 'zustand'
import type { CartItem } from '../types/cartItem'
import type { PayMethod } from '../types/sale'
import { generateId } from '../shared/lib/id'
import { toast } from './useToastStore'

interface AddUnitSource {
  code: string
  name: string
  price: number
  cost: number
  brand: string
  unit: string
  stock: number
}

interface CartState {
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

  addUnitItem: (p: AddUnitSource, qty?: number) => void
  addWeightedItem: (item: CartItem, editIndex?: number | null) => void
  addFreeItem: (desc: string, price: number, qty: number) => void
  changeQty: (index: number, delta: number, maxStock?: number) => void
  removeItem: (index: number) => void
  setCustomer: (id: string | null, name: string | null) => void
  setPayMethod: (m: PayMethod) => void
  setFiadoName: (n: string) => void
  setManualDiscountPct: (p: number) => void
  setNotes: (n: string) => void
  setChargeOverride: (n: number | null) => void
  setAmountReceived: (n: number) => void
  clear: () => void
}

const initialSlice = {
  items: [] as CartItem[],
  customerId: null as string | null,
  customerName: null as string | null,
  payMethod: 'efectivo' as PayMethod,
  fiadoName: '',
  manualDiscountPct: 0,
  notes: '',
  chargeOverride: null as number | null,
  amountReceived: 0,
}

/** Replaces the legacy global `cart`/`selClient`/`payMethod` variables (index.html L1769-1772). */
export const useCartStore = create<CartState>((set, get) => ({
  ...initialSlice,

  addUnitItem: (p, qty = 1) => {
    const items = get().items
    const idx = items.findIndex((i) => i.code === p.code)
    if (idx >= 0) {
      const existing = items[idx]
      if (existing.qty + qty > p.stock) {
        toast('⚠ Stock insuficiente', 'orange')
        return
      }
      const next = [...items]
      next[idx] = { ...existing, qty: existing.qty + qty }
      set({ items: next })
    } else {
      if (qty > p.stock) {
        toast('⚠ Stock insuficiente', 'orange')
        return
      }
      set({
        items: [...items, { code: p.code, name: p.name, price: p.price, cost: p.cost, qty, brand: p.brand, unit: p.unit || 'unidad', isFree: false }],
      })
    }
  },

  addWeightedItem: (item, editIndex = null) => {
    const items = get().items
    if (editIndex !== null && editIndex !== undefined) {
      const next = [...items]
      next[editIndex] = item
      set({ items: next })
      return
    }
    const idx = items.findIndex((i) => i.code === item.code)
    if (idx >= 0) {
      const next = [...items]
      next[idx] = { ...next[idx], qty: parseFloat((next[idx].qty + item.qty).toFixed(4)), price: item.price }
      set({ items: next })
    } else {
      set({ items: [...items, item] })
    }
  },

  addFreeItem: (desc, price, qty) => {
    const item: CartItem = {
      code: 'FREE_' + generateId(),
      name: desc,
      price,
      cost: 0,
      qty,
      brand: '',
      unit: 'unidad',
      isFree: true,
    }
    set({ items: [...get().items, item] })
  },

  changeQty: (index, delta, maxStock) => {
    const items = get().items
    const item = items[index]
    if (!item) return
    if (delta > 0 && !item.isFree && maxStock !== undefined && item.qty + delta > maxStock) {
      toast('⚠ Stock máximo alcanzado', 'orange')
      return
    }
    const nextQty = item.qty + delta
    if (nextQty <= 0) {
      set({ items: items.filter((_, i) => i !== index) })
      return
    }
    const next = [...items]
    next[index] = { ...item, qty: nextQty }
    set({ items: next })
  },

  removeItem: (index) => set({ items: get().items.filter((_, i) => i !== index) }),

  setCustomer: (customerId, customerName) => set({ customerId, customerName }),
  setPayMethod: (payMethod) => set({ payMethod }),
  setFiadoName: (fiadoName) => set({ fiadoName }),
  setManualDiscountPct: (manualDiscountPct) => set({ manualDiscountPct }),
  setNotes: (notes) => set({ notes }),
  setChargeOverride: (chargeOverride) => set({ chargeOverride }),
  setAmountReceived: (amountReceived) => set({ amountReceived }),

  clear: () => set({ ...initialSlice }),
}))
