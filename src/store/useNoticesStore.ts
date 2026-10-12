import { create } from 'zustand'
import type { Notice } from '../features/notifications/lib/notices'

/** The notices of whoever is working, worked out once by `NotificationCenter` (AppShell) for the bell — which the
 * chrome draws twice, mobile and desktop — and whether the "Pendientes de hoy" sheet is open. Memory only. */
export const useNoticesStore = create<{ notices: Notice[]; sheetOpen: boolean; setNotices: (n: Notice[]) => void; setSheetOpen: (open: boolean) => void }>((set) => ({
  notices: [],
  sheetOpen: false,
  setNotices: (notices) => set({ notices }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
}))
