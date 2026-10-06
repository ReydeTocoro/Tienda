import { useEffect, useState } from 'react'
import type { PinVerifyResult } from '../../store/usePinStore'
import { usePinGate, PIN_MAX_ATTEMPTS } from './usePinGate'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

interface PinPadProps {
  /** Checks a complete PIN (it submits itself once `settings.pinLength` digits are in). */
  onSubmit: (entered: string) => Promise<PinVerifyResult>
  onSuccess: (result: PinVerifyResult) => void
  onEscape?: () => void
  /** Wrong PIN — the host shakes its card. */
  onWrong?: () => void
  /** Whether the physical keyboard types into the pad. Off while another field on screen has focus. */
  active?: boolean
}

/** Dots, keypad and the lockout. The PIN goes to the server, which says whose it is, counts the
 * wrong ones and locks this device (or the whole store) for a while — this pad only shows what it
 * answered. Used by the PIN dialog and by the lock screen. */
export function PinPad({ onSubmit, onSuccess, onEscape, onWrong, active = true }: PinPadProps) {
  const { pinLength, isLocked, remainingSecs, attemptsUsed } = usePinGate()
  const [buffer, setBuffer] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function submit(entered: string) {
    setChecking(true)
    const result = await onSubmit(entered)
    setChecking(false)
    if (result.ok) {
      setBuffer('')
      onSuccess(result)
      return
    }
    setBuffer('')
    onWrong?.()
    if (navigator.vibrate) navigator.vibrate([90, 50, 90])
    const left = result.attemptsLeft
    if (left !== undefined && !result.lockedUntil) {
      setError(`PIN incorrecto — ${left} intento${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''}`)
    } else {
      setError(result.error || 'PIN incorrecto')
    }
  }

  function pressKey(k: string) {
    if (isLocked || !k || checking) return
    if (k === '⌫') {
      setBuffer(buffer.slice(0, -1))
      setError('')
      return
    }
    if (buffer.length >= pinLength) return
    const next = buffer + k
    setBuffer(next)
    setError('')
    if (next.length === pinLength) setTimeout(() => void submit(next), 130)
  }

  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        pressKey(e.key)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        pressKey('⌫')
      } else if (e.key === 'Escape' && onEscape) {
        e.preventDefault()
        onEscape()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, buffer, isLocked, checking, pinLength])

  const attemptPct = (attemptsUsed / PIN_MAX_ATTEMPTS) * 100

  return (
    <>
      {isLocked && (
        <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-red/30 bg-red/10 px-3 py-2.5 text-left text-[11px] font-semibold text-red">
          <span>PIN bloqueado temporalmente</span>
          <span className="ml-auto min-w-[34px] text-right font-mono text-[14px] font-extrabold">{remainingSecs}s</span>
        </div>
      )}

      <div className="mb-1.5 flex justify-center gap-3.5" aria-label={`${buffer.length} de ${pinLength} dígitos`}>
        {Array.from({ length: pinLength }).map((_, i) => (
          <div
            key={i}
            className={`h-[18px] w-[18px] rounded-full border-2 transition-all ${
              i < buffer.length ? 'scale-110 border-lime bg-lime ring-4 ring-lime/15' : 'border-br2 bg-transparent'
            } ${error && !isLocked ? 'border-red bg-red' : ''}`}
          />
        ))}
      </div>
      <div role="alert" className="mb-3.5 min-h-[18px] text-[11px] font-semibold text-red">
        {error}
      </div>

      <div className="mb-4 h-[3px] overflow-hidden rounded-full bg-s3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${attemptPct}%`, background: attemptPct >= 80 ? 'var(--color-red)' : attemptPct >= 50 ? 'var(--color-orange)' : 'var(--color-lime)' }}
        />
      </div>

      <div className={`mb-4 grid grid-cols-3 gap-2.5 ${isLocked ? 'pointer-events-none opacity-35 grayscale' : ''}`}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => pressKey(k)}
              aria-label={k === '⌫' ? 'Borrar' : k}
              className={`rounded-2xl border border-br bg-s2 py-4 font-mono text-[22px] font-bold transition-colors hover:bg-s3 active:scale-[0.91] active:bg-s3 ${
                k === '⌫' ? 'text-red' : 'text-txt'
              }`}
            >
              {k}
            </button>
          ),
        )}
      </div>
    </>
  )
}
