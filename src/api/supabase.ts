import { createClient } from '@supabase/supabase-js'

/** The one Supabase client: the login session (kept in this device's storage and refreshed on its
 * own), direct reads of the data and the Realtime feed (src/sync). Writes don't use it — they go
 * through the API (src/api/client.ts), which applies the store's rules on the server. */
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
