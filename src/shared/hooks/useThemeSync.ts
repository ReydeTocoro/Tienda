import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../../db/repositories/settings'

/** Applies `settings.theme` to `<body class="light">` — legacy `toggleTheme()`
 * (index.html L5176-5181), which the Fase 0 CSS `.light` variant already expects. */
export function useThemeSync() {
  const settings = useLiveQuery(() => getSettings())

  useEffect(() => {
    document.body.classList.toggle('light', settings?.theme === 'light')
  }, [settings?.theme])
}
