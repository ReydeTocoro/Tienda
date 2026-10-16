import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../api/supabase'
import { Modal } from '../../shared/components/Modal'
import { MIN_PASSWORD, newPasswordProblem } from '../../shared/lib/account'
import { toast } from '../../store/useToastStore'

/** "Cambiar mi contraseña": whoever is signed in replaces their own password (the one an
 * administrator gave them, say), after typing the one they have now. Supabase Auth checks and keeps it; the session stays open. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-[400px]">
      <ChangePasswordForm onClose={onClose} />
    </Modal>
  )
}

const NO_INTERNET = 'Sin conexión con el servidor: para cambiar la contraseña hace falta internet'
const WRONG_CURRENT = 'La contraseña actual no es correcta'

/** What's wrong with the password the account has now, or null when it is right. It is checked by signing in with it on a
 * second, throwaway client (nothing stored, nothing refreshed), so the session in use is never touched. */
async function currentPasswordProblem(email: string, password: string): Promise<string | null> {
  const probe = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mtp-password-check' },
  })
  const { error } = await probe.auth.signInWithPassword({ email, password })
  if (!error) return null
  return error.name === 'AuthRetryableFetchError' ? NO_INTERNET : error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message) ? WRONG_CURRENT : error.message
}

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!current) return setError('Escribe tu contraseña actual')
    const problem = newPasswordProblem(password, confirm)
    if (problem) return setError(problem)
    if (password === current) return setError('La contraseña nueva debe ser distinta a la actual')
    setBusy(true)
    const email = (await supabase.auth.getSession()).data.session?.user.email
    const wrong = email ? await currentPasswordProblem(email, current) : 'No pude saber con qué cuenta estás: cierra la sesión (Cambiar de usuario) y vuelve a entrar'
    if (wrong) {
      setBusy(false)
      return setError(wrong)
    }
    // Supabase checks `current_password` itself too when its "require current password" option is on.
    const { error: authError } = await supabase.auth.updateUser({ password, current_password: current })
    setBusy(false)
    if (authError) {
      setError(
        authError.name === 'AuthRetryableFetchError'
          ? NO_INTERNET
          : authError.code === 'current_password_mismatch'
            ? WRONG_CURRENT
            : authError.code === 'same_password'
              ? 'Esa ya es tu contraseña: escribe una distinta'
              : authError.code === 'weak_password'
                ? 'Supabase la rechazó por débil: usa una más larga, con letras y números'
                : authError.code === 'reauthentication_needed'
                  ? 'Por seguridad, cierra la sesión (Cambiar de usuario), vuelve a entrar con tu contraseña actual y cámbiala enseguida'
                  : authError.message,
      )
      return
    }
    toast('Contraseña cambiada', 'green')
    onClose()
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-lime/30 bg-lime/10 text-lime">
          <KeyRound size={18} />
        </div>
        <div className="font-display text-[17px] font-bold leading-tight">Cambiar mi contraseña</div>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-txt2">Escribe la que usas ahora y luego la nueva: desde ahora entrarás con ella. Mínimo {MIN_PASSWORD} caracteres.</p>
      <label htmlFor="current-password" className="mb-1 block field-label">
        Contraseña actual
      </label>
      <input id="current-password" type="password" autoComplete="current-password" className="input mb-3" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      <label htmlFor="new-password" className="mb-1 block field-label">
        Contraseña nueva
      </label>
      <input id="new-password" type="password" autoComplete="new-password" className="input mb-3" value={password} onChange={(e) => setPassword(e.target.value)} />
      <label htmlFor="new-password2" className="mb-1 block field-label">
        Repítela
      </label>
      <input id="new-password2" type="password" autoComplete="new-password" className="input mb-3" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && (
        <p role="alert" className="mb-3 text-[12px] font-semibold text-red">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button type="submit" disabled={busy} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
          {busy ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  )
}
