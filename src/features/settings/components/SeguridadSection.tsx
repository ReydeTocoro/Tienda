import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { KeyRound } from 'lucide-react'
import { db } from '../../../db/index'
import { getSettings, updateSettings } from '../../../db/repositories/settings'
import { formatDateTime } from '../../../shared/lib/currency'
import { IDLE_SIGN_OUT_CHOICES } from '../../../shared/lib/permissions'
import { newPinProblem } from '../../../shared/lib/pin'
import { apiPost } from '../../../api/client'
import type { Usuario } from '../../../types/usuario'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import { PIN_MAX_ATTEMPTS } from '../../pin/usePinGate'
import { idleLabel } from '../../pin/useSessionGuard'
import { useAccessConfig } from '../../pin/usePermission'
import { useSecurityVersion, type SecurityInfo } from '../lib/useSecurityInfo'
import { Card, Row, SectionHeader, Segmented, primaryButton } from './ui'

/** When a session closes by itself, and the owner's master PIN. Every change applies at once on
 * every device. */
export function SeguridadSection({ security }: { security: SecurityInfo | null }) {
  const settings = useLiveQuery(() => getSettings())
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const { access } = useAccessConfig()

  async function saveIdle(idleSignOutMinutes: number) {
    try {
      await updateSettings({ access: { ...access, idleSignOutMinutes } })
      toast(idleSignOutMinutes ? `La sesión se cerrará tras ${idleLabel(idleSignOutMinutes)} sin uso` : 'La sesión ya no se cierra sola', 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }

  return (
    <>
      <SectionHeader title="Seguridad" description="Cuándo se cierra sola una sesión y el PIN maestro del propietario." />

      <Card title="Sesiones" description="Cada persona entra con su correo y su contraseña. Para que entre otra, quien usa el equipo elige “Cambiar de usuario” en el menú de su nombre (arriba a la derecha).">
        <Row
          label="Cerrar la sesión por inactividad"
          hint="Tras ese tiempo sin tocar la pantalla, la sesión se cierra y se vuelve a pedir el correo y la contraseña. Útil si el equipo se queda solo en el mostrador."
          htmlFor="idle-sign-out"
        >
          <select id="idle-sign-out" className="input w-full py-2 sm:w-56" value={access.idleSignOutMinutes} onChange={(e) => saveIdle(Number(e.target.value))}>
            {IDLE_SIGN_OUT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Nunca' : idleLabel(m)}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      {settings && <OwnerPinCard pinLength={settings.pinLength} pinChangedAt={settings.pinChangedAt} usuarios={usuarios} security={security} />}
    </>
  )
}

/** The owner's master PIN — authorizes, as the Administrador, any step on someone else's session.
 * Its length is every PIN's length. */
function OwnerPinCard({ pinLength, pinChangedAt, usuarios, security }: { pinLength: 4 | 6; pinChangedAt?: string; usuarios: Usuario[]; security: SecurityInfo | null }) {
  const storeLockedUntil = security?.lockedUntil ?? null
  const [length, setLength] = useState<4 | 6>(pinLength)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  // Users whose PIN has the other length can't authorize with it once the length changes.
  const stranded = length !== pinLength ? usuarios.filter((u) => u.active && u.pinLength !== undefined && u.pinLength !== length) : []

  async function save() {
    setError('')
    const problem = newPinProblem(pin, pinConfirm, length)
    if (problem) return setError(problem)
    if (stranded.length) {
      const ok = await confirm({
        title: `PIN de ${length} dígitos`,
        message: `${stranded.map((u) => u.name).join(', ')} tienen PIN de ${pinLength} dígitos y no podrán autorizar hasta que les des uno de ${length} en Usuarios.`,
        confirmLabel: 'Cambiar de todas formas',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      // Checked and hashed by the server (it also refuses a PIN that someone else has).
      await apiPost('/api/counter/owner-pin', { pin, pinLength: length })
      useSecurityVersion.getState().bump()
      setPin('')
      setPinConfirm('')
      toast('PIN maestro actualizado', 'green')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="PIN maestro del propietario"
      description={`Con él autorizas descuentos, fiados y otros pasos en el equipo de otra persona, sin cerrar su sesión. ${pinChangedAt ? `Último cambio: ${formatDateTime(pinChangedAt)}.` : 'Nunca se ha cambiado.'}`}
      footer={
        <button type="button" className={`${primaryButton} flex items-center gap-1.5`} disabled={busy} onClick={save}>
          <KeyRound size={15} />
          {busy ? 'Guardando…' : 'Guardar PIN'}
        </button>
      }
    >
      {storeLockedUntil && (
        <div className="flex items-center gap-2 bg-red/10 px-4 py-2.5 text-[12px] font-semibold text-red md:px-5">
          Las autorizaciones con PIN están bloqueadas en toda la tienda por demasiados PIN equivocados
          <span className="ml-auto font-mono text-[13px] font-extrabold">hasta las {new Date(storeLockedUntil).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
      {!storeLockedUntil && !!security?.wrongPins24h && (
        <div className="bg-orange/10 px-4 py-2.5 text-[12px] font-semibold text-orange md:px-5">
          {security.wrongPins24h} PIN equivocado{security.wrongPins24h !== 1 ? 's' : ''} en las últimas 24 horas en la tienda.
        </div>
      )}
      <Row label="Largo de los PIN" hint="Vale para todos: el PIN maestro y el de cada usuario.">
        <Segmented
          label="Largo de los PIN"
          value={length}
          onChange={(v) => {
            setLength(v)
            setPin('')
            setPinConfirm('')
          }}
          options={[
            { value: 4, label: '4 dígitos' },
            { value: 6, label: '6 dígitos' },
          ]}
        />
      </Row>
      <Row label="PIN nuevo" hint={`${length} números. Evita los obvios (1234, 0000, tu año de nacimiento).`} htmlFor="owner-pin">
        <div className="grid w-full grid-cols-2 gap-2 sm:w-72">
          <input
            id="owner-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={length}
            aria-label="PIN nuevo"
            className="input text-center font-mono tracking-[5px] placeholder:font-sans placeholder:tracking-normal"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Nuevo"
          />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={length}
            aria-label="Repite el PIN"
            className="input text-center font-mono tracking-[5px] placeholder:font-sans placeholder:tracking-normal"
            value={pinConfirm}
            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
            placeholder="Repetir"
          />
        </div>
      </Row>
      {(error || stranded.length > 0) && (
        <div className="space-y-1 px-4 py-2.5 md:px-5">
          {stranded.length > 0 && (
            <p className="text-[12px] text-orange">
              {stranded.map((u) => u.name).join(', ')} {stranded.length === 1 ? 'tiene' : 'tienen'} PIN de {pinLength} dígitos: tendrás que darles uno nuevo.
            </p>
          )}
          {error && (
            <p role="alert" className="text-[12px] font-semibold text-red">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="px-4 py-3 text-[12px] leading-relaxed text-muted md:px-5">
        Los PIN los verifica el servidor; ningún equipo los puede leer, y no sirven para entrar: solo para autorizar. Tras {PIN_MAX_ATTEMPTS} PIN equivocados seguidos ese equipo se
        bloquea 30 segundos (luego el doble cada vez), y 30 equivocados en un día bloquean las autorizaciones con PIN en toda la tienda por una hora. Si olvidas este PIN, pon uno
        nuevo aquí: eso también quita los bloqueos.
      </div>
    </Card>
  )
}
