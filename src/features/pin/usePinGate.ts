import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../../db/repositories/settings'
import { usePinStore } from '../../store/usePinStore'

/** Wrong PINs in a row before the server locks this device for a while (server/domain/counter.ts). */
export const PIN_MAX_ATTEMPTS = 5

/** What every PIN pad shows about lockouts. The server counts the wrong PINs and decides the lockout
 * (per device, and store-wide); this only reflects its last answer, with a live countdown. */
export function usePinGate() {
  const settings = useLiveQuery(() => getSettings())
  const lockedUntil = usePinStore((s) => s.lockedUntil)
  const attemptsLeft = usePinStore((s) => s.attemptsLeft)
  const [now, setNow] = useState(() => Date.now())
  const isLocked = lockedUntil > now

  useEffect(() => {
    if (!isLocked) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [isLocked])

  return {
    pinLength: settings?.pinLength ?? 4,
    isLocked,
    remainingSecs: Math.max(0, Math.ceil((lockedUntil - now) / 1000)),
    /** Wrong PINs counted so far in the current streak (0 when the server hasn't said). */
    attemptsUsed: attemptsLeft === null ? 0 : PIN_MAX_ATTEMPTS - attemptsLeft,
  }
}
