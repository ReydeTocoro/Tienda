/** Sign-in accounts — each person enters with their own email and password. Shared by the forms
 * and the server (server/domain/users.ts), so the same rules apply everywhere; the passwords
 * themselves are only ever kept by Supabase Auth. */

export const MIN_PASSWORD = 8
/** Supabase Auth hashes passwords with bcrypt, which only reads the first 72 bytes. */
export const MAX_PASSWORD = 72

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The email as it's stored and compared (trimmed, lowercase), or '' when it isn't one. */
export function cleanEmail(input: unknown): string {
  const email = typeof input === 'string' ? input.trim().toLowerCase() : ''
  return email.length <= 254 && EMAIL.test(email) ? email : ''
}

/** What's wrong with a new password, or null if it can be saved. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`
  if (password.length > MAX_PASSWORD) return `La contraseña puede tener hasta ${MAX_PASSWORD} caracteres`
  if (password !== confirm) return 'Las dos contraseñas no coinciden'
  return null
}
