import { NavLink, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { NAV_ITEMS, useNavBadges, type NavItem } from './navConfig'
import { usePermission } from '../features/pin/usePermission'

/** Mobile chrome — thumb-friendly bottom tab bar. Hidden at `md:` and up, where `Sidebar`
 * takes over as the desktop nav (see `AppShell`). */
export function BottomNav() {
  const badges = useNavBadges()
  const { requireAdmin } = usePermission()
  const navigate = useNavigate()

  function handleClick(e: MouseEvent, item: NavItem) {
    if (!item.requiresAdmin) return
    e.preventDefault()
    requireAdmin('Acceso restringido', item.gateSubtitle ?? 'Esta sección requiere PIN de administrador').then((ok) => {
      if (ok) navigate(item.to)
    })
  }

  return (
    <nav className="z-50 flex flex-shrink-0 border-t border-br bg-s1 pb-[env(safe-area-inset-bottom,0px)] md:hidden">
      {NAV_ITEMS.map((item) => {
        const { to, label, shortLabel, icon: Icon, end, badgeKey } = item
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
                        badgeKey === 'fiados' || badgeKey === 'payables' ? 'bg-red text-white' : 'bg-orange'
                      }`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                {shortLabel ?? label}
                {isActive && <span className="absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-t-sm bg-lime" />}
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
