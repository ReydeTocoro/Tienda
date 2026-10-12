import { useEffect, useState } from 'react'
import { Bell, Moon, Sun } from 'lucide-react'
import { urgentCount } from '../features/notifications/lib/notices'
import { useNoticesStore } from '../store/useNoticesStore'
import { updateSettings } from '../db/repositories/settings'
import { toast } from '../store/useToastStore'
import { useThemeStore } from '../store/useThemeStore'
import { ConnectionPill } from './ConnectionPill'
import { OperatorMenu } from './OperatorMenu'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Who is working (`OperatorMenu`), clock and light/dark toggle. Lives in the corner of the
 * desktop tab strip (`DesktopTabs`) and in the slim mobile header — both are the blue nav bar now,
 * so it uses the `nav-*` colors. */
export function HeaderTools() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const dark = theme === 'dark'

  async function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    setTheme(next) // instant and local — no network needed, works offline
    toast(next === 'light' ? 'Modo claro' : 'Modo oscuro', 'default')
    // Best-effort: also remember it on the account so a brand-new device can pick it up. A failure
    // here (API down, offline, or no local server in dev) must NOT undo the visual change.
    try {
      await updateSettings({ theme: next })
    } catch {
      // keep the local choice
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      <ConnectionPill />
      <NoticesBell />
      <OperatorMenu />
      <Clock />
      <button
        onClick={toggleTheme}
        title={dark ? 'Modo claro' : 'Modo oscuro'}
        aria-label="Cambiar tema"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-nav-fg-dim transition-colors hover:bg-nav-hover hover:text-nav-fg focus-visible:outline-yellow"
      >
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </div>
  )
}

/** The bell: opens "Pendientes de hoy"; its count is what asks for action (red/orange notices). */
function NoticesBell() {
  const notices = useNoticesStore((s) => s.notices)
  const count = urgentCount(notices)
  const red = notices.some((n) => n.tone === 'red')
  return (
    <button
      onClick={() => useNoticesStore.getState().setSheetOpen(true)}
      title={count ? `Pendientes: ${count}` : 'Pendientes'}
      aria-label="Notificaciones"
      className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-nav-fg-dim transition-colors hover:bg-nav-hover hover:text-nav-fg focus-visible:outline-yellow"
    >
      <Bell size={17} />
      {count > 0 && (
        <span className={`absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full px-1 text-center text-[10px] font-bold leading-[16px] text-on-solid ${red ? 'bg-red' : 'bg-orange'}`}>{count}</span>
      )}
    </button>
  )
}

/** Its own component so the 1s tick re-renders only the clock. */
function Clock() {
  const now = useClock()
  return (
    <div className="flex-shrink-0 whitespace-nowrap text-right font-mono text-[11px] leading-[1.35] text-nav-fg-dim">
      <div>{now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
      <div>{now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
    </div>
  )
}
