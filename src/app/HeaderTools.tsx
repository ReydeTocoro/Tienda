import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Moon, Sun } from 'lucide-react'
import { getSettings, updateSettings } from '../db/repositories/settings'
import { toast } from '../store/useToastStore'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Clock + light/dark toggle. Lives in the corner of the desktop tab strip (`DesktopTabs`) and
 * in the slim mobile header; its own component so the 1s clock tick re-renders only this. */
export function HeaderTools() {
  const settings = useLiveQuery(() => getSettings())
  const now = useClock()
  const dark = settings?.theme === 'dark'

  async function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    await updateSettings({ theme: next })
    toast(next === 'light' ? 'Modo claro' : 'Modo oscuro', 'default')
  }

  return (
    <div className="flex items-center gap-2.5">
      <div className="text-right font-mono text-[11px] leading-[1.35] text-txt2">
        <div>{now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div>{now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
      <button
        onClick={toggleTheme}
        title={dark ? 'Modo claro' : 'Modo oscuro'}
        aria-label="Cambiar tema"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-txt2 transition-colors hover:bg-s3 hover:text-txt"
      >
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </div>
  )
}
