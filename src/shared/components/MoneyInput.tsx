import { useState } from 'react'
import { formatQty } from '../lib/currency'

interface MoneyInputProps {
  id?: string
  value: number
  /** `null` means the field was cleared — caller decides what that falls back to
   * (e.g. the cart's charge override resets to the cart total; cash received resets to 0). */
  onChange: (v: number | null) => void
  className?: string
  placeholder?: string
  autoFocus?: boolean
}

/** Money field that shows a grouped, formatted value ("36.000") at rest but plain digits while
 * being typed — reformatting mid-keystroke fights the cursor. A native `type="number"` can't
 * show grouping or a "$" prefix at all, which is why the cart's amount fields read as bare,
 * decimal-less numbers next to every other (formatMoney'd) price on the same screen. */
export function MoneyInput({ id, value, onChange, className, placeholder, autoFocus }: MoneyInputProps) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`pl-6 ${className ?? ''}`}
        value={focused ? raw : value ? formatQty(value) : ''}
        onFocus={(e) => {
          setFocused(true)
          setRaw(value ? String(value) : '')
          e.target.select()
        }}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9.]/g, '')
          setRaw(next)
          onChange(next === '' ? null : Number(next) || 0)
        }}
        onBlur={() => setFocused(false)}
      />
    </div>
  )
}
