import { NavLink, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { NAV_ITEMS, useNavBadges, type NavItem } from './navConfig'
import { usePermission } from '../features/pin/usePermission'

/** Desktop chrome — a proper left sidebar nav, replacing the thumb-sized bottom bar once
 * there's room for it. Hidden below `md:`, where `BottomNav` takes over instead. */
export function Sidebar() {
  const badges = useNavBadges()
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
    <nav className="hidden w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-br bg-s1 py-4 md:flex">
      <div className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const { to, label, icon: Icon, end, badgeKey } = item
          const count = badgeKey ? badges[badgeKey] : 0
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={(e) => handleClick(e, item)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl border border-transparent px-3.5 py-2.5 text-[13.5px] font-semibold transition-colors ${
                  isActive ? 'border-lime/25 bg-lime/10 text-lime' : 'text-txt2 hover:border-br2 hover:bg-s2 hover:text-txt'
                }`
              }
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {count > 0 && (
                <span
                  className={`min-w-[20px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[18px] text-black ${
                    badgeKey === 'fiados' ? 'bg-red text-white' : 'bg-orange'
                  }`}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </NavLink>
          )
        })}
      </div>
      <div className="mt-auto px-6 pt-4 tracking-widest field-label">Mi Tienda Pro</div>
    </nav>
  )
}
