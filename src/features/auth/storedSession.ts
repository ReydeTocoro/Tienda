/** The sign-in this browser holds in its storage, read without asking Supabase.
 *
 * Supabase keeps the session of whoever signed in under `sb-<project>-auth-token` and renews its access token (an
 * hour of life) on its own. When the token has expired and the internet is down it cannot renew it, and then it
 * answers "no session" — although the person is still signed in: the refresh token is still in the storage, and
 * is used as soon as the connection is back. Signing out (or an account that was really cut off) removes the
 * entry, so its presence is what tells "no internet" from "signed out". */
export function storedSignIn(): { email?: string } | null {
  try {
    const host = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]
    const raw = localStorage.getItem(`sb-${host}-auth-token`)
    if (!raw) return null
    const stored = JSON.parse(raw) as { refresh_token?: unknown; user?: { email?: unknown } } | null
    if (typeof stored?.refresh_token !== 'string' || !stored.refresh_token) return null
    return typeof stored.user?.email === 'string' ? { email: stored.user.email } : {}
  } catch {
    return null
  }
}
