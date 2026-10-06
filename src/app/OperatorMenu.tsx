import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Lock, LogIn, LogOut, UserRound, Users } from 'lucide-react'
import { initials } from '../shared/lib/text'
import { useSessionStore } from '../store/useSessionStore'
import { toast } from '../store/useToastStore'
import { usePermission } from '../features/pin/usePermission'
import { counterSignOut } from '../features/pin/counterSession'
import { useCaja } from '../features/cash/hooks/useCaja'
import { CierreZModal } from '../features/reports/components/CierreZModal'
import { todayKey } from '../shared/lib/currency'

/** Who is working at this counter, in the nav bar's corner: their name and role, and the way to
 * sign in, hand over to someone else, sign out or — for whoever may — close the caja (the end of
 * a cashier's shift doesn't need the Cajas module). In PIN mode signing out locks the screen. */
export function OperatorMenu() {
  const { operator, role, access, can, signInAny } = usePermission()
  const { session: openSession } = useCaja()
  const [open, setOpen] = useState(false)
  const [cierreOpen, setCierreOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pinMode = access.mode === 'pin'

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

  async function signIn(title: string) {
    setOpen(false)
    if (await signInAny(title, 'Ingresa tu PIN')) toast(`Hola, ${useSessionStore.getState().operator?.name}`, 'lime')
  }

  function signOut() {
    setOpen(false)
    const name = operator?.name
    void counterSignOut()
    toast(pinMode ? 'Pantalla bloqueada' : `${name ?? 'Sesión'}: salió`, 'muted')
  }

  const name = operator?.name ?? 'Mostrador'
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-txt transition-colors hover:bg-s2'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={operator ? `${name} · ${role?.name ?? ''}` : `Mostrador — sin usuario (permisos de ${role?.name ?? '—'})`}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 text-nav-fg transition-colors hover:bg-nav-hover focus-visible:outline-yellow"
      >
        <span
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            operator ? 'bg-yellow text-on-yellow' : 'border border-dashed border-nav-fg-dim text-nav-fg-dim'
          }`}
        >
          {operator ? initials(name) : <UserRound size={14} />}
        </span>
        <span className="hidden min-w-0 text-left leading-tight lg:block">
          <span className="block max-w-[9rem] truncate text-[12px] font-semibold">{name}</span>
          <span className="block max-w-[9rem] truncate text-[10px] text-nav-fg-dim">{role?.name ?? 'Sin permisos'}</span>
        </span>
        <ChevronDown size={14} className="hidden text-nav-fg-dim lg:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-[60] mt-1.5 w-64 rounded-xl border border-br bg-s1 p-1.5 text-txt shadow-lg">
          <div className="mb-1 border-b border-br px-2.5 pb-2 pt-1">
            <div className="truncate text-[13px] font-bold">{name}</div>
            <div className="text-[11px] text-muted">{operator ? role?.name : `Sin usuario · permisos de ${role?.name ?? '—'}`}</div>
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
          {!operator ? (
            <button role="menuitem" className={item} onClick={() => signIn('Ingresar')}>
              <LogIn size={15} className="text-lime" />
              Ingresar con mi PIN
            </button>
          ) : (
            <>
              {!pinMode && (
                <button role="menuitem" className={item} onClick={() => signIn('Cambiar de usuario')}>
                  <Users size={15} className="text-blue" />
                  Cambiar de usuario
                </button>
              )}
              <button role="menuitem" className={item} onClick={signOut}>
                {pinMode ? <Lock size={15} className="text-orange" /> : <LogOut size={15} className="text-orange" />}
                {pinMode ? 'Bloquear (cambiar de usuario)' : 'Salir'}
              </button>
            </>
          )}
          {access.autoLockMinutes > 0 && operator && (
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] leading-snug text-muted">Se sale solo tras {access.autoLockMinutes} min sin uso.</p>
          )}
        </div>
      )}

      <CierreZModal open={cierreOpen} dayKey={openSession?.dayKey ?? todayKey()} onClose={() => setCierreOpen(false)} onClosed={() => setCierreOpen(false)} />
    </div>
  )
}
