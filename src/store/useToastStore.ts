import { create } from 'zustand'

export type ToastColor = 'default' | 'lime' | 'red' | 'orange' | 'blue' | 'green' | 'purple' | 'muted'

interface ToastState {
  message: string | null
  color: ToastColor
  token: number
  show: (message: string, color?: ToastColor) => void
  hide: () => void
}

/** Replaces legacy `popToast()` (index.html L2373-2378). */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  color: 'default',
  token: 0,
  show: (message, color = 'default') => set((s) => ({ message, color, token: s.token + 1 })),
  hide: () => set({ message: null }),
}))

export function toast(message: string, color?: ToastColor): void {
  useToastStore.getState().show(message, color)
}
