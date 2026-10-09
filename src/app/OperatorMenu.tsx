import { useEffect, useRef, useState } from 'react'
import { ChevronDown, KeyRound, Lock, LogOut, UserRound } from 'lucide-react'
import { Avatar } from '../shared/components/Avatar'
import { usePermission } from '../features/pin/usePermission'
import { idleLabel } from '../features/pin/useSessionGuard'
import { ChangePasswordModal } from '../features/auth/ChangePasswordModal'
import { useAccountEmail } from '../features/auth/useAccountEmail'
import { useProfilePhoto } from '../features/auth/useProfilePhoto'
import { useChangeUser } from '../features/auth/useChangeUser'
import { useCaja } from '../features/cash/hooks/useCaja'
import { CierreZModal } from '../features/reports/components/CierreZModal'
import { todayKey } from '../shared/lib/currency'

/** Who is working on this device — the person whose account is signed in — in the nav bar's
 * corner: their name and role, their own password, handing over to someone else ("Cambiar de
 * usuario": sign out, and the next person enters with their own account) and — for whoever may —
 * closing the caja (the end of a cashier's shift doesn't need the Cajas module). */
export function OperatorMenu() {
  const { operator, role, access, can } = usePermission()
  const email = useAccountEmail()
  const photo = useProfilePhoto(operator)
  const changeUser = useChangeUser()
  const { session: openSession } = useCaja()
  const [open, setOpen] = useState(false)
  const [cierreOpen, setCierreOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const name = operator?.name ?? 'Conectando…'
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-txt transition-colors hover:bg-s2'
  const minutes = access.idleSignOutMinutes

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={operator ? `${name} · ${role?.name ?? ''}` : 'Conectando con el servidor…'}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 text-nav-fg transition-colors hover:bg-nav-hover focus-visible:outline-yellow"
      >
        <Avatar
          name={name}
          photo={photo}
          className={`h-7 w-7 text-[11px] font-bold ${operator ? 'bg-yellow text-on-yellow' : 'border border-dashed border-nav-fg-dim text-nav-fg-dim'}`}
          fallback={operator ? undefined : <UserRound size={14} />}
        />
        <span className="hidden min-w-0 text-left leading-tight lg:block">
          <span className="block max-w-[9rem] truncate text-[12px] font-semibold">{name}</span>
          <span className="block max-w-[9rem] truncate text-[10px] text-nav-fg-dim">{role?.name ?? '—'}</span>
        </span>
        <ChevronDown size={14} className="hidden text-nav-fg-dim lg:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-[60] mt-1.5 w-64 rounded-xl border border-br bg-s1 p-1.5 text-txt shadow-lg">
          <div className="mb-1 flex items-center gap-2.5 border-b border-br px-2.5 pb-2 pt-1">
            <Avatar name={name} photo={photo} className="h-10 w-10 bg-yellow text-[13px] font-bold text-on-yellow" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold">{name}</div>
              <div className="text-[11px] text-muted">{role?.name ?? '—'}</div>
              {email && <div className="mt-0.5 truncate text-[11px] text-muted">{email}</div>}
            </div>
          </div>

          {openSession && can('caja.cerrar') && (
            <button
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                setCierreOpen(true)
              }}
            >
              <Lock size={15} className="text-red" />
              Cerrar caja (fin del día)
            </button>
          )}
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false)
              setPasswordOpen(true)
            }}
          >
            <KeyRound size={15} className="text-blue" />
            Cambiar mi contraseña
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false)
              void changeUser()
            }}
          >
            <LogOut size={15} className="text-orange" />
            Cambiar de usuario
          </button>
          {minutes > 0 && <p className="px-2.5 pb-1 pt-1.5 text-[11px] leading-snug text-muted">La sesión se cierra sola tras {idleLabel(minutes)} sin uso.</p>}
        </div>
      )}

      <CierreZModal open={cierreOpen} dayKey={openSession?.dayKey ?? todayKey()} onClose={() => setCierreOpen(false)} onClosed={() => setCierreOpen(false)} />
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  )
}
