import { HeaderTools } from './HeaderTools'

/** Mobile-only top strip with the clock and theme toggle. On desktop (`md:`+) the same tools sit
 * in the right corner of `DesktopTabs`, so this renders nothing there. */
export function Header() {
  return (
    <header className="z-50 flex flex-shrink-0 items-center justify-end border-b border-br bg-s1 px-4 py-1.5 md:hidden">
      <HeaderTools />
    </header>
  )
}
