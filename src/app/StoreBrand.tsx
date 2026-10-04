import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../db/repositories/settings'
import logo from '../assets/logo-sm.png'

/** The store's logo in the corner of the chrome (mobile Header / desktop DesktopTabs), in place of
 * the written name. The configured name still lives in Configuración — receipts, the Reporte X and
 * the exports print it — so here it only describes the image to screen readers. */
export function StoreBrand() {
  const settings = useLiveQuery(() => getSettings())
  return <img src={logo} alt={settings?.storeName ?? 'Mi Tienda Pro'} width={163} height={112} draggable={false} className="h-9 w-auto select-none md:h-11" />
}
