import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../../api/supabase'
import { BottomSheet } from '../../shared/components/BottomSheet'
import { apiPost } from '../../api/client'
import { getSettings } from '../../db/repositories/settings'
import { newPinProblem } from '../../shared/lib/pin'
import { usePinStore } from '../../store/usePinStore'
import { toast } from '../../store/useToastStore'

interface OwnerPinRecoveryProps {
  open: boolean
  onClose: () => void
}

/** "Forgot the owner's PIN": whoever knows the password of the store account signed in on this
 * device (the strongest credential there is) can set a new master PIN — the way back in when the
 * PIN-mode lock screen would otherwise keep the owner out. The password is checked by Supabase
 * (a fresh sign-in), and the server only accepts the new PIN from a session that typed it in the
 * last few minutes. It also lifts every PIN lockout. */
export function OwnerPinRecovery({ open, onClose }: OwnerPinRecoveryProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[420px]">
      <RecoveryForm onClose={onClose} />
    </BottomSheet>
  )
}

function RecoveryForm({ onClose }: { onClose: () => void }) {
  const settings = useLiveQuery(() => getSettings())
  const [email, setEmail] = useState<string>()
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pinLength = settings?.pinLength ?? 4

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const problem = newPinProblem(pin, pinConfirm, pinLength)
    if (problem) return setError(problem)
    if (!email) return setError('No hay una cuenta abierta en este dispositivo')
    setBusy(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) return setError(authError.message === 'Invalid login credentials' ? 'Contraseña incorrecta' : authError.message)
      await apiPost('/api/counter/recover-owner-pin', { pin })
      usePinStore.getState().noteResult({ ok: true })
      toast('PIN del propietario restablecido', 'green')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-lime/25 bg-lime/10 text-lime">
          <KeyRound size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">Restablecer el PIN del propietario</div>
          <div className="text-[11px] text-muted">Confirma la contraseña de la cuenta de la tienda</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>

      <label className="mb-1 block field-label">Cuenta abierta en este dispositivo</label>
      <div className="mb-3 truncate rounded-[10px] border border-br bg-s2 px-3 py-2.5 text-[13px] text-txt2">{email ?? '…'}</div>

      <label htmlFor="recovery-password" className="mb-1 block field-label">
        Contraseña de esa cuenta
      </label>
      <input id="recovery-password" type="password" autoComplete="current-password" className="input mb-3" value={password} onChange={(e) => setPassword(e.target.value)} required />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="recovery-pin" className="mb-1 block field-label">
            PIN nuevo ({pinLength} dígitos)
          </label>
          <input
            id="recovery-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={pinLength}
            className="input text-center font-mono tracking-[5px]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div>
          <label htmlFor="recovery-pin2" className="mb-1 block field-label">
            Repite el PIN
          </label>
          <input
            id="recovery-pin2"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={pinLength}
            className="input text-center font-mono tracking-[5px]"
            value={pinConfirm}
            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>

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
          {busy ? 'Verificando…' : 'Guardar PIN nuevo'}
        </button>
      </div>
    </form>
  )
}
