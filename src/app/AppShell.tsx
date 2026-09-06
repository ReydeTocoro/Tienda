import { useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { ToastHost } from '../shared/components/ToastHost'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { PinModal } from '../features/pin/PinModal'
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts'
import { getSettings } from '../db/repositories/settings'
import { useScannerStore } from '../store/useScannerStore'

/** Mobile: header on top, single content column, thumb bar (`BottomNav`) at the bottom.
 * Desktop (`lg:` and up): `Sidebar` takes over as the nav chrome instead, sitting beside the
 * content column under the same header — the one breakpoint switch every page inherits for
 * free, so individual pages only need to worry about their own internal layout. */
export function AppShell() {
  useKeyboardShortcuts()

  const settings = useLiveQuery(() => getSettings())
  const setScannerEnabled = useScannerStore((s) => s.setEnabled)
  const scannerHydrated = useRef(false)

  // Applies settings.theme to <body class="light"> — legacy toggleTheme() (index.html L5176-5181).
  useEffect(() => {
    document.body.classList.toggle('light', settings?.theme === 'light')
  }, [settings?.theme])

  // Hydrates useScannerStore.enabled from settings once on load; after that F8/Reporte owns it.
  useEffect(() => {
    if (!scannerHydrated.current && settings) {
      setScannerEnabled(settings.hidScannerEnabled)
      scannerHydrated.current = true
    }
  }, [settings, setScannerEnabled])

  return (
    <div className="flex h-full flex-col bg-bg text-txt">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <ToastHost />
      <ConfirmDialog />
      <PinModal />
    </div>
  )
}
