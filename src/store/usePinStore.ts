import { create } from 'zustand'
import type { Operator } from './useSessionStore'

/** What the server answered to a PIN. */
export interface PinVerifyResult {
  ok: boolean
  /** Who the PIN belongs to, when it was accepted. */
  operator?: Operator
  /** Shown instead of "PIN incorrecto" — e.g. the PIN is right but that person lacks the permission. */
  error?: string
  /** Wrong PIN: tries left before this device locks for a while. */
  attemptsLeft?: number
  /** Locked out until this moment (epoch ms): this device, or the whole store. */
  lockedUntil?: number
}

interface PendingPinRequest {
  title: string
  subtitle: string
  /** Each caller supplies its own check (sign in, or authorize one step); the modal stays generic. */
  verify: (entered: string) => Promise<PinVerifyResult>
  resolve: (result: PinVerifyResult) => void
}

interface PinState {
  request: PendingPinRequest | null
  /** The server's last word on wrong PINs, shared by every pad on this device (the dialog and the
   * lock screen): tries left, and a lockout. The server enforces both; this only shows them. */
  attemptsLeft: number | null
  lockedUntil: number
  ask: (title: string, subtitle: string, verify: (entered: string) => Promise<PinVerifyResult>) => Promise<PinVerifyResult>
  settle: (result: PinVerifyResult) => void
  /** Records what a PIN check said about tries and lockout. */
  noteResult: (result: PinVerifyResult) => void
}

/** The PIN modal's request queue of one: `ask()` opens it and resolves with what was entered. */
export const usePinStore = create<PinState>((set, get) => ({
  request: null,
  attemptsLeft: null,
  lockedUntil: 0,
  ask: (title, subtitle, verify) =>
    new Promise<PinVerifyResult>((resolve) => {
      // A second ask while one is open (shouldn't happen) cancels the first instead of leaving it hanging.
      get().request?.resolve({ ok: false })
      set({ request: { title, subtitle, verify, resolve } })
    }),
  settle: (result) => {
    const req = get().request
    set({ request: null })
    req?.resolve(result)
  },
  noteResult: (result) =>
    set({
      attemptsLeft: result.ok ? null : (result.attemptsLeft ?? get().attemptsLeft),
      lockedUntil: result.lockedUntil ?? (result.ok ? 0 : get().lockedUntil),
    }),
}))
