import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../api/supabase'
import { LoginPage } from './LoginPage'
import { signOut } from './session'

type GateState = { status: 'loading' } | { status: 'signedOut'; notice?: string } | { status: 'signedIn' }

/** Nothing of the store loads until someone on the staff list has signed in on this device. The
 * session persists, so that happens once per device. An account that signs in but isn't on the
 * list is signed straight back out. Offline with a saved session, the app still opens on its
 * local copy of the data. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function evaluate(session: Session | null) {
      if (!session) {
        if (!cancelled) setState((s) => (s.status === 'signedOut' ? s : { status: 'signedOut' }))
        return
      }
      const { data: isStaff, error } = await supabase.rpc('is_staff')
      if (cancelled) return
      if (!error && isStaff === false) {
        await signOut()
        if (!cancelled) setState({ status: 'signedOut', notice: 'Esta cuenta no tiene acceso a la tienda. Pide al dueño que la autorice.' })
        return
      }
      setState({ status: 'signedIn' })
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
