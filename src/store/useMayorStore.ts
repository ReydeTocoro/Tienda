import { create } from 'zustand'

/** Whether the Caja Mayor is "open" on this device — the eye on its card in Cajas. Closed, its balance and movements are not
 * shown and nothing can be moved into or out of it from there; open, they are. Kept in memory only: opening always asks a PIN
 * (src/features/cash/mayorEye.ts), nothing remembers it, and it closes by itself when the app is reloaded or the person signs
 * out. It is a screen lock for whoever is standing at the till — the server still decides, by permission, what is allowed. */
export const useMayorStore = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
