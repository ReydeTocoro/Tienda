import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

interface CalculatorModalProps {
  open: boolean
  onClose: () => void
}

const ROWS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
]

/** What the physical keyboard presses (digits aside): the numeric pad's own keys, Enter for "=", and
 * a comma for the decimal point, as a Spanish keyboard types it. */
const KEYBOARD: Record<string, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  x: '×',
  X: '×',
  '/': '÷',
  Enter: '=',
  '=': '=',
  '%': '%',
  '.': '.',
  ',': '.',
  Backspace: '⌫',
  Delete: 'C',
  c: 'C',
  C: 'C',
}

const MAX_DIGITS = 15

function exec(a: number, b: number, op: string): number {
  if (op === '+') return a + b
  if (op === '−') return a - b
  if (op === '×') return a * b
  if (op === '÷') return b !== 0 ? a / b : 0
  return b
}

/** The number as it is being typed: a trailing point or zeros ("0.", "1.50") stay on screen, which
 * `toLocaleString` alone would drop, so each key visibly does something. */
function display(num: string): string {
  const n = parseFloat(num)
  if (isNaN(n)) return 'Error'
  const typing = /^(-?\d+)\.(\d*)$/.exec(num)
  if (typing && (typing[2] === '' || typing[2].endsWith('0'))) return Number(typing[1]).toLocaleString('es') + ',' + typing[2]
  return n.toLocaleString('es', { maximumFractionDigits: 8 })
}

/** Floating calculator — legacy `openCalc()` (index.html L2770-2892). It takes the keyboard while it
 * is open and has the focus (it grabs it as it opens, and again when one of its keys is clicked): the
 * digits, + − * /, Enter or = for the result, Backspace, Delete or C to clear, Escape to close. */
export function CalculatorModal({ open, onClose }: CalculatorModalProps) {
  const [num, setNum] = useState('0')
  const [prev, setPrev] = useState<string | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const [expr, setExpr] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) return null

  function press(k: string) {
    const digits = '0123456789.'
    if (digits.includes(k)) {
      if (fresh) {
        setNum(k === '.' ? '0.' : k)
        setFresh(false)
      } else if (k === '.' && num.includes('.')) {
        // ignore
      } else if (num.replace(/[-.]/g, '').length >= MAX_DIGITS) {
        // ignore: more digits than a number can hold exactly
      } else if (num === '0' && k !== '.') {
        setNum(k)
      } else {
        setNum(num + k)
      }
    } else if (k === '⌫') {
      setNum(num.length <= 1 ? '0' : num.slice(0, -1))
    } else if (k === 'C') {
      setNum('0')
      setOp(null)
      setPrev(null)
      setFresh(false)
      setExpr('')
    } else if (k === '±') {
      setNum(String(-(parseFloat(num) || 0)))
    } else if (k === '%') {
      setNum(String((parseFloat(num) || 0) / 100))
    } else if (['+', '−', '×', '÷'].includes(k)) {
      let n = num
      if (op && !fresh && prev !== null) n = String(exec(parseFloat(prev), parseFloat(num), op))
      setNum(n)
      setPrev(n)
      setOp(k)
      setFresh(true)
      setExpr(n + ' ' + k)
    } else if (k === '=') {
      if (op && prev !== null) {
        const res = exec(parseFloat(prev), parseFloat(num), op)
        setExpr(prev + ' ' + op + ' ' + num + ' =')
        setNum(String(parseFloat(res.toFixed(8))))
        setOp(null)
        setPrev(null)
        setFresh(true)
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return // Ctrl+C and friends stay the browser's
    if ((e.target as HTMLElement).closest('[data-calc-close]')) return // Enter on the close button closes it
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    const k = /^[0-9]$/.test(e.key) ? e.key : KEYBOARD[e.key]
    if (!k) return
    e.preventDefault()
    // The key is the calculator's, not the app's: "/" would otherwise jump to the search bar.
    e.stopPropagation()
    press(k)
  }

  return (
    <div className="fixed bottom-[70px] right-3.5 z-[3000] animate-[sheetUp_0.2s_ease] md:bottom-6 md:right-6" onClick={(e) => e.stopPropagation()}>
      {/* `data-keys-owner`: the barcode reader leaves the keys typed here alone (useHidScanner). */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="group"
        aria-label="Calculadora"
        data-keys-owner
        onKeyDown={onKeyDown}
        className="w-[240px] overflow-hidden rounded-[20px] border border-br bg-s1 shadow-lg outline-none"
      >
        <div className="flex items-center justify-between border-b border-br bg-s1 px-3 py-1.5">
          <span className="text-[11px] font-semibold text-txt2">Calculadora</span>
          <button onClick={onClose} data-calc-close aria-label="Cerrar calculadora" className="text-muted">
            <X size={14} />
          </button>
        </div>
        <div className="border-b border-br bg-s2 px-4 py-3.5">
          <div className="h-4 overflow-hidden text-right font-mono text-[11px] text-muted">{expr}</div>
          <div className="break-all text-right font-mono text-[28px] font-bold leading-tight">{display(num)}</div>
        </div>
        <div className="grid grid-cols-4 gap-px bg-br">
          {ROWS.flat().map((k) => {
            const isOp = ['÷', '×', '−', '+', '='].includes(k)
            const isFunc = ['C', '±', '%'].includes(k)
            const isDel = k === '⌫'
            return (
              <button
                key={k}
                onClick={() => {
                  press(k)
                  panelRef.current?.focus() // keep typing here after a click
                }}
                // A click leaves the focus where it is (the panel), so the keyboard goes on working.
                onMouseDown={(e) => e.preventDefault()}
                className={`py-4 font-mono text-[18px] select-none ${
                  isOp ? 'bg-lime/10 font-bold text-lime' : isFunc ? 'bg-s3 text-txt' : isDel ? 'bg-red/10 font-bold text-red' : 'bg-s1 text-txt'
                }`}
              >
                {k}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
