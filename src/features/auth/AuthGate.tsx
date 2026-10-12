import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../api/supabase'
import { assumeRemembered } from '../pin/counterSession'
import { LoginPage } from './LoginPage'
import { signOut, takeSignOutNotice } from './session'
import { storedSignIn } from './storedSession'

type GateState = { status: 'loading' } | { status: 'signedOut'; notice?: string } | { status: 'signedIn' }

/** How long the app waits for Supabase to say who is signed in, and for the server to say they still work here,
 * before going on with what this device already knows: with a connection that is "up" but leads nowhere — or no
 * connection at all, where Supabase keeps retrying to renew an expired token for up to 30 s — those calls take far
 * too long, and the till must not wait for them. */
const AUTH_WAIT_MS = 4_000
const STAFF_WAIT_MS = 5_000

/** Does the server say this account works at the store? null when it didn't answer (no internet): then we go on. */
async function isStaff(): Promise<boolean | null> {
  const asked = supabase.rpc('is_staff').then(({ data, error }) => (error ? null : (data as boolean | null)))
  return Promise.race([asked, new Promise<null>((resolve) => setTimeout(() => resolve(null), STAFF_WAIT_MS))])
}

/** Nothing of the store loads until someone who works there signs in on this device with their own
 * account: an owner's, or an active user's (Configuración → Usuarios). Who signed in is who works —
 * their role decides what they see — until they sign out ("Cambiar de usuario"). An account that
 * isn't the store's is signed straight back out. Without internet the app still opens, on its local
 * copy of the data, for whoever was signed in on this device — even when their access token expired
 * meanwhile (see ./storedSession): the till must not depend on the internet to start. `onSignedOut`
 * runs when a session ends (so the next person starts at Venta, not on the last one's screen). */
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
      if (!session) {
        // No session can also mean "the access token expired and there is no internet to renew it": the sign-in
        // is still in this browser's storage. Then the person goes on working offline, as who they were.
        const kept = storedSignIn()
        if (!kept) return show({ status: 'signedOut', notice: takeSignOutNotice() })
        if (kept.email) assumeRemembered(kept.email)
        return show({ status: 'signedIn' })
      }
      const staff = await isStaff()
      if (cancelled) return
      if (staff === false) {
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
    // Supabase didn't say anything in time (a connection that hangs): go on with the stored sign-in, if any. If it
    // answers later, that answer is applied. With no network at all there is nothing to wait for.
    const waiting = setTimeout(() => {
      if (status === 'loading') void evaluate(null)
    }, navigator.onLine ? AUTH_WAIT_MS : 0)
    return () => {
      cancelled = true
      clearTimeout(waiting)
      data.subscription.unsubscribe()
    }
  }, [])

  if (state.status === 'loading') return <div className="flex h-full items-center justify-center bg-bg text-[13px] text-muted">Cargando…</div>
  if (state.status === 'signedOut') return <LoginPage notice={state.notice} />
  return <>{children}</>
}
