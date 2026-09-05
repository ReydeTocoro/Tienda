import { create } from 'zustand'

interface ScannerState {
  /** Whether the HID (USB keyboard-wedge) scanner listener is active. Toggled via F8 (Fase 6)
   *  or the settings panel; mirrors `settings.hidScannerEnabled` once Fase 6 wires persistence. */
  enabled: boolean
  lastCode: string | null
  setEnabled: (v: boolean) => void
  toggle: () => void
  setLastCode: (code: string) => void
}

export const useScannerStore = create<ScannerState>((set) => ({
  enabled: true,
  lastCode: null,
  setEnabled: (v) => set({ enabled: v }),
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  setLastCode: (code) => set({ lastCode: code }),
}))
