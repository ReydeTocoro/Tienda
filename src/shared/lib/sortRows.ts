export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string = string> {
  key: K
  dir: SortDir
}

/** Next sort state when a column header is clicked: the same column flips direction, a new one
 * starts ascending. */
export function nextSort<K extends string>(sort: SortState<K>, key: K): SortState<K> {
  return sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
}

/** Sorts a copy of `rows` by a derived value: strings compare ignoring case and accents and
 * numeric-aware ("2" before "10"), numbers compare numerically. Rows with equal values keep the
 * `tiebreak` order, so the result is stable and predictable. */
export function sortRows<T>(rows: T[], value: (row: T) => string | number, dir: SortDir, tiebreak?: (a: T, b: T) => number): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const cmp = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) : va - vb
    return cmp * sign || (tiebreak ? tiebreak(a, b) : 0)
  })
}
