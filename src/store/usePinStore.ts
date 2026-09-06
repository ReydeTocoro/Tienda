import { create } from 'zustand'

interface PendingPinRequest {
  title: string
  subtitle: string
  resolve: (ok: boolean) => void
}

interface PinState {
  /** Persists for the whole session once unlocked (decision 3) — resets only on a full reload. */
  isAdminUnlocked: boolean
  request: PendingPinRequest | null
  /** Digit buffer + failed-attempt count live here (not component state) so they survive the
   * PIN modal unmounting/remounting between separate `ask()` calls. */
  buffer: string
  attempts: number
  ask: (title: string, subtitle: string) => Promise<boolean>
  settle: (ok: boolean) => void
  setBuffer: (b: string) => void
  incAttempts: () => number
  resetAttempts: () => void
}

/** Replaces the legacy role-picker + `pedirPin()` callback system (decision 3: no role
 * screen, PIN is the only gate, and unlocking it stays unlocked for the session). */
export const usePinStore = create<PinState>((set, get) => ({
  isAdminUnlocked: false,
  request: null,
  buffer: '',
  attempts: 0,
  ask: (title, subtitle) =>
    new Promise<boolean>((resolve) => {
      set({ request: { title, subtitle, resolve }, buffer: '' })
    }),
  settle: (ok) => {
    const req = get().request
    set({ request: null, buffer: '' })
    if (ok) set({ isAdminUnlocked: true, attempts: 0 })
    req?.resolve(ok)
  },
  setBuffer: (buffer) => set({ buffer }),
  incAttempts: () => {
    const next = get().attempts + 1
    set({ attempts: next })
    return next
  },
  resetAttempts: () => set({ attempts: 0 }),
}))
