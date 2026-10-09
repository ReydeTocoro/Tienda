import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../api/supabase'
import { assumeRemembered } from '../pin/counterSession'
import { LoginPage } from './LoginPage'
import { signOut, takeSignOutNotice } from './session'

type GateState = { status: 'loading' } | { status: 'signedOut'; notice?: string } | { status: 'signedIn' }

/** Nothing of the store loads until someone who works there signs in on this device with their own
 * account: an owner's, or an active user's (Configuración → Usuarios). Who signed in is who works —
 * their role decides what they see — until they sign out ("Cambiar de usuario"). An account that
 * isn't the store's is signed straight back out. Offline with a saved session, the app still opens
 * on its local copy of the data. `onSignedOut` runs when a session ends (so the next person starts
 * at Venta, not on the last one's screen). */
export function AuthGate({ children, onSignedOut }: { children: ReactNode; onSignedOut?: () => void }) {
  const [state, setState] = useState<GateState>({ status: 'loading' })
  const signedOutRef = useRef(onSignedOut)
  useEffect(() => {
    signedOutRef.current = onSignedOut
  })

  useEffect(() => {
    let cancelled = false
    let status: GateState['status'] = 'loading'

    function show(next: GateState) {
      if (cancelled) return
      if (status === 'signedIn' && next.status === 'signedOut') signedOutRef.current?.()
      status = next.status
      setState(next)
    }

    async function evaluate(session: Session | null) {
      if (!session) return show({ status: 'signedOut', notice: takeSignOutNotice() })
      const { data: isStaff, error } = await supabase.rpc('is_staff')
      if (cancelled) return
      if (!error && isStaff === false) {
        await signOut({ notice: 'Esta cuenta no tiene acceso a la tienda. Pide al administrador que la active.' }).catch(() => {})
        return
      }
      if (session.user.email) assumeRemembered(session.user.email)
      show({ status: 'signedIn' })
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      // Deferred: calling Supabase from inside this callback can deadlock its auth lock.
      setTimeout(() => void evaluate(session), 0)
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  if (state.status === 'loading') return <div className="flex h-full items-center justify-center bg-bg text-[13px] text-muted">Cargando…</div>
  if (state.status === 'signedOut') return <LoginPage notice={state.notice} />
  return <>{children}</>
}
