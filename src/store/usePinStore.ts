import { create } from 'zustand'

export interface PinVerifyResult {
  ok: boolean
  /** Display name of whoever the entered PIN matched — shown on success and used for audit
   * attribution (e.g. "unlocked by Juan"). */
  identity?: string
}

interface PendingPinRequest {
  title: string
  subtitle: string
  /** Each caller supplies its own check — the admin gate matches the master PIN or any active
   * admin-role usuario; a "log in as this cashier" flow matches one specific usuario. The modal
   * itself stays generic. */
  verify: (entered: string) => Promise<PinVerifyResult>
  resolve: (result: PinVerifyResult) => void
}

interface PinState {
  /** Persists for the whole session once unlocked (decision 3) — resets only on a full reload. */
  isAdminUnlocked: boolean
  /** Display name from the most recent successful PIN entry (any kind), for attribution. */
  lastIdentity: string | null
  request: PendingPinRequest | null
  /** Digit buffer + failed-attempt count live here (not component state) so they survive the
   * PIN modal unmounting/remounting between separate `ask()` calls. */
  buffer: string
  attempts: number
  ask: (title: string, subtitle: string, verify: (entered: string) => Promise<PinVerifyResult>) => Promise<PinVerifyResult>
  settle: (result: PinVerifyResult) => void
  markAdminUnlocked: () => void
  setBuffer: (b: string) => void
  incAttempts: () => number
  resetAttempts: () => void
}

/** Replaces the legacy role-picker + `pedirPin()` callback system (decision 3: no role
 * screen, PIN is the only gate, and unlocking it stays unlocked for the session). */
export const usePinStore = create<PinState>((set, get) => ({
  isAdminUnlocked: false,
  lastIdentity: null,
  request: null,
  buffer: '',
  attempts: 0,
  ask: (title, subtitle, verify) =>
    new Promise<PinVerifyResult>((resolve) => {
      set({ request: { title, subtitle, verify, resolve }, buffer: '' })
    }),
  settle: (result) => {
    const req = get().request
    set({ request: null, buffer: '' })
    if (result.ok) set({ attempts: 0, ...(result.identity ? { lastIdentity: result.identity } : {}) })
    req?.resolve(result)
  },
  markAdminUnlocked: () => set({ isAdminUnlocked: true }),
  setBuffer: (buffer) => set({ buffer }),
  incAttempts: () => {
    const next = get().attempts + 1
    set({ attempts: next })
    return next
  },
  resetAttempts: () => set({ attempts: 0 }),
}))
