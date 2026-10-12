import type { Product } from '../../../types/product'
import { sortRows, type SortState } from '../../../shared/lib/sortRows'
import { suggestedQty } from './orderDraft'

/** A product that can be put on an order, with its last purchase price filled in. */
export type Candidate = Product & { cost: number }

/** `bajo`: what is out of stock or under its minimum — what usually needs ordering. `todos`: any product. */
export type CandidateMode = 'bajo' | 'todos'

/** A loose unit made from a package is bought as the package, so it never has a row of its own. */
export const isOrderable = (p: Candidate): boolean => !p.esUnidadSuelta

export const isLowStock = (p: Candidate): boolean => p.stock <= p.min

export function filterCandidates(products: Candidate[], mode: CandidateMode, search: string): Candidate[] {
  const q = search.trim().toLowerCase()
  return products.filter(
    (p) => isOrderable(p) && (mode === 'todos' || isLowStock(p)) && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)),
  )
}

export type CandidateSortKey = 'name' | 'cat' | 'stock' | 'min' | 'suggest' | 'cost'

/** The emptiest shelves first. */
export const DEFAULT_CANDIDATE_SORT: SortState<CandidateSortKey> = { key: 'stock', dir: 'asc' }

function sortValue(p: Candidate, key: CandidateSortKey): string | number {
  switch (key) {
    case 'name':
      return p.name
    case 'cat':
      return p.cat || ''
    case 'stock':
      return p.stock
    case 'min':
      return p.min
    case 'suggest':
      return suggestedQty(p)
    case 'cost':
      return p.cost
  }
}

export function sortCandidates(products: Candidate[], { key, dir }: SortState<CandidateSortKey>): Candidate[] {
  return sortRows(products, (p) => sortValue(p, key), dir, (a, b) => a.name.localeCompare(b.name, 'es'))
}
