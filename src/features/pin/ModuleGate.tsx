import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission, type Need } from './usePermission'

interface ModuleGateProps {
  children: ReactNode
  need: Need
  title: string
  subtitle: string
}

/** Route-level guard for every module beyond Venta — covers direct URL navigation, F-key shortcuts
 * and reloads landing straight on a protected route (the nav's own click handler covers taps).
 * When whoever is working can't enter, the PIN of someone who can signs that person in; cancelling
 * goes back to Venta. Losing access while on the page (they signed out, the screen auto-locked, an
 * admin changed their role) goes straight back to Venta without asking — nobody asked to be here. */
export function ModuleGate({ children, need, title, subtitle }: ModuleGateProps) {
  const { can, ready, signInFor } = usePermission()
  const navigate = useNavigate()
  const allowed = can(need)
  const wasAllowed = useRef(false)

  useEffect(() => {
    // Until the settings are read, the roles in effect are only the defaults: don't ask yet.
    if (!ready) return
    if (allowed) {
      wasAllowed.current = true
      return
    }
    if (wasAllowed.current) {
      navigate('/', { replace: true })
      return
    }
    let cancelled = false
    signInFor(need, title, subtitle).then((ok) => {
      if (!cancelled && !ok) navigate('/', { replace: true })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, allowed, need])

  return ready && allowed ? <>{children}</> : null
}
