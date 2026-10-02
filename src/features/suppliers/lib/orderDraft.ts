import type { Product } from '../../../types/product'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import { round2 } from '../../../shared/lib/cash'

/** Local, throwaway state of the order being put together (picked products, quantities, costs).
 * It is a reducer — and not server data — because nothing here is real until "Guardar"/"Enviar":
 * only then does the server validate it and store it as a purchase order. */
export interface DraftLine {
  code: string
  name: string
  qty: number
  unitCost: number
}

export interface Draft {
  supplierId: string | null
  lines: DraftLine[]
  notes: string
}

export const EMPTY_DRAFT: Draft = { supplierId: null, lines: [], notes: '' }

export type DraftAction =
  | { type: 'setSupplier'; supplierId: string | null }
  | { type: 'toggle'; line: DraftLine }
  | { type: 'setQty'; code: string; qty: number }
  | { type: 'setCost'; code: string; unitCost: number }
  | { type: 'setNotes'; notes: string }
  | { type: 'remove'; code: string }
  | { type: 'load'; draft: Draft }
  | { type: 'clear' }

export function draftReducer(state: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'setSupplier':
      return { ...state, supplierId: action.supplierId }
    case 'toggle':
      return state.lines.some((l) => l.code === action.line.code)
        ? { ...state, lines: state.lines.filter((l) => l.code !== action.line.code) }
        : { ...state, lines: [...state.lines, action.line] }
    case 'setQty':
      return { ...state, lines: state.lines.map((l) => (l.code === action.code ? { ...l, qty: Math.max(0, action.qty) } : l)) }
    case 'setCost':
      return { ...state, lines: state.lines.map((l) => (l.code === action.code ? { ...l, unitCost: Math.max(0, action.unitCost) } : l)) }
    case 'setNotes':
      return { ...state, notes: action.notes }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.code !== action.code) }
    case 'load':
      return action.draft
    case 'clear':
      return EMPTY_DRAFT
  }
}

export const draftTotal = (lines: DraftLine[]): number => round2(lines.reduce((t, l) => t + l.qty * l.unitCost, 0))

/** Enough to get back to twice the minimum; with no minimum set, one unit to start from. */
export function suggestedQty(p: Product): number {
  const target = p.min > 0 ? p.min * 2 - p.stock : 1
  return Math.max(Math.round(target * 1000) / 1000, 1)
}

export function lineFromProduct(p: Product): DraftLine {
  return { code: p.code, name: p.name, qty: suggestedQty(p), unitCost: p.cost || 0 }
}

export function draftFromOrder(o: PurchaseOrder): Draft {
  return { supplierId: o.supplierId, lines: o.lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, unitCost: l.unitCost })), notes: o.notes ?? '' }
}
