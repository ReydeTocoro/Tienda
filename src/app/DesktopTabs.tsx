import { NavLink, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { Lock } from 'lucide-react'
import { NAV_ITEMS, gateText, useNavBadges, type NavItem } from './navConfig'
import { HeaderTools } from './HeaderTools'
import { StoreBrand } from './StoreBrand'
import { usePermission } from '../features/pin/usePermission'

/** Desktop chrome — a horizontal tab bar across the very top of the window. The active section
 * is marked by a brand-colored underline sitting on the bar's bottom rule; the others light up
 * on hover. The clock and theme toggle sit in its right corner. Hidden below `md:`, where
 * `BottomNav` is the nav instead (mobile gets the same tools from the slim `Header`). */
export function DesktopTabs() {
  const badges = useNavBadges()
  const { can, signInFor } = usePermission()
  const navigate = useNavigate()

  function handleClick(e: MouseEvent, item: NavItem) {
    if (!item.need || can(item.need)) return
    e.preventDefault()
    const { title, subtitle } = gateText(item)
    signInFor(item.need, title, subtitle).then((ok) => {
      if (ok) navigate(item.to)
    })
  }

  return (
    <nav className="hidden h-13 flex-shrink-0 items-stretch gap-0.5 border-b border-nav-line bg-nav px-2 md:flex">
      <div className="mr-2 flex items-center border-r border-nav-line pl-1 pr-3">
        <StoreBrand />
      </div>
      {NAV_ITEMS.map((item) => {
        const { to, label, icon: Icon, end, badgeKey } = item
        const locked = !!item.need && !can(item.need)
        const count = badgeKey && !locked ? badges[badgeKey] : 0
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={(e) => handleClick(e, item)}
            title={locked ? `${item.title ?? label} (pide PIN)` : (item.title ?? label)}
            className={({ isActive }) =>
              `group relative flex items-center text-[13px] font-semibold transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full focus-visible:outline-yellow ${
                isActive ? 'text-nav-fg after:bg-yellow' : 'text-nav-fg-dim hover:text-nav-fg'
              }`
            }
          >
            <span className="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors group-hover:bg-nav-hover">
              <Icon size={16} className="flex-shrink-0" />
              <span className="hidden group-aria-[current=page]:inline lg:inline">{label}</span>
              {locked && <Lock size={11} className="flex-shrink-0 opacity-70" aria-label="Pide PIN" />}
              {count > 0 && (
                <span
                  className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[16px] text-on-solid ${
                    badgeKey === 'fiados' || badgeKey === 'payables' ? 'bg-red' : 'bg-orange'
                  }`}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </span>
          </NavLink>
        )
      })}
      <div className="ml-auto flex items-center pl-3 pr-2">
        <HeaderTools />
      </div>
    </nav>
  )
}
