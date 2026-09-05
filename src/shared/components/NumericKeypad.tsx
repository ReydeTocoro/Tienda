const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫']

interface NumericKeypadProps {
  onKey: (key: string) => void
  allowDot?: boolean
}

/** Reusable digit-entry keypad — used by the weight/measure modal (Fase 2) and the PIN pad
 * (Fase 6). The calculator's operator grid is bespoke (different key set/styling). */
export function NumericKeypad({ onKey, allowDot = true }: NumericKeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.filter((k) => allowDot || k !== '.').map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className={`rounded-xl border py-3.5 font-mono text-xl font-semibold transition active:scale-95 ${
            k === '⌫' ? 'border-red/20 bg-red/10 text-red' : 'border-br bg-s2 text-txt'
          }`}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
