import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from './usePermission'

interface AdminGateProps {
  children: ReactNode
  title: string
  subtitle: string
}

/** Route-level guard for Inventario/Reporte — covers direct URL navigation and reloads
 * landing straight on a gated route (BottomNav's click-intercept only covers in-app taps).
 * `App.tsx` mounts `AppShell` over Venta directly; this is what actually keeps Inventario/
 * Reporte "behind `usePermission()`" per the plan, regardless of how the user got there. */
export function AdminGate({ children, title, subtitle }: AdminGateProps) {
  const { isAdmin, requireAdmin } = usePermission()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(isAdmin)

  useEffect(() => {
    if (isAdmin) {
      setChecked(true)
      return
    }
    let cancelled = false
    requireAdmin(title, subtitle).then((ok) => {
      if (cancelled) return
      if (ok) setChecked(true)
      else navigate('/', { replace: true })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  if (!checked) return null
  return <>{children}</>
}
