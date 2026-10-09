import { supabase } from '../../api/supabase'
import { clearLocalData, setSecurePerms, stopSync } from '../../sync'
import { useSessionStore } from '../../store/useSessionStore'
import { endCounterSession, forgetRemembered, refreshCounterSession } from '../pin/counterSession'

let pendingNotice: string | undefined

/** Why the latest sign-out happened (inactivity, lost access…), for the login screen — once. */
export function takeSignOutNotice(): string | undefined {
  const notice = pendingNotice
  pendingNotice = undefined
  return notice
}

/** Ends this person's session on this device ("Cambiar de usuario"): the server forgets who was
 * working here, the secret data they could see goes, and the login shows for whoever comes next.
 * The store's data stays on the device — every account sees the same — unless `forget` (a device
 * that stops being used). Only this device: the same person may be signed in on another. */
export async function signOut({ forget = false, notice }: { forget?: boolean; notice?: string } = {}): Promise<void> {
  pendingNotice = notice
  await endCounterSession()
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    // Still signed in (offline, most likely): carry on as before.
    pendingNotice = undefined
    void refreshCounterSession()
    throw new Error('No se pudo cerrar la sesión: revisa la conexión a internet')
  }
  useSessionStore.getState().clear()
  forgetRemembered()
  await stopSync()
  if (forget) await clearLocalData()
  else setSecurePerms([])
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
