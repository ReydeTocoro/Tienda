import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../db/repositories/settings'

/** Store name — read-only branding in the corner of the chrome (mobile Header / desktop
 * DesktopTabs). Editing lives in Configuración so it isn't duplicated across both headers. */
export function StoreBrand() {
  const settings = useLiveQuery(() => getSettings())
  return <span className="truncate font-display text-[15px] font-black text-lime">{settings?.storeName ?? 'Mi Tienda Pro'}</span>
}
