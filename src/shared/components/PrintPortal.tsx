import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** Renders `children` into a sibling of `#root` (document.body), hidden on screen and shown only
 * when printing (`hidden print:block`) — `#root` itself is hidden for print (src/index.css), so
 * whatever a dialog puts in here is the ONLY thing `window.print()` ever outputs, regardless of
 * which app screen or dialog triggered it. One portal per printable view (a receipt, a report). */
export function PrintPortal({ children }: { children: ReactNode }) {
  return createPortal(<div className="hidden print:block">{children}</div>, document.body)
}
