import { supabase } from '../../api/supabase'
import { clearLocalData, stopSync } from '../../sync'
import { counterSignOut } from '../pin/counterSession'

/** Ends the session on this device and drops its local copy of the store's data, so whoever uses
 * it next starts at the login screen with nothing cached. Whoever was working here is signed out on
 * the server first. */
export async function signOut(): Promise<void> {
  await counterSignOut()
  await stopSync()
  await clearLocalData()
  await supabase.auth.signOut()
}
