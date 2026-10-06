import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, X } from 'lucide-react'
import { db } from '../../../db/index'
import { getSettings } from '../../../db/repositories/settings'
import { addUsuario, deleteUsuario, updateUsuario } from '../../../db/repositories/usuarios'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { ADMIN_ROLE_ID, CAJERO_ROLE_ID, findRole } from '../../../shared/lib/permissions'
import { newPinProblem } from '../../../shared/lib/pin'
import { useSecurityVersion } from '../lib/useSecurityInfo'
import { initials } from '../../../shared/lib/text'
import type { Usuario } from '../../../types/usuario'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import { useAccessConfig } from '../../pin/usePermission'
import { roleSummary, roleTone, TONE_AVATAR } from '../lib/roleDisplay'
import { Switch, dangerButton, primaryButton, secondaryButton } from './ui'

interface UsuarioFormSheetProps {
  open: boolean
  /** null = a new user. */
  user: Usuario | null
  onClose: () => void
}

export function UsuarioFormSheet({ open, user, onClose }: UsuarioFormSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[560px]">
      <UsuarioForm user={user} onClose={onClose} />
    </BottomSheet>
  )
}

/** Create or edit one user: name, role (picked from cards that say what each role can do), PIN and
 * whether they may sign in. Checks what it can before sending (a name nobody else has, an acceptable
 * PIN); whether someone else already has that PIN only the server can tell — it alone holds the PINs,
 * hashed — and its answer shows here. */
function UsuarioForm({ user, onClose }: { user: Usuario | null; onClose: () => void }) {
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const settings = useLiveQuery(() => getSettings())
  const { roles } = useAccessConfig()
  const confirm = useConfirm()
  const [name, setName] = useState(user?.name ?? '')
  const [roleId, setRoleId] = useState(user ? (findRole(roles, user.role) ? user.role : '') : CAJERO_ROLE_ID)
  const [active, setActive] = useState(user?.active ?? true)
  const [changePin, setChangePin] = useState(!user)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pinLength = settings?.pinLength ?? 4

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const clean = name.trim()
    if (!clean) return setError('Escribe el nombre')
    if (usuarios.some((u) => u.id !== user?.id && u.name.trim().toLowerCase() === clean.toLowerCase())) return setError(`Ya hay un usuario llamado "${clean}"`)
    if (!findRole(roles, roleId)) return setError('Elige un rol')
    if (changePin) {
      const problem = newPinProblem(pin, pinConfirm, pinLength)
      if (problem) return setError(problem)
    }
    setBusy(true)
    try {
      if (user) {
        await updateUsuario(user.id, { name: clean, role: roleId, active, ...(changePin ? { pin } : {}) })
        toast(`${clean}: cambios guardados`, 'green')
      } else {
        await addUsuario({ name: clean, role: roleId, active, pin })
        toast(`${clean} ya puede ingresar con su PIN`, 'green')
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
      message: `${user.name} ya no podrá ingresar. Sus ventas y cierres anteriores conservan su nombre. Si solo es por un tiempo, mejor desactívalo.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteUsuario(user.id)
      toast(`${user.name} eliminado`, 'muted')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tone = roleId ? roleTone(roles, roleId) : 'blue'

  return (
    <form onSubmit={submit}>
      <div className="mb-4 flex items-center gap-3">
        <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${TONE_AVATAR[tone]}`}>{initials(name || '?')}</span>
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
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${selected ? 'border-lime bg-lime/10' : 'border-br hover:bg-s2'}`}
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
            <div className="text-[13px] font-semibold">PIN de {pinLength} dígitos</div>
            <div className="text-[12px] text-muted">{changePin ? 'Con él entra y autoriza lo que su rol permite.' : 'Conserva el PIN que ya tiene.'}</div>
          </div>
          {user && (
            <button
              type="button"
              className={`${secondaryButton} px-3 py-1.5 text-[12px]`}
              onClick={() => {
                setChangePin((c) => !c)
                setPin('')
                setPinConfirm('')
              }}
            >
              {changePin ? 'No cambiar' : 'Cambiar PIN'}
            </button>
          )}
        </div>
        {changePin && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="user-pin" className="mb-1 block field-label">
                PIN
              </label>
              <input
                id="user-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={pinLength}
                className="input text-center font-mono tracking-[5px]"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder={'•'.repeat(pinLength)}
              />
            </div>
            <div>
              <label htmlFor="user-pin2" className="mb-1 block field-label">
                Repite el PIN
              </label>
              <input
                id="user-pin2"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={pinLength}
                className="input text-center font-mono tracking-[5px]"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                placeholder={'•'.repeat(pinLength)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-br p-3">
        <div>
          <div className="text-[13px] font-semibold">Puede ingresar</div>
          <div className="text-[12px] text-muted">Desactívalo si deja de trabajar un tiempo: no se borra nada.</div>
        </div>
        <Switch checked={active} onChange={setActive} label="Puede ingresar" />
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {user && (
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
