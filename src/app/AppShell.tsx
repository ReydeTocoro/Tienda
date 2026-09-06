import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { ToastHost } from '../shared/components/ToastHost'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { PinModal } from '../features/pin/PinModal'
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts'
import { useThemeSync } from '../shared/hooks/useThemeSync'
import { useScannerSettingSync } from '../shared/hooks/useScannerSettingSync'

/** Mobile: header on top, single content column, thumb bar (`BottomNav`) at the bottom.
 * Desktop (`lg:` and up): `Sidebar` takes over as the nav chrome instead, sitting beside the
 * content column under the same header — the one breakpoint switch every page inherits for
 * free, so individual pages only need to worry about their own internal layout. */
export function AppShell() {
  useKeyboardShortcuts()
  useThemeSync()
  useScannerSettingSync()

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
