import { NavLink, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { NAV_ITEMS, useNavBadges, type NavItem } from './navConfig'
import { usePermission } from '../features/pin/usePermission'

/** Desktop chrome — a horizontal tab strip across the very top of the window, like switching
 * between open browser tabs: the active tab's background matches the page below it (so it
 * reads as "merged" into the content) while inactive tabs sit recessed in the strip. Hidden
 * below `md:`, where `BottomNav` is the nav instead (mobile is untouched by this). */
export function DesktopTabs() {
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
    <nav className="hidden flex-shrink-0 items-end gap-1 bg-s2 px-2 pt-2 md:flex">
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
              `group relative flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-[13px] font-semibold transition-colors ${
                isActive ? 'border-br bg-bg text-lime' : 'border-transparent text-txt2 hover:bg-s3 hover:text-txt'
              }`
            }
          >
            <Icon size={16} className="flex-shrink-0" />
            <span>{label}</span>
            {count > 0 && (
              <span
                className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[16px] text-black ${
                  badgeKey === 'fiados' ? 'bg-red text-white' : 'bg-orange'
                }`}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
