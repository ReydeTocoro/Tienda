import { supabase } from '../../api/supabase'
import { probeNow } from '../../offline/connection'
import { outboxCounts } from '../../offline/outbox'
import { clearLocalData, setSecurePerms, stopSync } from '../../sync'
import { clearSearchHistory } from '../../shared/lib/searchHistory'
import { useConnectionStore } from '../../store/useConnectionStore'
import { useMayorStore } from '../../store/useMayorStore'
import { useOrderDraftStore } from '../../store/useOrderDraftStore'
import { useSessionStore } from '../../store/useSessionStore'
import { endCounterSession, forgetRemembered, refreshCounterSession } from '../pin/counterSession'
import { disablePush } from '../notifications/push'

let pendingNotice: string | undefined

const NEEDS_INTERNET = 'No se pudo cerrar la sesión: sin internet no se puede cambiar de usuario (quien entre debe verificar su contraseña en línea). Puedes seguir vendiendo'

/** Why the latest sign-out happened (inactivity, lost access…), for the login screen — once. */
export function takeSignOutNotice(): string | undefined {
  const notice = pendingNotice
  pendingNotice = undefined
  return notice
}

/** Ends this person's session on this device ("Cambiar de usuario"): the server forgets who was
 * working here, the secret data they could see goes, and the login shows for whoever comes next.
 * The store's data (and the recent searches of the search boxes) stays on the device — every account
 * sees the same — unless `forget` (a device that stops being used). Only this device: the same
 * person may be signed in on another.
 *
 * It needs the internet (Supabase revokes the session), and that is on purpose: whoever came next could not sign
 * in without it either (each person's password is checked online), so signing out offline would only lock the
 * till. Sales made without internet that haven't been sent yet stay on the device and go up with the next
 * session — but "forget" refuses while there are any, because it would lose them. */
export async function signOut({ forget = false, notice }: { forget?: boolean; notice?: string } = {}): Promise<void> {
  if (forget) {
    const { pending, rejected } = await outboxCounts()
    if (pending + rejected > 0) {
      throw new Error('Hay ventas hechas sin internet que todavía no llegaron al servidor: si borras este equipo se perderían. Conéctate a internet, espera a que se envíen y vuelve a intentarlo')
    }
  }
  // Without the internet nobody could sign in afterwards, so signing out would only lock the till. Said up front instead of
  // trusting what Supabase's client does when its own refresh has been failing for a while (it sometimes signed out anyway).
  if (!(navigator.onLine && useConnectionStore.getState().reachable) && !(await probeNow())) throw new Error(NEEDS_INTERNET)
  // A device that stops being used stops getting the Administrador's phone notifications too.
  if (forget) await disablePush().catch(() => {})
  pendingNotice = notice
  await endCounterSession()
  // A connection that leads nowhere must not leave the button spinning for minutes.
  const { error } = await Promise.race([
    supabase.auth.signOut({ scope: 'local' }),
    new Promise<{ error: Error }>((resolve) => setTimeout(() => resolve({ error: new Error('tiempo agotado') }), 10_000)),
  ])
  if (error) {
    // Still signed in (offline, most likely): carry on as before.
    pendingNotice = undefined
    void refreshCounterSession()
    throw new Error(NEEDS_INTERNET)
  }
  useSessionStore.getState().clear()
  useMayorStore.getState().setOpen(false) // the next person finds the Caja Mayor closed
  useOrderDraftStore.getState().reset() // and no half-made order with purchase prices
  forgetRemembered()
  await stopSync()
  if (forget) {
    clearSearchHistory()
    await clearLocalData()
  } else setSecurePerms([])
}

// The last time someone used this device (per device, a convenience): with the inactivity sign-out
// on, an app reopened after longer than that asks to sign in again.
const LAST_ACTIVITY = 'mtp-last-activity'

export function lastActivity(): number {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY)) || 0
  } catch {
    return 0
  }
}

export function markActive(at = Date.now()): void {
  try {
    localStorage.setItem(LAST_ACTIVITY, String(at))
  } catch {
    // Storage blocked: only the open app keeps the count.
  }
}
