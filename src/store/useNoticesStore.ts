import { create } from 'zustand'
import type { Notice } from '../features/notifications/lib/notices'

/** The notices hidden on this device ("Ya pagué"), by their `dismissKey` — a convenience, like the search history. */
const DISMISSED_KEY = 'mtp-dismissed-notices'

function readDismissed(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

interface NoticesState {
  notices: Notice[]
  sheetOpen: boolean
  dismissed: string[]
  setNotices: (n: Notice[]) => void
  setSheetOpen: (open: boolean) => void
  dismiss: (key: string) => void
}

/** The notices of whoever is working, worked out once by `NotificationCenter` (AppShell) for the bell — which the
 * chrome draws twice, mobile and desktop — whether the "Pendientes de hoy" sheet is open, and what was hidden here. */
export const useNoticesStore = create<NoticesState>((set, get) => ({
  notices: [],
  sheetOpen: false,
  dismissed: readDismissed(),
  setNotices: (notices) => set({ notices }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  dismiss: (key) => {
    // Only the latest few matter (one per month): the list never grows.
    const dismissed = [key, ...get().dismissed.filter((k) => k !== key)].slice(0, 12)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed))
    } catch {
      // Storage blocked: hidden until the app is reloaded.
    }
    set({ dismissed })
  },
}))
