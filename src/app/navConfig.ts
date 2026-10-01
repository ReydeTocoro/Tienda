import { useLiveQuery } from 'dexie-react-hooks'
import { ShoppingCart, Package, Users, ClipboardList, Archive, BarChart3, Settings } from 'lucide-react'
import type { ComponentType } from 'react'
import { db } from '../db/index'
import { groupFiados, groupTotals } from '../features/fiados/lib/fiadoGrouping'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  end?: boolean
  badgeKey?: 'lowStock' | 'fiados'
  requiresAdmin?: boolean
  /** Subtitle shown on the admin-PIN prompt when this route is gated. */
  gateSubtitle?: string
}

/** Shared between `BottomNav` (mobile) and `Sidebar` (desktop) so both chromes stay in sync.
 * No role-picker screen (decision 3): every route is reachable directly, but Inventario/
 * Reporte/Configuración prompt for the admin PIN the first time in a session — legacy
 * `navInventario`/`navReporte` (index.html L1953-1971). */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Venta', icon: ShoppingCart, end: true },
  { to: '/inventario', label: 'Stock', icon: Package, badgeKey: 'lowStock', requiresAdmin: true, gateSubtitle: 'Esta sección requiere PIN de administrador' },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/fiados', label: 'Fiados', icon: ClipboardList, badgeKey: 'fiados' },
  { to: '/historial', label: 'Historial', icon: Archive },
  { to: '/reporte', label: 'Reporte', icon: BarChart3, requiresAdmin: true, gateSubtitle: 'Los reportes requieren PIN de administrador' },
  { to: '/configuracion', label: 'Config.', icon: Settings, requiresAdmin: true, gateSubtitle: 'La configuración requiere PIN de administrador' },
]

/** Live low-stock / pending-fiado counts used for nav badges in both chromes. */
export function useNavBadges() {
  const lowStockCount = useLiveQuery(() => db.products.filter((p) => p.stock > 0 && p.min > 0 && p.stock <= p.min).count(), [], 0)
  const fiadoCount = useLiveQuery(
    () => db.sales.toArray().then((sales) => groupFiados(sales).filter((g) => groupTotals(g).totalDebt > 0).length),
    [],
    0,
  )
  return { lowStock: lowStockCount, fiados: fiadoCount }
}
