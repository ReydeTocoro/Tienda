import { NavLink, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { NAV_ITEMS, useNavBadges, type NavItem } from './navConfig'
import { usePermission } from '../features/pin/usePermission'

/** Mobile chrome — thumb-friendly bottom tab bar; the active section's icon sits in a tinted
 * pill. Hidden at `md:` and up, where `DesktopTabs` takes over as the nav (see `AppShell`). */
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
    <nav className="z-50 flex flex-shrink-0 border-t border-nav-line bg-nav pb-[env(safe-area-inset-bottom,0px)] md:hidden">
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
              `relative flex flex-1 flex-col items-center gap-0.5 pt-0.5 pb-1.5 text-[9.5px] transition-colors focus-visible:outline-yellow ${
                isActive ? 'font-semibold text-nav-fg' : 'text-nav-fg-dim'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`relative rounded-full px-2.5 py-1 transition-colors ${isActive ? 'bg-white/15' : ''}`}>
                  <Icon size={19} />
                  {count > 0 && (
                    <span
                      className={`absolute right-0.5 -top-0.5 min-w-[15px] rounded-full px-1 text-center text-[9px] font-bold leading-[14px] text-on-solid ${
                        badgeKey === 'fiados' || badgeKey === 'payables' ? 'bg-red' : 'bg-orange'
                      }`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                {shortLabel ?? label}
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
