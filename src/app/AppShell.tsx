import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { ToastHost } from '../shared/components/ToastHost'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'

export function AppShell() {
  return (
    <div className="flex h-full flex-col bg-bg text-txt">
      <Header />
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>
      <BottomNav />
      <ToastHost />
      <ConfirmDialog />
    </div>
  )
}
