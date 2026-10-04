import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { updateSettings } from '../db/repositories/settings'
import { toast } from '../store/useToastStore'
import { useThemeStore } from '../store/useThemeStore'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Clock + light/dark toggle. Lives in the corner of the desktop tab strip (`DesktopTabs`) and
 * in the slim mobile header — both are the blue nav bar now, so it uses the `nav-*` colors. Its
 * own component so the 1s clock tick re-renders only this. */
export function HeaderTools() {
  const now = useClock()
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
      <div className="text-right font-mono text-[11px] leading-[1.35] text-nav-fg-dim">
        <div>{now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div>{now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
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
