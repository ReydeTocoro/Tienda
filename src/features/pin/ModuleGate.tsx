import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, LogOut, ShoppingCart } from 'lucide-react'
import { useChangeUser } from '../auth/useChangeUser'
import { usePermission, type Need } from './usePermission'

interface ModuleGateProps {
  children: ReactNode
  need: Need
  /** The module's name, for the "no access" message. */
  title: string
}

/** Route-level guard for every module beyond Venta — covers direct URL navigation, F-key shortcuts
 * and reloads landing straight on a protected route (the nav only lists what the person may open).
 * Whoever can't enter sees why, with the way back to Venta or to hand over to someone who can.
 * Losing access while on the page (an admin changed their role) goes straight back to Venta. */
export function ModuleGate({ children, need, title }: ModuleGateProps) {
  const { can, ready, role } = usePermission()
  const navigate = useNavigate()
  const changeUser = useChangeUser()
  const allowed = can(need)
  const wasAllowed = useRef(false)

  useEffect(() => {
    // Until the settings are read and who is working is known, nothing is decided.
    if (!ready) return
    if (allowed) wasAllowed.current = true
    else if (wasAllowed.current) navigate('/', { replace: true })
  }, [ready, allowed, navigate])

  if (!ready) return null
  if (allowed) return <>{children}</>
  return (
    <div className="flex h-full items-center justify-center p-5">
      <div className="w-full max-w-[420px] rounded-[20px] border border-br bg-s1 p-6 text-center shadow-xs">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-s3 text-txt2">
          <Lock size={22} />
        </div>
        <h1 className="font-display text-[19px] font-bold leading-tight">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-txt2">
          {need === 'admin' ? `${title} es solo para administradores.` : `Tu rol${role ? ` (${role.name})` : ''} no tiene acceso a ${title}.`} Si hace falta, que alguien con permiso ingrese con su cuenta.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="flex min-w-[150px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-lime px-3 py-2.5 text-[13px] font-bold text-on-solid transition hover:brightness-110"
          >
            <ShoppingCart size={15} />
            Volver a Venta
          </button>
          <button
            type="button"
            onClick={() => void changeUser()}
            className="flex min-w-[150px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-br2 px-3 py-2.5 text-[13px] font-semibold text-txt2 transition-colors hover:bg-s2 hover:text-txt"
          >
            <LogOut size={15} />
            Cambiar de usuario
          </button>
        </div>
      </div>
    </div>
  )
}
