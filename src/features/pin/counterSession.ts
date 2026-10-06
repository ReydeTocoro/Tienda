import { ApiError, apiPost, apiPostOnExit } from '../../api/client'
import type { Need } from '../../shared/lib/permissions'
import { usePinStore, type PinVerifyResult } from '../../store/usePinStore'
import { useSessionStore, type Operator } from '../../store/useSessionStore'

/** Who is working on this device, as the server keeps it (server/domain/counter.ts). The PIN is
 * checked there — this app never sees a PIN hash — and the person it belongs to is bound to this
 * device's session, which is what every request and the database's RLS go by. */

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

/** The startup "nobody is signed in here" on its way to the server: a sign-in waits for it (a few
 * seconds at most), so it can't land after the sign-in and undo it. */
let resetting: Promise<void> | null = null

/** Signs in whoever the PIN belongs to (with `need`, only someone who may do it). */
export async function counterSignIn(pin: string, need?: Need): Promise<PinVerifyResult> {
  if (resetting) await Promise.race([resetting, new Promise((r) => setTimeout(r, 5000))])
  try {
    const { operator, mustChangePin } = await apiPost<{ operator: Operator; mustChangePin: boolean }>('/api/counter/sign-in', { pin, need })
    const result: PinVerifyResult = { ok: true, operator }
    usePinStore.getState().noteResult(result)
    useSessionStore.getState().signIn(operator)
    useSessionStore.getState().setMustChangePin(mustChangePin)
    return result
  } catch (err) {
    const result = failure(err)
    usePinStore.getState().noteResult(result)
    return result
  }
}

/** Someone allowed lets one step through on this device without signing in. */
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

/** Whoever was working leaves: this device forgets them (and the secret data they could see) at
 * once, then the server is told. If that fails (offline) it forgets them by itself in minutes. */
export async function counterSignOut(): Promise<void> {
  useSessionStore.getState().signOut()
  await apiPost('/api/counter/sign-out').catch(() => {})
}

/** As the app starts nobody is signed in on this device — the server is told so before any secret
 * data is downloaded (a tab that was closed without signing out may have left someone bound). Retried
 * until it gets through. */
export function resetCounterOnServer(): Promise<void> {
  resetting ??= resetLoop().finally(() => {
    resetting = null
  })
  return resetting
}

async function resetLoop(): Promise<void> {
  for (let wait = 1000; ; wait = Math.min(wait * 2, 30_000)) {
    try {
      await apiPost('/api/counter/sign-out')
      // A sign-in that happened meanwhile already made the server agree.
      useSessionStore.getState().setServerReady(true)
      return
    } catch {
      if (useSessionStore.getState().serverReady) return
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

/** Keeps the signed-in person bound on the server; null when the server no longer has them
 * (expired, deactivated, signed out elsewhere), undefined when it couldn't be reached. */
export async function counterHeartbeat(): Promise<Operator | null | undefined> {
  try {
    return (await apiPost<{ operator: Operator | null }>('/api/counter/heartbeat')).operator
  } catch (err) {
    return err instanceof ApiError && err.status === 401 ? null : undefined
  }
}

/** The page is closing with someone signed in: tell the server right away. */
export function counterSignOutOnExit(): void {
  if (useSessionStore.getState().operator) apiPostOnExit('/api/counter/sign-out')
}
