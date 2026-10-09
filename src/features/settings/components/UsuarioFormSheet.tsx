import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, X } from 'lucide-react'
import { db } from '../../../db/index'
import { getSettings } from '../../../db/repositories/settings'
import { addUsuario, deleteUsuario, updateUsuario } from '../../../db/repositories/usuarios'
import { Avatar } from '../../../shared/components/Avatar'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MIN_PASSWORD, cleanEmail, newPasswordProblem } from '../../../shared/lib/account'
import { ADMIN_ROLE_ID, CAJERO_ROLE_ID, findRole } from '../../../shared/lib/permissions'
import { newPinProblem } from '../../../shared/lib/pin'
import { useSecurityVersion, type SecurityInfo } from '../lib/useSecurityInfo'
import type { Usuario } from '../../../types/usuario'
import { useConfirm } from '../../../store/useConfirmStore'
import { useSessionStore } from '../../../store/useSessionStore'
import { toast } from '../../../store/useToastStore'
import { useAccessConfig } from '../../pin/usePermission'
import { roleSummary, roleTone, TONE_AVATAR } from '../lib/roleDisplay'
import { PhotoField } from './PhotoField'
import { Switch, dangerButton, primaryButton, secondaryButton } from './ui'

interface UsuarioFormSheetProps {
  open: boolean
  /** null = a new user. */
  user: Usuario | null
  security: SecurityInfo | null
  onClose: () => void
}

export function UsuarioFormSheet({ open, user, security, onClose }: UsuarioFormSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[560px]">
      <UsuarioForm user={user} security={security} onClose={onClose} />
    </BottomSheet>
  )
}

/** Create or edit one user: name, the account they sign in with (email and password), role (picked
 * from cards that say what each role can do), an optional PIN to authorize steps on other people's
 * sessions, and whether they may sign in. Checks what it can before sending (a name and an email
 * nobody else has, an acceptable password and PIN); whether someone else already has that PIN only
 * the server can tell — it alone holds the PINs, hashed — and its answer shows here. Without the
 * Supabase secret key on the server, the account itself is made in the Supabase dashboard. */
