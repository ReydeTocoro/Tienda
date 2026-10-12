/** The latest searches typed into each search box, kept per device in `localStorage` (like the
 * theme): one JSON object with a list per box, newest first. A convenience only — when the storage
 * is blocked the box simply remembers nothing. */
const KEY = 'mtp-search-history'

/** How many searches a box offers back. */
export const MAX_RECENT = 10
/** A single letter is not a search worth keeping. */
const MIN_LENGTH = 2

/** `list` with `term` at the front (the newest), without an earlier copy of it (case aside) and at
 * most `max` long. Spaces are tidied; a term too short to be a search leaves the list as it was. */
export function addRecent(list: string[], term: string, max = MAX_RECENT): string[] {
  const clean = term.trim().replace(/\s+/g, ' ')
  if (clean.length < MIN_LENGTH) return list
  const same = clean.toLowerCase()
  return [clean, ...list.filter((t) => t.toLowerCase() !== same)].slice(0, max)
}

export function removeRecent(list: string[], term: string): string[] {
  return list.filter((t) => t !== term)
}

/** What to offer under a box that has `typed` in it: every recent search while it is empty, then only
 * the ones that contain what was typed (and aren't exactly that, which is already on screen). */
export function suggestionsFor(list: string[], typed: string): string[] {
  const q = typed.trim().toLowerCase()
  if (!q) return list
  return list.filter((t) => {
    const l = t.toLowerCase()
    return l.includes(q) && l !== q
  })
}

type Store = Record<string, string[]>

function read(): Store {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Store) : {}
  } catch {
    return {}
  }
}

/** The recent searches of one box (`key`), newest first. */
export function loadRecent(key: string): string[] {
  const list = read()[key]
  return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string').slice(0, MAX_RECENT) : []
}

export function saveRecent(key: string, list: string[]): void {
  const store = read()
  if (list.length) store[key] = list
  else delete store[key]
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Storage blocked or full: the list lives only as long as the open box.
  }
}

/** Forgets every box's searches — a device that stops being used ("Cerrar sesión y borrar"). */
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was stored.
  }
}
