import { create } from 'zustand'

interface ConnectionState {
  /** The server can be reached (and answers): false after a call that never got an answer or got a 502/503/504,
   * true again as soon as one is answered. What the till does when this is false — keep selling on what it
   * has, queue the sales — is in src/offline. */
  reachable: boolean
  setReachable: (reachable: boolean) => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  reachable: typeof navigator === 'undefined' ? true : navigator.onLine,
  // The same value every time changes nothing: nothing re-renders for nothing.
  setReachable: (reachable) => {
    if (get().reachable !== reachable) set({ reachable })
  },
}))
