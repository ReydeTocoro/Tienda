import { ApiError, apiPost } from '../../api/client'
import { supabase } from '../../api/supabase'
import type { Need } from '../../shared/lib/permissions'
import { usePinStore, type PinVerifyResult } from '../../store/usePinStore'
import { useSessionStore, type Operator } from '../../store/useSessionStore'

/** Who is working on this device, as the server keeps it (server/domain/counter.ts): the person
 * whose account is signed in, bound to this device's session — which is what every request and the
 * database's RLS go by. A PIN only authorizes one step on someone else's session; it's checked
 * there, and this app never sees a PIN hash. */

function failure(err: unknown): PinVerifyResult {
  if (err instanceof ApiError) {
    return {
      ok: false,
      error: err.message,
      attemptsLeft: typeof err.data.attemptsLeft === 'number' ? err.data.attemptsLeft : undefined,
      lockedUntil: typeof err.data.lockedUntil === 'number' ? err.data.lockedUntil : undefined,
    }
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** Someone allowed lets one step through on this device without taking it over. */
export async function counterApprove(pin: string, need: Need): Promise<PinVerifyResult> {
  try {
    const { approver } = await apiPost<{ approver: Operator }>('/api/counter/approve', { pin, need })
    const result: PinVerifyResult = { ok: true, operator: approver }
    usePinStore.getState().noteResult(result)
    useSessionStore.getState().setLastAuthorizer(approver.name)
    return result
  } catch (err) {
    const result = failure(err)
    usePinStore.getState().noteResult(result)
    return result
  }
}

// Who this account was the last time, so the next start shows the right screens before the server
// answers (what it may actually do is still up to the server). Per device, and only a convenience.
const REMEMBERED = 'mtp-operator'

export function assumeRemembered(email: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBERED) ?? 'null') as { email?: string; operator?: Operator } | null
    if (saved?.operator?.id && saved.email === email.toLowerCase()) useSessionStore.getState().assume(saved.operator)
  } catch {
    // Nothing remembered: the screens wait for the server.
  }
}

export function forgetRemembered(): void {
  try {
    localStorage.removeItem(REMEMBERED)
  } catch {
    // Storage blocked: nothing was remembered either.
  }
}

/** Why this session can't go on (it must sign in again, or the account lost access). */
export interface SessionEnded {
  ended: string
}

/** Binds this device's session to its account's person, or renews it, and says who that is now:
 * null when all is well, `{ ended }` when the session can't go on, undefined when the server
 * couldn't be reached. */
export async function refreshCounterSession(): Promise<SessionEnded | null | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { operator } = await apiPost<{ operator: Operator }>('/api/counter/session')
      useSessionStore.getState().confirm(operator)
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user.email?.toLowerCase()
      try {
        if (email) localStorage.setItem(REMEMBERED, JSON.stringify({ email, operator }))
      } catch {
        // Storage blocked: the next start just waits for the server.
      }
      return null
    } catch (err) {
      if (!(err instanceof ApiError)) return undefined
      // A 401 may only mean the access token expired a moment ago: renew it and ask once more. (Not
      // when the server says this sign-in is from before one account per person: that one must be redone.)
      if (err.status === 401 && !err.data.reauth && attempt === 0) {
        const { error } = await supabase.auth.refreshSession()
        if (!error) continue
        if (error.name === 'AuthRetryableFetchError') return undefined
      }
      return err.status === 401 || err.status === 403 ? { ended: err.message } : undefined
    }
  }
}

/** As the app starts: retried until the server answers (offline, the app shows what it has). */
let starting: Promise<SessionEnded | null> | null = null
export function startCounterSession(): Promise<SessionEnded | null> {
  starting ??= (async () => {
    for (let wait = 1000; ; wait = Math.min(wait * 2, 30_000)) {
      const result = await refreshCounterSession()
      if (result !== undefined) return result
      await new Promise((r) => setTimeout(r, wait))
    }
  })().finally(() => {
    starting = null
  })
  return starting
}

/** The session is ending: the server stops serving it anything secret (best effort — offline, the
 * binding dies with the session anyway). */
export async function endCounterSession(): Promise<void> {
  await apiPost('/api/counter/sign-out').catch(() => {})
}
