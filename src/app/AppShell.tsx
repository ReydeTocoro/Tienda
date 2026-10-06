import { useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { DesktopTabs } from './DesktopTabs'
import { ToastHost } from '../shared/components/ToastHost'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { PinModal } from '../features/pin/PinModal'
import { FactoryPinGate } from '../features/pin/FactoryPinGate'
import { LockScreen } from '../features/pin/LockScreen'
import { useSessionGuard } from '../features/pin/useSessionGuard'
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts'
import { getSettings } from '../db/repositories/settings'
import { useScannerStore } from '../store/useScannerStore'
import { useThemeStore } from '../store/useThemeStore'
import { startSync } from '../sync'
import { warmUpApi } from '../api/client'

/** Mobile: header on top, single content column, thumb bar (`BottomNav`) at the bottom.
 * Desktop (`md:` and up): `DesktopTabs` takes over as the nav chrome instead, a horizontal tab
 * strip above the header — the one breakpoint switch every page inherits for free, so individual
 * pages only need to worry about their own internal layout. */
export function AppShell() {
  useKeyboardShortcuts()
  const { locked } = useSessionGuard()
  const navigate = useNavigate()

  // Whoever signs in next starts at Venta, not on the last person's screen (which they may not be allowed to see).
  useEffect(() => {
    if (locked) navigate('/', { replace: true })
  }, [locked, navigate])

  useEffect(() => {
    startSync()
    warmUpApi()
  }, [])

  const settings = useLiveQuery(() => getSettings())
  const setScannerEnabled = useScannerStore((s) => s.setEnabled)
  const scannerHydrated = useRef(false)

  // The theme is driven by useThemeStore (instant, per-device, offline-safe). This only reflects
  // the store onto <body class="dark">; the store already applies it on load and on every toggle.
  const theme = useThemeStore((s) => s.theme)
  const hydrateThemeFromSettings = useThemeStore((s) => s.hydrateFromSettings)
  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // On a device with no local choice yet, adopt the theme synced from settings (then it's pinned).
  useEffect(() => {
    if (settings?.theme) hydrateThemeFromSettings(settings.theme)
  }, [settings?.theme, hydrateThemeFromSettings])

  // Hydrates useScannerStore.enabled from settings once on load; after that F8/Reporte owns it.
  useEffect(() => {
    if (!scannerHydrated.current && settings) {
      setScannerEnabled(settings.hidScannerEnabled)
      scannerHydrated.current = true
    }
  }, [settings, setScannerEnabled])

  return (
    <div className="flex h-full flex-col bg-bg text-txt">
      {/* PIN mode with nobody signed in: nothing of the store renders until someone does. Sync and
       * the rest of the effects above keep running behind it. */}
      {locked ? (
        <LockScreen />
      ) : (
        <>
          <DesktopTabs />
          <Header />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <Outlet />
          </main>
          <BottomNav />
        </>
      )}
      <ToastHost />
      <ConfirmDialog />
      <PinModal />
      <FactoryPinGate />
    </div>
  )
}
