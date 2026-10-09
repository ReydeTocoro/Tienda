import { HttpError } from './routes/http'

/** The sign-in accounts (Supabase Auth) of the people who work at the store, managed by the API with
 * the project's secret key — never by a browser. A user (public.usuarios) signs in with the account of
 * their `email`; server/domain/users.ts creates it, changes its password or email, and deletes it
 * with the user. Without the key (SUPABASE_SECRET_KEY not configured) `enabled` is false: the app
 * then only records the email, and the account itself is made in the Supabase dashboard. */
export interface Accounts {
  readonly enabled: boolean
  /** Gives the account of `email` this password, creating it (already confirmed, no email sent) if
   * there's none. */
  ensure(email: string, password: string, name: string): Promise<void>
  /** Moves the account to a new email, password unchanged. False when `email` has no account. */
  changeEmail(email: string, next: string): Promise<boolean>
  /** Deletes the account of `email`, if there is one. */
  remove(email: string): Promise<void>
}

const refuse = async (): Promise<never> => {
  throw new HttpError(503, 'Este servidor no puede crear cuentas ni cambiar contraseñas: falta la llave secreta de Supabase (SUPABASE_SECRET_KEY)')
}

export const noAccounts: Accounts = { enabled: false, ensure: refuse, changeEmail: refuse, remove: refuse }

interface AuthUser {
  id: string
  email?: string
}

const PER_PAGE = 200

/** What Supabase Auth answered, in words for whoever is managing users. */
function accountError(status: number, data: Record<string, unknown>): HttpError {
  const code = String(data.error_code ?? data.code ?? '')
  const msg = String(data.msg ?? data.message ?? data.error_description ?? data.error ?? '')
  if (status === 401 || status === 403) return new HttpError(503, 'El servidor no tiene permiso para manejar cuentas: revisa la llave secreta de Supabase (SUPABASE_SECRET_KEY)')
  if (code === 'weak_password' || /^password should/i.test(msg)) return new HttpError(400, 'Supabase rechazó esa contraseña por débil: usa una más larga, con letras y números')
  if (code === 'email_address_invalid' || code === 'validation_failed') return new HttpError(400, 'Supabase no aceptó ese correo: revísalo')
  if (code === 'email_exists' || /already been registered/i.test(msg)) return new HttpError(409, 'Ya hay otra cuenta con ese correo')
  return new HttpError(502, `Supabase no pudo guardar la cuenta${msg ? `: ${msg}` : ''}`)
}

/** Accounts through the Supabase Auth admin API. */
export function supabaseAccounts(supabaseUrl: string, secretKey: string): Accounts {
  // A secret key (sb_secret_…) goes in `apikey` alone; the legacy service_role key is a JWT and also
  // goes as the bearer token.
  const headers: Record<string, string> = { apikey: secretKey, 'Content-Type': 'application/json' }
  if (secretKey.startsWith('eyJ')) headers.Authorization = `Bearer ${secretKey}`

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${supabaseUrl}/auth/v1/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch {
      throw new HttpError(503, 'No se pudo conectar con Supabase para guardar la cuenta: inténtalo de nuevo')
    }
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      // Not JSON: the status says enough.
    }
    if (!res.ok) throw accountError(res.status, data)
    return data as T
  }

  /** There's no lookup by email: the store has a handful of accounts, so this reads the list. */
  async function find(email: string): Promise<AuthUser | null> {
    const wanted = email.toLowerCase()
    for (let page = 1; page <= 50; page++) {
      const { users } = await call<{ users?: AuthUser[] }>('GET', `/users?page=${page}&per_page=${PER_PAGE}`)
      const hit = users?.find((u) => u.email?.toLowerCase() === wanted)
      if (hit) return hit
      if (!users || users.length < PER_PAGE) return null
    }
    return null
  }

  return {
    enabled: true,
    async ensure(email, password, name) {
      const user = await find(email)
      if (user) await call('PUT', `/users/${user.id}`, { password, email_confirm: true })
      else await call('POST', '/users', { email, password, email_confirm: true, user_metadata: { name } })
    },
    async changeEmail(email, next) {
      const user = await find(email)
      if (!user) return false
      await call('PUT', `/users/${user.id}`, { email: next, email_confirm: true })
      return true
    },
    async remove(email) {
      const user = await find(email)
      if (user) await call('DELETE', `/users/${user.id}`)
    },
  }
}
