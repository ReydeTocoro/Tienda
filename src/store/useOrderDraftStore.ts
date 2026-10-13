import { create } from 'zustand'
import { draftFromOrder, draftReducer, EMPTY_DRAFT, type Draft, type DraftAction } from '../features/suppliers/lib/orderDraft'
import type { PurchaseOrder } from '../types/purchaseOrder'

export type ProveedoresTab = 'pedidos' | 'nuevo' | 'porpagar' | 'proveedores'

interface OrderDraftState {
  /** The tab of Proveedores on screen, so coming back from another module lands where it was. */
  tab: ProveedoresTab
  /** The saved draft being continued; null = a new order. */
  editing: PurchaseOrder | null
  draft: Draft
  setTab: (tab: ProveedoresTab) => void
  dispatch: (action: DraftAction) => void
  /** Starts another order (a new one, optionally for a supplier, or a saved draft) and shows it. */
  start: (order: PurchaseOrder | null, supplierId?: string | null) => void
  /** Saved, sent, emptied, or the person signed out (it carries purchase prices): back to nothing. */
  reset: () => void
}

const INITIAL = { tab: 'pedidos' as ProveedoresTab, editing: null, draft: EMPTY_DRAFT }

/** The purchase order being put together in Proveedores → Nuevo pedido. In memory only, like the carts: it survives going
 * to another module and back, not a reload — and never touches the device's disk, since it carries purchase prices. */
export const useOrderDraftStore = create<OrderDraftState>((set) => ({
  ...INITIAL,
  setTab: (tab) => set({ tab }),
  dispatch: (action) => set((s) => ({ draft: draftReducer(s.draft, action) })),
  start: (order, supplierId = null) => set({ tab: 'nuevo', editing: order, draft: order ? draftFromOrder(order) : { ...EMPTY_DRAFT, supplierId } }),
  reset: () => set(INITIAL),
}))
