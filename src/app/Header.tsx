import { HeaderTools } from './HeaderTools'
import { StoreBrand } from './StoreBrand'

/** Mobile-only top strip with the store logo, clock and theme toggle. On desktop (`md:`+) the
 * same tools sit in the corners of `DesktopTabs`, so this renders nothing there. */
export function Header() {
  return (
    <header className="z-50 flex flex-shrink-0 items-center justify-between border-b border-nav-line bg-nav px-4 py-1 md:hidden">
      <StoreBrand />
      <HeaderTools />
    </header>
  )
}
