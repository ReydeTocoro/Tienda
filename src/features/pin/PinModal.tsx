import { useEffect, useState } from 'react'
import { usePinStore } from '../../store/usePinStore'
import { usePinGate, PIN_MAX_ATTEMPTS } from './usePinGate'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

/** The single PIN entry modal for the whole app — legacy `#pin-modal` (index.html L7643-7689). */
export function PinModal() {
  const request = usePinStore((s) => s.request)
  const buffer = usePinStore((s) => s.buffer)
  const setBuffer = usePinStore((s) => s.setBuffer)
  const settle = usePinStore((s) => s.settle)
  const attempts = usePinStore((s) => s.attempts)
  const { pinLength, isLocked, remainingSecs, registerFailure, registerSuccess } = usePinGate()
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  useEffect(() => {
    setError('')
  }, [request])

  useEffect(() => {
    if (!request) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        pressKey(e.key)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        pressKey('⌫')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        settle({ ok: false })
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, buffer, isLocked])

  if (!request) return null

  async function submit(entered: string) {
    if (!request) return
    const result = await request.verify(entered)
    if (result.ok) {
      registerSuccess()
      settle(result)
      return
    }
    setBuffer('')
    setShake(true)
    setTimeout(() => setShake(false), 450)
    if (navigator.vibrate) navigator.vibrate([90, 50, 90])
    const { attempts: attemptCount, lockedNow } = await registerFailure()
    if (lockedNow) {
      setError('Demasiados intentos — bloqueado')
    } else {
      const remaining = PIN_MAX_ATTEMPTS - attemptCount
      setError(`PIN incorrecto — ${remaining} intento${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`)
    }
  }

  function pressKey(k: string) {
    if (isLocked || !k) return
    if (k === '⌫') {
      setBuffer(buffer.slice(0, -1))
      setError('')
      return
    }
    if (buffer.length >= pinLength) return
    const next = buffer + k
    setBuffer(next)
    setError('')
    if (next.length === pinLength) {
      setTimeout(() => submit(next), 130)
    }
  }

  const attemptPct = (attempts / PIN_MAX_ATTEMPTS) * 100

  return (
    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/95 p-5 backdrop-blur-sm">
      <div className={`w-full max-w-[340px] rounded-[24px] border border-br2 bg-s1 px-[26px] pb-[26px] pt-[30px] text-center shadow-[var(--shadow-md)] ${shake ? 'animate-[pinShake_0.45s_ease]' : ''}`}>
        <div className="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-lime">
          Acceso protegido
        </div>
        <div className="mb-1 font-display text-[19px] font-bold leading-tight">{request.title}</div>
        <div className="mb-4.5 text-[11px] leading-relaxed text-muted">{request.subtitle}</div>

        {isLocked && (
          <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-red/30 bg-red/10 px-3 py-2.5 text-left text-[11px] font-semibold text-red">
            <span>PIN bloqueado temporalmente</span>
            <span className="ml-auto min-w-[34px] text-right font-mono text-[14px] font-extrabold">{remainingSecs}s</span>
          </div>
        )}

        <div className="mb-1.5 flex justify-center gap-3.5">
          {Array.from({ length: pinLength }).map((_, i) => (
            <div
              key={i}
              className={`h-[18px] w-[18px] rounded-full border-2 transition-all ${
                i < buffer.length ? 'scale-110 border-lime bg-lime shadow-[0_0_8px_rgba(200,240,96,0.4)]' : 'border-br2 bg-transparent'
              } ${error && !isLocked ? 'border-red bg-red' : ''}`}
            />
          ))}
        </div>
        <div className="mb-3.5 h-[18px] text-[11px] font-semibold text-red">{error}</div>

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
                onClick={() => pressKey(k)}
                className={`rounded-2xl border border-br bg-s2 py-4 font-mono text-[22px] font-bold active:scale-[0.91] active:bg-s3 ${
                  k === '⌫' ? 'text-red' : 'text-txt'
                }`}
              >
                {k}
              </button>
            ),
          )}
        </div>

        <button onClick={() => settle({ ok: false })} className="w-full py-1.5 text-[12px] text-muted">
          Cancelar
        </button>
      </div>
    </div>
  )
}
