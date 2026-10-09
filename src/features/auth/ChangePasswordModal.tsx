import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { supabase } from '../../api/supabase'
import { Modal } from '../../shared/components/Modal'
import { MIN_PASSWORD, newPasswordProblem } from '../../shared/lib/account'
import { toast } from '../../store/useToastStore'

/** "Cambiar mi contraseña": whoever is signed in replaces their own password (the one an
 * administrator gave them, say). Supabase Auth checks and keeps it; the session stays open. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-[400px]">
      <ChangePasswordForm onClose={onClose} />
    </Modal>
  )
}

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const problem = newPasswordProblem(password, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    const { error: authError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (authError) {
      setError(
        authError.code === 'same_password'
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
      <p className="mb-4 text-[13px] leading-relaxed text-txt2">Desde ahora entrarás con la nueva. Mínimo {MIN_PASSWORD} caracteres.</p>
      <label htmlFor="new-password" className="mb-1 block field-label">
        Contraseña nueva
      </label>
      <input id="new-password" type="password" autoComplete="new-password" className="input mb-3" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
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
