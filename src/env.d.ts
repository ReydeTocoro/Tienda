declare global {
  interface ImportMetaEnv {
    /** Supabase project URL (.env). */
    readonly VITE_SUPABASE_URL: string
    /** Supabase publishable key (.env) — public by design; the login + RLS protect the data. */
    readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  }
}

export {}
