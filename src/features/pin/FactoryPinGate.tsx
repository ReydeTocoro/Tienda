import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { apiPost } from '../../api/client'
import { Modal } from '../../shared/components/Modal'
import { getSettings } from '../../db/repositories/settings'
import { newPinProblem } from '../../shared/lib/pin'
import { useSessionStore } from '../../store/useSessionStore'
import { toast } from '../../store/useToastStore'
import { useSecurityVersion } from '../settings/lib/useSecurityInfo'
import { counterSignOut } from './counterSession'

/** The owner just came in with the factory PIN (1234), which anyone can try: before anything else
 * they choose another. The only way out without one is signing out (Escape too). */
export function FactoryPinGate() {
  const must = useSessionStore((s) => s.mustChangePin)
  return (
    <Modal open={must} onClose={() => void counterSignOut()} maxWidthClass="max-w-[400px]">
      <FactoryPinForm />
    </Modal>
  )
}

function FactoryPinForm() {
  const settings = useLiveQuery(() => getSettings())
  const length = settings?.pinLength ?? 4
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const problem = newPinProblem(pin, pinConfirm, length)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await apiPost('/api/counter/owner-pin', { pin, pinLength: length })
      useSecurityVersion.getState().bump()
      useSessionStore.getState().setMustChangePin(false)
      toast('PIN del propietario actualizado', 'green')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field = 'input text-center font-mono text-[18px] tracking-[6px] placeholder:font-sans placeholder:text-[13px] placeholder:tracking-normal'
  return (
    <form onSubmit={submit}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-orange/30 bg-orange/10 text-orange">
          <KeyRound size={18} />
        </div>
        <div className="font-display text-[17px] font-bold leading-tight">Cambia el PIN de fábrica</div>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-txt2">
        Entraste con el PIN 1234, el que trae el sistema: cualquiera lo puede adivinar y entrar como administrador. Elige uno nuevo de {length} dígitos para seguir.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PIN nuevo"
          maxLength={length}
          className={field}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="Nuevo"
          autoFocus
        />
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Repite el PIN"
          maxLength={length}
          className={field}
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
          placeholder="Repetir"
        />
      </div>
      {error && (
        <p role="alert" className="mb-3 text-[12px] font-semibold text-red">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => void counterSignOut()} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Salir
        </button>
        <button type="submit" disabled={busy} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
          {busy ? 'Guardando…' : 'Guardar PIN nuevo'}
        </button>
      </div>
    </form>
  )
}
