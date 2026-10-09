import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { supabase } from '../../api/supabase'
import logo from '../../assets/logo.png'
import { markActive } from './session'

const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Correo o contraseña incorrectos',
  'Email not confirmed': 'Ese correo aún no está confirmado',
}

/** The login screen, shown until someone signs in on this device — each person with their own
 * account: the owner's, or the one an administrator gave them in Configuración → Usuarios. Whoever
 * signs in is who works here, until they sign out ("Cambiar de usuario"). */
export function LoginPage({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgotOpen, setForgotOpen] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (authError) setError(AUTH_ERRORS[authError.message] ?? authError.message)
    // A fresh sign-in starts the inactivity count from now.
    else markActive()
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-[20px] border border-br bg-s1 p-6 shadow-lg">
        <img src={logo} alt="Plastimax F.R." width={350} height={240} draggable={false} className="mx-auto h-28 w-auto select-none" />
        <h1 className="sr-only">Mi Tienda Pro</h1>
        <p className="mt-3 text-center text-[13px] text-txt2">Ingresa con tu correo y tu contraseña.</p>

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

        <button type="button" onClick={() => setForgotOpen((o) => !o)} aria-expanded={forgotOpen} className="mt-3 w-full py-1 text-[12px] text-muted underline-offset-2 hover:text-txt2 hover:underline">
          ¿No tienes cuenta u olvidaste la contraseña?
        </button>
        {forgotOpen && (
          <p className="mt-1 rounded-[10px] bg-s2 px-3 py-2 text-[12px] leading-relaxed text-txt2">
            Pídele al administrador de la tienda: en Configuración → Usuarios te crea la cuenta o te pone una contraseña nueva.
          </p>
        )}
      </form>
    </div>
  )
}
