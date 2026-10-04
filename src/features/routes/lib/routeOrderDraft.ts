import type { CartItem } from '../../../types/cartItem'
import type { Product } from '../../../types/product'
import type { RouteOrder } from '../../../types/routeOrder'
import { round2 } from '../../../shared/lib/cash'

/** Local, throwaway state of a pedido being put together — mirrors suppliers/lib/orderDraft.ts's
 * `Draft`. Nothing here is real until "Guardar"/"Tomar pedido": only then does the server
 * validate it and store it as a RouteOrder. */
export interface RouteDraft {
  customerId: string | null
  customerName: string
  items: CartItem[]
  notes: string
}

export const EMPTY_ROUTE_DRAFT: RouteDraft = { customerId: null, customerName: '', items: [], notes: '' }

export type RouteDraftAction =
  | { type: 'setCustomer'; customerId: string | null; customerName: string }
  | { type: 'pick'; product: Product }
  | { type: 'setQty'; code: string; qty: number }
  | { type: 'setPrice'; code: string; price: number }
  | { type: 'remove'; code: string }
  | { type: 'setNotes'; notes: string }
  | { type: 'clear' }

export function routeDraftReducer(state: RouteDraft, action: RouteDraftAction): RouteDraft {
  switch (action.type) {
    case 'setCustomer':
      return { ...state, customerId: action.customerId, customerName: action.customerName }
    case 'pick': {
      const p = action.product
      if (state.items.some((i) => i.code === p.code)) {
        return { ...state, items: state.items.map((i) => (i.code === p.code ? { ...i, qty: i.qty + 1 } : i)) }
      }
      const item: CartItem = { code: p.code, name: p.name, price: p.price, cost: p.cost, qty: 1, brand: p.brand, unit: p.unit || 'unidad', isFree: false }
      return { ...state, items: [...state.items, item] }
    }
    case 'setQty':
      return { ...state, items: state.items.map((i) => (i.code === action.code ? { ...i, qty: Math.max(0, action.qty) } : i)) }
    case 'setPrice':
      return { ...state, items: state.items.map((i) => (i.code === action.code ? { ...i, price: Math.max(0, action.price) } : i)) }
    case 'remove':
      return { ...state, items: state.items.filter((i) => i.code !== action.code) }
    case 'setNotes':
      return { ...state, notes: action.notes }
    case 'clear':
      return EMPTY_ROUTE_DRAFT
  }
}

export const draftTotal = (items: CartItem[]): number => round2(items.reduce((t, i) => t + i.qty * i.price, 0))

export function draftFromRouteOrder(o: RouteOrder): RouteDraft {
  return { customerId: o.customerId ?? null, customerName: o.customerName, items: o.items, notes: o.notes ?? '' }
}
