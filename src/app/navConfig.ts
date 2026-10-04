import { useLiveQuery } from 'dexie-react-hooks'
import { ShoppingCart, Package, Users, ClipboardList, Receipt, BarChart3, Settings, Wallet, Truck, Route } from 'lucide-react'
import type { ComponentType } from 'react'
import { db } from '../db/index'
import { groupFiados, groupTotals } from '../features/fiados/lib/fiadoGrouping'
import { payableBalance } from '../shared/lib/cash'
import { todayKey } from '../shared/lib/currency'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  end?: boolean
  /** Label for the cramped mobile bottom bar, when the full one doesn't fit. */
  shortLabel?: string
  badgeKey?: 'lowStock' | 'fiados' | 'payables' | 'routeOrders'
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
  { to: '/rutas', label: 'Rutas', icon: Route, badgeKey: 'routeOrders' },
  { to: '/fiados', label: 'Fiados', icon: ClipboardList, badgeKey: 'fiados' },
  { to: '/facturas', label: 'Facturas', icon: Receipt },
  { to: '/cajas', label: 'Cajas', icon: Wallet, requiresAdmin: true, gateSubtitle: 'Las cajas requieren PIN de administrador' },
  { to: '/proveedores', label: 'Proveedores', shortLabel: 'Proveed.', icon: Truck, badgeKey: 'payables', requiresAdmin: true, gateSubtitle: 'Proveedores y compras requieren PIN de administrador' },
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
  // Supplier debts already past their due date.
  const overdueCount = useLiveQuery(
    async () => {
      const today = todayKey()
      return (await db.payables.toArray()).filter((p) => payableBalance(p) > 0 && p.dueDate < today).length
    },
    [],
    0,
  )
  // Pedidos still waiting to go out (taken or packed, not yet delivered/cancelled).
  const routeOrdersCount = useLiveQuery(() => db.routeOrders.where('status').anyOf('tomado', 'preparado').count(), [], 0)
  return { lowStock: lowStockCount, fiados: fiadoCount, payables: overdueCount, routeOrders: routeOrdersCount }
}
