import fs from 'node:fs'

/** Loads the project's `.env.local` (secrets: SUPABASE_DB_URL — git-ignored) and `.env` (public
 * config shared with Vite: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY). Variables already set
 * in the environment win. Run from the project root (every npm script is). */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) process.loadEnvFile(file)
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Falta ${name} (va en .env.local o .env)`)
  return value
}
