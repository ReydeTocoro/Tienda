import { create } from 'zustand'
import { OWNER_ID, OWNER_NAME } from '../shared/lib/permissions'

export { OWNER_ID, OWNER_NAME }

/** Whoever is working on this device: the person whose account is signed in. */
export interface Operator {
  /** `OWNER_ID` for an owner's account, otherwise the usuario's id. */
  id: string
  name: string
  roleId: string
}

interface SessionState {
  /** The person whose account is signed in here, as the server said (or, until it answers, as it
   * said last time on this device — enough to draw the right screens). Memory only. It mirrors what
   * the server holds for this session, which is what every request and the database's RLS go by. */
  operator: Operator | null
  /** Name of whoever authorized the latest one-off step with their PIN (a supervisor on a
   * cashier's session). */
  lastAuthorizer: string | null
  /** The server bound this session to its person (as the app starts). Until then no secret data is
   * downloaded. */
  serverReady: boolean
  /** The server confirmed who this is. */
  confirm: (operator: Operator) => void
  /** Before the server answers: who this account was the last time. */
  assume: (operator: Operator) => void
  /** Keeps the name/role in step when an admin edits them. */
  updateOperator: (patch: Partial<Omit<Operator, 'id'>>) => void
  setLastAuthorizer: (name: string) => void
  /** The account is signing out. */
  clear: () => void
}

const sameOperator = (a: Operator | null, b: Operator) => !!a && a.id === b.id && a.name === b.name && a.roleId === b.roleId

export const useSessionStore = create<SessionState>((set) => ({
  operator: null,
  lastAuthorizer: null,
  serverReady: false,
  // The same person every minute keeps the same object: nothing re-renders for nothing.
  confirm: (operator) => set((s) => ({ operator: sameOperator(s.operator, operator) ? s.operator : operator, serverReady: true })),
  assume: (operator) => set((s) => (s.serverReady ? s : { operator })),
  updateOperator: (patch) => set((s) => (s.operator ? { operator: { ...s.operator, ...patch } } : s)),
  setLastAuthorizer: (lastAuthorizer) => set({ lastAuthorizer }),
  clear: () => set({ operator: null, lastAuthorizer: null, serverReady: false }),
}))