function UsuarioForm({ user, security, onClose }: { user: Usuario | null; security: SecurityInfo | null; onClose: () => void }) {
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const settings = useLiveQuery(() => getSettings())
  const { roles } = useAccessConfig()
  const isSelf = useSessionStore((s) => !!user && s.operator?.id === user.id)
  const confirm = useConfirm()
  const accountsEnabled = security?.accountsEnabled ?? true
  // Someone without an account yet (new, or saved before each person had one) gets a password now.
  const needsAccount = !user?.email
  const hasPin = !!user && !!security?.pinUserIds.includes(user.id)
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [photo, setPhoto] = useState<string | undefined>(user?.photo)
  const [roleId, setRoleId] = useState(user ? (findRole(roles, user.role) ? user.role : '') : CAJERO_ROLE_ID)
  const [active, setActive] = useState(user?.active ?? true)
  const [changePassword, setChangePassword] = useState(needsAccount)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [changePin, setChangePin] = useState(false)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pinLength = settings?.pinLength ?? 4
  const sendPassword = accountsEnabled && changePassword

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const clean = name.trim()
    if (!clean) return setError('Escribe el nombre')
    if (usuarios.some((u) => u.id !== user?.id && u.name.trim().toLowerCase() === clean.toLowerCase())) return setError(`Ya hay un usuario llamado "${clean}"`)
    const mail = cleanEmail(email)
    if (!mail) return setError('Escribe un correo válido para que pueda iniciar sesión')
    const taken = usuarios.find((u) => u.id !== user?.id && u.email === mail)
    if (taken) return setError(`Ese correo ya lo usa ${taken.name}`)
    if (security?.owners.some((o) => o.email.toLowerCase() === mail)) return setError('Ese correo es la cuenta del propietario')
    if (!findRole(roles, roleId)) return setError('Elige un rol')
    if (sendPassword) {
      const problem = newPasswordProblem(password, password2)
      if (problem) return setError(problem)
    }
    if (changePin) {
      const problem = newPinProblem(pin, pinConfirm, pinLength)
      if (problem) return setError(problem)
    }
    setBusy(true)
    try {
      const input = { name: clean, email: mail, role: roleId, active, ...(photo !== user?.photo ? { photo: photo ?? null } : {}), ...(sendPassword ? { password } : {}), ...(changePin ? { pin } : {}) }
      if (user) {
        await updateUsuario(user.id, input)
        toast(`${clean}: cambios guardados`, 'green')
      } else {
        await addUsuario(input)
        toast(accountsEnabled ? `${clean} ya puede entrar con ${mail}` : `${clean} quedó creado: falta su cuenta en Supabase`, 'green')
      }
      useSecurityVersion.getState().bump()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!user) return
    const ok = await confirm({
      title: 'Eliminar usuario',
      message: `${user.name} ya no podrá entrar: su cuenta se borra. Sus ventas y cierres anteriores conservan su nombre. Si solo es por un tiempo, mejor desactívalo.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteUsuario(user.id)
      useSecurityVersion.getState().bump()
      toast(`${user.name} eliminado`, 'muted')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tone = roleId ? roleTone(roles, roleId) : 'blue'
  const field = 'input text-center font-mono tracking-[5px]'

  return (
    <form onSubmit={submit}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={name || '?'} photo={photo} className={`h-11 w-11 text-[14px] font-bold ${TONE_AVATAR[tone]}`} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[18px] font-bold leading-tight">{user ? 'Editar usuario' : 'Nuevo usuario'}</div>
          <div className="truncate text-[12px] text-muted">{user ? `Creado el ${new Date(user.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Una persona que trabaja en la tienda'}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>

      <label htmlFor="user-name" className="mb-1 block field-label">
        Nombre
      </label>
      <input id="user-name" className="input mb-4" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ej: Ana Gómez" autoFocus={!user} />

      <PhotoField photo={photo} onChange={setPhoto} hint="Opcional. Se ve junto a su nombre." />

      <div className="mb-4 rounded-xl border border-br p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">Cuenta para entrar</div>
            <div className="text-[12px] text-muted">Entra con este correo y su contraseña, en cualquier equipo.</div>
          </div>
          {accountsEnabled && !needsAccount && (
            <button
              type="button"
              className={`${secondaryButton} flex-shrink-0 px-3 py-1.5 text-[12px]`}
              onClick={() => {
                setChangePassword((c) => !c)
                setPassword('')
                setPassword2('')
              }}
            >
              {changePassword ? 'No cambiarla' : 'Cambiar contraseña'}
            </button>
          )}
        </div>
        <label htmlFor="user-email" className="mb-1 block field-label">
          Correo
        </label>
        <input id="user-email" type="email" autoComplete="off" className="input" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} placeholder="ana@correo.com" />
        {sendPassword && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="user-password" className="mb-1 block field-label">
                {needsAccount ? 'Contraseña' : 'Contraseña nueva'}
              </label>
              <input id="user-password" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`${MIN_PASSWORD}+ caracteres`} />
            </div>
            <div>
              <label htmlFor="user-password2" className="mb-1 block field-label">
                Repítela
              </label>
              <input id="user-password2" type="password" autoComplete="new-password" className="input" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </div>
          </div>
        )}
        {!accountsEnabled && (
          <p className="mt-2 rounded-lg bg-orange/10 px-3 py-2 text-[12px] leading-relaxed text-orange">
            La contraseña se pone en Supabase: Authentication → Users → Add user, con este mismo correo y marcando “Auto Confirm User”.
          </p>
        )}
      </div>

      <p className="mb-1.5 field-label">Rol</p>
      <div role="radiogroup" aria-label="Rol" className="mb-4 grid gap-1.5">
        {roles.map((r) => {
          const selected = r.id === roleId
          const t = roleTone(roles, r.id)
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setRoleId(r.id)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${selected ? 'border-lime bg-lime/10' : 'border-br hover:bg-s2'}`}
            >
              <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${TONE_AVATAR[t]}`}>{selected ? <Check size={14} strokeWidth={3} /> : <span className="h-2 w-2 rounded-full bg-current" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold">{r.name}</span>
                <span className="block truncate text-[11.5px] text-muted">{roleSummary(r)}</span>
              </span>
            </button>
          )
        })}
      </div>
      {roleId === ADMIN_ROLE_ID && <p className="-mt-2 mb-4 rounded-lg bg-orange/10 px-3 py-2 text-[12px] text-orange">Tendrá acceso total, incluida esta Configuración: podrá crear usuarios y cambiar permisos.</p>}

      <div className="mb-4 rounded-xl border border-br p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">PIN para autorizar (opcional)</div>
            <div className="text-[12px] text-muted">
              {changePin ? `${pinLength} dígitos.` : hasPin ? 'Ya tiene uno.' : 'Sin PIN.'} Con él aprueba, en el equipo de otra persona, lo que su rol permite.
            </div>
          </div>
          <button
            type="button"
            className={`${secondaryButton} flex-shrink-0 px-3 py-1.5 text-[12px]`}
            onClick={() => {
              setChangePin((c) => !c)
              setPin('')
              setPinConfirm('')
            }}
          >
            {changePin ? 'No cambiar' : hasPin ? 'Cambiar PIN' : 'Darle PIN'}
          </button>
        </div>
        {changePin && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="PIN"
              maxLength={pinLength}
              className={field}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder={'•'.repeat(pinLength)}
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Repite el PIN"
              maxLength={pinLength}
              className={field}
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
              placeholder={'•'.repeat(pinLength)}
            />
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-br p-3">
        <div>
          <div className="text-[13px] font-semibold">Puede entrar</div>
          <div className="text-[12px] text-muted">{isSelf ? 'Es tu propio usuario: no puedes desactivarlo.' : 'Desactívalo si deja de trabajar un tiempo: no se borra nada.'}</div>
        </div>
        <Switch checked={active} onChange={setActive} label="Puede entrar" disabled={isSelf} />
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {user && !isSelf && (
          <button type="button" className={dangerButton} onClick={remove}>
            Eliminar
          </button>
        )}
        <button type="button" className={`${secondaryButton} ml-auto`} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" disabled={busy} className={`${primaryButton} min-w-[140px]`}>
          {busy ? 'Guardando…' : user ? 'Guardar cambios' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}
