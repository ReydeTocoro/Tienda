import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { ToastHost } from '../shared/components/ToastHost'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { PinModal } from '../features/pin/PinModal'
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts'
import { useThemeSync } from '../shared/hooks/useThemeSync'
import { useScannerSettingSync } from '../shared/hooks/useScannerSettingSync'

export function AppShell() {
  useKeyboardShortcuts()
  useThemeSync()
  useScannerSettingSync()

  return (
    <div className="flex h-full flex-col bg-bg text-txt">
      <Header />
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>
      <BottomNav />
      <ToastHost />
      <ConfirmDialog />
      <PinModal />
    </div>
  )
}
