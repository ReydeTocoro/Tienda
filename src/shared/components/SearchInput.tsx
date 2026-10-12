import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { History, Search, X } from 'lucide-react'
import { useRecentSearches } from '../hooks/useRecentSearches'
import { suggestionsFor } from '../lib/searchHistory'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Names this box's list of recent searches (kept on the device). With it, clicking the box offers
   * the last ten searches made in it; without it the box remembers nothing. */
  historyKey?: string
}

/** A mouse press on one of the suggestions must not take the focus off the box: it would close the
 * list before the click arrives. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** Search box of the spreadsheet-style pages' toolbars (Stock, Clientes, Facturas…). A search counts as
 * made when it is confirmed with Enter, when the box is left with it typed, or when a suggestion is
 * picked — not while it is still being typed. */
export function SearchInput({ value, onChange, placeholder, historyKey }: SearchInputProps) {
  const { recent, refresh, remember, forget, clear } = useRecentSearches(historyKey)
  const [open, setOpen] = useState(false)
  /** The suggestion the arrow keys are on; -1 = none, the typed text. */
  const [active, setActive] = useState(-1)
  /** What narrows the suggestions: nothing when the list has just been opened (the box may already hold
   * a search — clicking it still shows the last ten), what is typed from then on. */
  const [narrow, setNarrow] = useState('')
  const suggestions = useMemo(() => suggestionsFor(recent, narrow), [recent, narrow])
  const showList = open && suggestions.length > 0

  function close() {
    setOpen(false)
    setActive(-1)
  }

  function openAll() {
    setNarrow('')
    setOpen(true)
  }

  function pick(term: string) {
    onChange(term)
    remember(term)
    close()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!historyKey) return
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && showList) {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === 'Enter') {
      if (showList && suggestions[active]) {
        e.preventDefault()
        pick(suggestions[active])
      } else {
        remember(value)
        close()
      }
    } else if (e.key === 'Escape' && showList) {
      close()
    }
  }

  return (
    <div className="relative min-w-[200px] flex-1">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        className="input py-2 pl-9"
        aria-label="Buscar"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setNarrow(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => {
          refresh()
          openAll()
        }}
        // Clicking a box that already has the focus, but whose list is closed (after Escape, or after
        // picking), opens it again; while it is open a click only places the cursor.
        onClick={() => {
          if (!open) openAll()
        }}
        onBlur={() => {
          remember(value)
          close()
        }}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-br bg-s1 shadow-md">
          <div className="flex items-center justify-between border-b border-br bg-s2 px-3 py-1.5">
            <span className="field-label">Búsquedas recientes</span>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                keepFocus(e)
                clear()
              }}
              className="text-[11px] font-semibold text-txt2 transition-colors hover:text-red"
            >
              Borrar historial
            </button>
          </div>
          {suggestions.map((term, i) => (
            <div key={term} className={`flex items-center transition-colors ${i === active ? 'bg-s3' : 'hover:bg-s2'}`}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  keepFocus(e)
                  pick(term)
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px]"
              >
                <History size={14} className="flex-shrink-0 text-muted" />
                <span className="truncate">{term}</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                title="Quitar de las recientes"
                aria-label={`Quitar «${term}» de las búsquedas recientes`}
                onMouseDown={(e) => {
                  keepFocus(e)
                  forget(term)
                }}
                className="mr-1.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-red/10 hover:text-red"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
