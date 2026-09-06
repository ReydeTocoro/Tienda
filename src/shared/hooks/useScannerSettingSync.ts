import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../../db/repositories/settings'
import { useScannerStore } from '../../store/useScannerStore'

/** Hydrates `useScannerStore.enabled` from the persisted `settings.hidScannerEnabled` once on
 * load — after that, toggling (F8 or the Reporte settings panel) owns the in-session value. */
export function useScannerSettingSync() {
  const settings = useLiveQuery(() => getSettings())
  const setEnabled = useScannerStore((s) => s.setEnabled)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!hydrated.current && settings) {
      setEnabled(settings.hidScannerEnabled)
      hydrated.current = true
    }
  }, [settings, setEnabled])
}
