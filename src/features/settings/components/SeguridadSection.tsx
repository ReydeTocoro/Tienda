import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { KeyRound, Store, UserCheck } from 'lucide-react'
import { db } from '../../../db/index'
import { getSettings, updateSettings } from '../../../db/repositories/settings'
import { formatDateTime } from '../../../shared/lib/currency'
import { ADMIN_ROLE_ID, AUTO_LOCK_CHOICES, type AccessSettings } from '../../../shared/lib/permissions'
import { newPinProblem } from '../../../shared/lib/pin'
import { apiPost } from '../../../api/client'
import type { Usuario } from '../../../types/usuario'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import { PIN_MAX_ATTEMPTS } from '../../pin/usePinGate'
import { useAccessConfig } from '../../pin/usePermission'
import { useSecurityVersion, type SecurityInfo } from '../lib/useSecurityInfo'
import { Card, Row, SectionHeader, Segmented, primaryButton } from './ui'

const lockLabel = (m: number) => (m === 0 ? 'Nunca' : m < 60 ? `${m} minutos` : '1 hora')

/** How the counter is used (open, or everyone with their PIN), auto sign-out, and the owner's
 * master PIN. Every change applies at once on every device. */
export function SeguridadSection({ security }: { security: SecurityInfo | null }) {
  const settings = useLiveQuery(() => getSettings())
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const { roles, access } = useAccessConfig()
  const confirm = useConfirm()

  async function saveAccess(patch: Partial<AccessSettings>, message: string) {
    try {
      await updateSettings({ access: { ...access, ...patch } })
      toast(message, 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }

  async function chooseMode(mode: AccessSettings['mode']) {
    if (mode === access.mode) return
    if (mode === 'pin') {
      const active = usuarios.filter((u) => u.active).length
      const ok = await confirm({
        title: 'Cada persona con su PIN',
        message: active
          ? 'Desde ahora la app pedirá el PIN al abrirse y después de un rato sin uso, en todos los dispositivos. Cada venta quedará a nombre de quien la hizo.'
          : 'Todavía no hay usuarios: hasta que los crees, solo el propietario podrá entrar (con el PIN maestro). ¿Activarlo de todas formas?',
        confirmLabel: 'Activar',
      })
      if (!ok) return
    }
    await saveAccess({ mode }, mode === 'pin' ? 'Ahora cada persona entra con su PIN' : 'Mostrador abierto activado')
  }

  const counterOptions = roles.filter((r) => r.id !== ADMIN_ROLE_ID)

  return (
    <>
      <SectionHeader title="Seguridad" description="Cómo se usa la caja en el mostrador, cuándo se cierra la sesión sola y el PIN del propietario." />

      <Card title="Acceso al mostrador" description="Se aplica en todos los dispositivos de la tienda.">
        <div role="radiogroup" aria-label="Modo de acceso" className="grid gap-2 p-4 sm:grid-cols-2 md:px-5">
          <ModeOption
            selected={access.mode === 'abierto'}
            onSelect={() => chooseMode('abierto')}
            icon={<Store size={18} />}
            title="Mostrador abierto"
            text="La app abre directo en Venta. Quien atiende sin ingresar trabaja con los permisos del rol del mostrador, y lo demás pide el PIN de alguien autorizado."
          />
          <ModeOption
            selected={access.mode === 'pin'}
            onSelect={() => chooseMode('pin')}
            icon={<UserCheck size={18} />}
            title="Cada persona con su PIN"
            text="Al abrir la app y tras un rato sin uso se pide el PIN. Cada venta y cada cierre quedan a nombre de quien los hizo."
          />
        </div>
        {access.mode === 'abierto' && (
          <Row label="Rol del mostrador" hint="Lo que puede hacer quien atiende sin haber ingresado con su PIN." htmlFor="counter-role">
            <select
              id="counter-role"
              className="input w-full py-2 sm:w-56"
              value={access.counterRole}
              onChange={(e) => saveAccess({ counterRole: e.target.value }, 'Rol del mostrador actualizado')}
            >
              {counterOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row
          label="Cerrar la sesión por inactividad"
          hint={access.mode === 'pin' ? 'Tras ese tiempo sin tocar la pantalla vuelve a pedir el PIN.' : 'Tras ese tiempo sin uso, quien ingresó sale y vuelve el mostrador.'}
          htmlFor="auto-lock"
        >
          <select
            id="auto-lock"
            className="input w-full py-2 sm:w-56"
            value={access.autoLockMinutes}
            onChange={(e) => saveAccess({ autoLockMinutes: Number(e.target.value) }, 'Cierre de sesión por inactividad actualizado')}
          >
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {lockLabel(m)}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      {settings && <OwnerPinCard pinLength={settings.pinLength} pinChangedAt={settings.pinChangedAt} usuarios={usuarios} security={security} />}
    </>
  )
}

function ModeOption({ selected, onSelect, icon, title, text }: { selected: boolean; onSelect: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors ${selected ? 'border-lime bg-lime/10 ring-1 ring-lime/30' : 'border-br hover:bg-s2'}`}
    >
      <span className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${selected ? 'bg-lime text-on-solid' : 'bg-s3 text-txt2'}`}>{icon}</span>
        <span className="text-[14px] font-bold">{title}</span>
        <span className={`ml-auto h-4 w-4 rounded-full border-2 ${selected ? 'border-lime bg-lime ring-2 ring-s1 ring-inset' : 'border-br2'}`} />
      </span>
      <span className="text-[12px] leading-relaxed text-txt2">{text}</span>
    </button>
  )
}

/** The owner's master PIN — always signs in as Administrador. Its length is every PIN's length. */
function OwnerPinCard({ pinLength, pinChangedAt, usuarios, security }: { pinLength: 4 | 6; pinChangedAt?: string; usuarios: Usuario[]; security: SecurityInfo | null }) {
  const storeLockedUntil = security?.lockedUntil ?? null
  const [length, setLength] = useState<4 | 6>(pinLength)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  // Users whose PIN has the other length stop being able to sign in when the length changes.
  const stranded = length !== pinLength ? usuarios.filter((u) => u.active && (u.pinLength ?? pinLength) !== length) : []

  async function save() {
    setError('')
    const problem = newPinProblem(pin, pinConfirm, length)
    if (problem) return setError(problem)
    if (stranded.length) {
      const ok = await confirm({
        title: `PIN de ${length} dígitos`,
        message: `${stranded.map((u) => u.name).join(', ')} tienen PIN de ${pinLength} dígitos y no podrán ingresar hasta que les des uno de ${length} en Usuarios.`,
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
      toast('PIN del propietario actualizado', 'green')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="PIN del propietario"
      description={`Entra siempre como Administrador. ${pinChangedAt ? `Último cambio: ${formatDateTime(pinChangedAt)}.` : 'Nunca se ha cambiado.'}`}
      footer={
        <button type="button" className={`${primaryButton} flex items-center gap-1.5`} disabled={busy} onClick={save}>
          <KeyRound size={15} />
          {busy ? 'Guardando…' : 'Guardar PIN'}
        </button>
      }
    >
      {storeLockedUntil && (
        <div className="flex items-center gap-2 bg-red/10 px-4 py-2.5 text-[12px] font-semibold text-red md:px-5">
          El ingreso con PIN está bloqueado en toda la tienda por demasiados PIN equivocados
          <span className="ml-auto font-mono text-[13px] font-extrabold">hasta las {new Date(storeLockedUntil).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
      {!storeLockedUntil && !!security?.wrongPins24h && (
        <div className="bg-orange/10 px-4 py-2.5 text-[12px] font-semibold text-orange md:px-5">
          {security.wrongPins24h} PIN equivocado{security.wrongPins24h !== 1 ? 's' : ''} en las últimas 24 horas en la tienda.
        </div>
      )}
      <Row label="Largo de los PIN" hint="Vale para todos: el propietario y los usuarios.">
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
        Los PIN los verifica el servidor; ningún equipo los puede leer. Tras {PIN_MAX_ATTEMPTS} PIN equivocados seguidos ese equipo se bloquea 30 segundos (luego el
        doble cada vez), y 30 equivocados en un día bloquean el ingreso con PIN en toda la tienda por una hora. Si olvidas este PIN, en la pantalla de PIN puedes crear
        uno nuevo con la contraseña de la cuenta de la tienda (eso también quita los bloqueos).
      </div>
    </Card>
  )
}
