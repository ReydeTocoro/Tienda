import { create } from 'zustand'

/** How many saves are in flight right now (src/api/client.ts counts them): what the progress bar at the
 * top of the app (`BusyBar`) shows, so a save is never silent — even when the button that started it
 * is gone because its dialog already closed. */
export const useBusyStore = create<{ pending: number; begin: () => void; end: () => void }>((set) => ({
  pending: 0,
  begin: () => set((s) => ({ pending: s.pending + 1 })),
  end: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
}))
