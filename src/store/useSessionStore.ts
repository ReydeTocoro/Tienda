import { create } from 'zustand'
import { OWNER_ID, OWNER_NAME } from '../shared/lib/permissions'

export { OWNER_ID, OWNER_NAME }

/** Whoever is signed in at this device's counter. */
export interface Operator {
  /** `OWNER_ID` for the owner's master PIN, otherwise the usuario's id. */
  id: string
  name: string
  roleId: string
}

interface SessionState {
  /** null = nobody signed in: the open counter works with its counter role, or (PIN mode) the lock
   * screen shows. Lives in memory only, like the carts — a reload signs everyone out (the server is
   * told so as the app starts). It mirrors what the server holds for this device, which is what
   * every request and the database's RLS actually go by. */
  operator: Operator | null
  /** Name of whoever authorized the latest one-off step (a supervisor's PIN on a cashier's
   * session), for attribution when nobody is signed in. */
  lastAuthorizer: string | null
  /** Set by AppShell: PIN mode with nobody signed in. Global shortcuts stand still while it's on. */
  locked: boolean
  /** The server and this app agree on who is working (after the startup sign-out, or a sign-in).
   * Until then no secret data is downloaded. */
  serverReady: boolean
  /** The owner came in with the factory PIN: they choose another before anything else. */
  mustChangePin: boolean
  signIn: (operator: Operator) => void
  signOut: () => void
  /** Keeps the signed-in person's name/role in step when an admin edits them. */
  updateOperator: (patch: Partial<Omit<Operator, 'id'>>) => void
  setLastAuthorizer: (name: string) => void
  setLocked: (locked: boolean) => void
  setServerReady: (ready: boolean) => void
  setMustChangePin: (must: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  operator: null,
  lastAuthorizer: null,
  locked: false,
  serverReady: false,
  mustChangePin: false,
  signIn: (operator) => set({ operator, serverReady: true }),
  signOut: () => set({ operator: null, mustChangePin: false }),
  updateOperator: (patch) => set((s) => (s.operator ? { operator: { ...s.operator, ...patch } } : s)),
  setLastAuthorizer: (lastAuthorizer) => set({ lastAuthorizer }),
  setLocked: (locked) => set((s) => (s.locked === locked ? s : { locked })),
  setServerReady: (serverReady) => set({ serverReady }),
  setMustChangePin: (mustChangePin) => set({ mustChangePin }),
}))
