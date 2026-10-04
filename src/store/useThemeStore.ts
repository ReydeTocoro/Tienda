import { create } from 'zustand'

/** Light/dark is a per-device preference, applied INSTANTLY and kept in `localStorage`, so the
 * toggle works offline and without the write API (the old path went through `PUT /api/settings`
 * and the screen only changed after the round-trip — it failed with a 502 when the API was down
 * or not running locally). `settings.theme` is still written best-effort by the toggle so the
 * choice can sync to a brand-new device, but this store is what actually drives `<body class>`. */
export type Theme = 'light' | 'dark'

const KEY = 'mtp-theme'

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

function apply(theme: Theme): void {
  document.body.classList.toggle('dark', theme === 'dark')
}

interface ThemeState {
  theme: Theme
  /** True once this device has its own choice (local pref or a user toggle); until then the
   * synced `settings.theme` may seed it, after which the server no longer overrides the device. */
  pinned: boolean
  setTheme: (theme: Theme) => void
  /** Adopt the server's theme only if the user hasn't picked one on this device yet. */
  hydrateFromSettings: (theme: Theme) => void
}

const initial = readStored()

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial ?? 'light',
  pinned: initial !== null,
  setTheme: (theme) => {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Private mode / storage blocked — the in-memory state below still applies it for this session.
    }
    apply(theme)
    set({ theme, pinned: true })
  },
  hydrateFromSettings: (theme) => {
    if (get().pinned) return
    apply(theme)
    set({ theme, pinned: true })
  },
}))

// Apply the remembered theme as soon as this module loads, before the first paint, to avoid a flash.
apply(useThemeStore.getState().theme)
