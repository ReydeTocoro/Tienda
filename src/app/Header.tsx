import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../db/repositories/settings'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function Header() {
  const settings = useLiveQuery(() => getSettings())
  const now = useClock()

  return (
    <header className="z-50 flex flex-shrink-0 items-center justify-between border-b border-br bg-s1 px-4 py-2.5">
      <div>
        <h1 className="font-display text-[17px] font-black text-lime">🏪 {settings?.storeName ?? 'Mi Tienda Pro'}</h1>
        <div className="mt-px text-[9px] uppercase tracking-widest text-muted">Sistema de caja</div>
      </div>
      <div className="text-right font-mono text-[11px] text-txt2">
        <div>{now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div>{now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
    </header>
  )
}
