import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '../../db/repositories/settings'
import { sha256 } from '../../shared/lib/pin'
import { usePinStore } from '../../store/usePinStore'

export const PIN_MAX_ATTEMPTS = 5
export const PIN_LOCKOUT_MS = 30_000

/** PIN verification + persistent lockout (decision 4: an absolute `pinLockedUntil` timestamp
 * in `settings`, so a reload or app close mid-lockout doesn't reset it). Ported from legacy's
 * `_checkPin`/`_startLockout` (index.html L6756-6828), minus the in-memory-only timer. */
export function usePinGate() {
  const settings = useLiveQuery(() => getSettings())
  const [now, setNow] = useState(() => Date.now())

  const lockedUntil = settings?.pinLockedUntil ?? 0
  const isLocked = lockedUntil > now

  useEffect(() => {
    if (!isLocked) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [isLocked])

  const checkPin = useCallback(async (entered: string): Promise<boolean> => {
    const s = await getSettings()
    const hash = await sha256(entered)
    return hash === s.pinHash
  }, [])

  const registerFailure = useCallback(async (): Promise<{ attempts: number; lockedNow: boolean }> => {
    const attempts = usePinStore.getState().incAttempts()
    if (attempts >= PIN_MAX_ATTEMPTS) {
      await updateSettings({ pinLockedUntil: Date.now() + PIN_LOCKOUT_MS })
      usePinStore.getState().resetAttempts()
      return { attempts, lockedNow: true }
    }
    return { attempts, lockedNow: false }
  }, [])

  const registerSuccess = useCallback((): void => {
    usePinStore.getState().resetAttempts()
  }, [])

  return {
    pinLength: settings?.pinLength ?? 4,
    isLocked,
    remainingSecs: Math.max(0, Math.ceil((lockedUntil - now) / 1000)),
    checkPin,
    registerFailure,
    registerSuccess,
  }
}
