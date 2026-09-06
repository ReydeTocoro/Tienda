import { NavLink, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ShoppingCart, Package, Users, ClipboardList, Archive, BarChart3 } from 'lucide-react'
import type { ComponentType, MouseEvent } from 'react'
import { db } from '../db/index'
import { groupFiados, groupTotals } from '../features/fiados/lib/fiadoGrouping'
import { usePermission } from '../features/pin/usePermission'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  end?: boolean
  badgeKey?: 'lowStock' | 'fiados'
  requiresAdmin?: boolean
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Venta', icon: ShoppingCart, end: true },
  { to: '/inventario', label: 'Stock', icon: Package, badgeKey: 'lowStock', requiresAdmin: true },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/fiados', label: 'Fiados', icon: ClipboardList, badgeKey: 'fiados' },
  { to: '/historial', label: 'Historial', icon: Archive },
  { to: '/reporte', label: 'Reporte', icon: BarChart3, requiresAdmin: true },
]

/** No role-picker screen (decision 3): every route is reachable directly, but Inventario/
 * Reporte prompt for the admin PIN the first time in a session — legacy
 * `navInventario`/`navReporte` (index.html L1953-1971). */
export function BottomNav() {
  const lowStockCount = useLiveQuery(() => db.products.filter((p) => p.stock > 0 && p.min > 0 && p.stock <= p.min).count(), [], 0)
  const fiadoCount = useLiveQuery(
    () => db.sales.toArray().then((sales) => groupFiados(sales).filter((g) => groupTotals(g).totalDebt > 0).length),
    [],
    0,
  )
  const badges = { lowStock: lowStockCount, fiados: fiadoCount }
  const { requireAdmin } = usePermission()
  const navigate = useNavigate()

  function handleClick(e: MouseEvent, item: NavItem) {
    if (!item.requiresAdmin) return
    e.preventDefault()
    requireAdmin('🔒 Acceso restringido', item.to === '/inventario' ? 'Esta sección requiere PIN de administrador' : 'Los reportes requieren PIN de administrador').then((ok) => {
      if (ok) navigate(item.to)
    })
  }

  return (
    <nav className="z-50 flex flex-shrink-0 border-t border-br bg-s1 pb-[env(safe-area-inset-bottom,0px)]">
      {ITEMS.map((item) => {
        const { to, label, icon: Icon, end, badgeKey } = item
        const count = badgeKey ? badges[badgeKey] : 0
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={(e) => handleClick(e, item)}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center gap-0.5 py-2.5 pb-1.5 text-[9.5px] transition-colors ${
                isActive ? 'text-lime' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon size={19} />
                  {count > 0 && (
                    <span
                      className={`absolute -right-2 -top-1.5 min-w-[15px] rounded-full px-1 text-center text-[9px] font-bold leading-[14px] text-black ${
                        badgeKey === 'fiados' ? 'bg-red text-white' : 'bg-orange'
                      }`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                {label}
                {isActive && <span className="absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-t-sm bg-lime" />}
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
