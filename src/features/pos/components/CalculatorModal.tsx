import { useState } from 'react'

interface CalculatorModalProps {
  open: boolean
  onClose: () => void
  onUseAsPrice: (value: number) => void
}

const ROWS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
]

function exec(a: number, b: number, op: string): number {
  if (op === '+') return a + b
  if (op === '−') return a - b
  if (op === '×') return a * b
  if (op === '÷') return b !== 0 ? a / b : 0
  return b
}

/** Floating calculator — legacy `openCalc()` (index.html L2770-2892). */
export function CalculatorModal({ open, onClose, onUseAsPrice }: CalculatorModalProps) {
  const [num, setNum] = useState('0')
  const [prev, setPrev] = useState<string | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const [expr, setExpr] = useState('')

  if (!open) return null

  function press(k: string) {
    const digits = '0123456789.'
    if (digits.includes(k)) {
      if (fresh) {
        setNum(k === '.' ? '0.' : k)
        setFresh(false)
      } else if (k === '.' && num.includes('.')) {
        // ignore
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

  const disp = parseFloat(num)
  const dispStr = isNaN(disp) ? 'Error' : disp.toLocaleString('es', { maximumFractionDigits: 8 })

  return (
    <div className="fixed bottom-[70px] right-3.5 z-[3000] animate-[sheetUp_0.2s_ease] lg:bottom-6 lg:right-6" onClick={(e) => e.stopPropagation()}>
      <div className="w-[240px] overflow-hidden rounded-[20px] border border-br2 bg-s1 shadow-[var(--shadow-md)]">
        <div className="flex items-center justify-between border-b border-br bg-s1 px-3 py-1.5">
          <span className="text-[11px] font-semibold text-txt2">🧮 Calculadora</span>
          <button onClick={onClose} className="text-[13px] text-muted">
            ✕
          </button>
        </div>
        <div className="border-b border-br bg-s2 px-4 py-3.5">
          <div className="h-4 overflow-hidden text-right font-mono text-[11px] text-muted">{expr}</div>
          <div className="break-all text-right font-mono text-[28px] font-bold leading-tight">{dispStr}</div>
        </div>
        <div className="grid grid-cols-4 gap-px bg-br">
          {ROWS.flat().map((k) => {
            const isOp = ['÷', '×', '−', '+', '='].includes(k)
            const isFunc = ['C', '±', '%'].includes(k)
            const isDel = k === '⌫'
            return (
              <button
                key={k}
                onClick={() => press(k)}
                className={`py-4 font-mono text-[18px] select-none ${
                  isOp ? 'bg-lime/10 font-bold text-lime' : isFunc ? 'bg-s3 text-txt' : isDel ? 'bg-red/10 font-bold text-red' : 'bg-s1 text-txt'
                }`}
              >
                {k}
              </button>
            )
          })}
        </div>
        <div className="border-t border-br bg-s2 p-2.5">
          <button
            onClick={() => onUseAsPrice(parseFloat(num) || 0)}
            className="w-full rounded-[10px] border border-blue/30 bg-blue/10 py-2 text-[12px] font-bold text-blue"
          >
            🏷️ Usar como precio en Producto libre
          </button>
        </div>
      </div>
    </div>
  )
}
