import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { supabase } from '../../api/supabase'

const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Correo o contraseña incorrectos',
  'Email not confirmed': 'Ese correo aún no está confirmado',
}

/** The login screen, shown until someone signs in on this device. Accounts are created by the
 * owner in Supabase (Authentication → Users) and must also be on the `staff` list. */
export function LoginPage({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (authError) setError(AUTH_ERRORS[authError.message] ?? authError.message)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-[20px] border border-br bg-s1 p-6 shadow-lg">
        <h1 className="font-display text-[22px] font-black text-lime">Mi Tienda Pro</h1>
        <p className="mt-1 text-[13px] text-txt2">Inicia sesión para abrir la tienda en este dispositivo.</p>

        {notice && <p className="mt-4 rounded-[10px] border border-orange/30 bg-orange/10 px-3 py-2 text-[12px] font-semibold text-orange">{notice}</p>}

        <label htmlFor="login-email" className="mt-5 mb-1.5 block field-label">
          Correo
        </label>
        <input id="login-email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="login-password" className="mt-3.5 mb-1.5 block field-label">
          Contraseña
        </label>
        <input id="login-password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />

        {error && (
          <p role="alert" className="mt-3 text-[12px] font-semibold text-red">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-[10px] bg-lime py-3 text-[14px] font-bold text-on-solid transition hover:brightness-110 disabled:opacity-60"
        >
          <LogIn size={17} />
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
