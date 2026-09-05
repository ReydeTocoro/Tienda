import { NavLink } from 'react-router-dom'
import { ShoppingCart, Package, Users, ClipboardList, Archive, BarChart3 } from 'lucide-react'
import type { ComponentType } from 'react'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  end?: boolean
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Venta', icon: ShoppingCart, end: true },
  { to: '/inventario', label: 'Stock', icon: Package },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/fiados', label: 'Fiados', icon: ClipboardList },
  { to: '/historial', label: 'Historial', icon: Archive },
  { to: '/reporte', label: 'Reporte', icon: BarChart3 },
]

export function BottomNav() {
  return (
    <nav className="z-50 flex flex-shrink-0 border-t border-br bg-s1 pb-[env(safe-area-inset-bottom,0px)]">
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex flex-1 flex-col items-center gap-0.5 py-2.5 pb-1.5 text-[9.5px] transition-colors ${
              isActive ? 'text-lime' : 'text-muted'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={19} />
              {label}
              {isActive && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-t-sm bg-lime" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
