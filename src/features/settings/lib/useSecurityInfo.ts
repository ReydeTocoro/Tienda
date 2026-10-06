import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { apiGet } from '../../../api/client'

/** What only the server knows about the store's PINs (it keeps them hashed where no device can read
 * them) — server/domain/counter.ts `securityInfo`. Administrador only. */
export interface SecurityInfo {
  /** The master PIN is still the factory one (1234). */
  ownerPinDefault: boolean
  /** Users whose PIN someone else also has (only rows saved before PINs had to be unique). */
  sharedPinUserIds: string[]
  ownerSharesPin: boolean
  /** Wrong PINs across the store in the current 24 hours, and a store-wide lockout if one is on. */
  wrongPins24h: number
  lockedUntil: number | null
}

/** Bumped after saving a PIN or a user, so every screen showing this asks again. */
export const useSecurityVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}))

/** The store's PIN situation, fetched when the screen opens and after each PIN or user change. */
export function useSecurityInfo(): SecurityInfo | null {
  const version = useSecurityVersion((s) => s.version)
  const [info, setInfo] = useState<SecurityInfo | null>(null)
  useEffect(() => {
    let alive = true
    apiGet<SecurityInfo>('/api/counter/security')
      .then((i) => {
        if (alive) setInfo(i)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [version])
  return info
}
