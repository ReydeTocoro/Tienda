import { supabase } from '../../api/supabase'
import { clearLocalData, stopSync } from '../../sync'

/** Ends the session on this device and drops its local copy of the store's data, so whoever uses
 * it next starts at the login screen with nothing cached. */
export async function signOut(): Promise<void> {
  await stopSync()
  await clearLocalData()
  await supabase.auth.signOut()
}
