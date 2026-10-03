import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ShieldCheck, UserRound, Pencil, Trash2, UserPlus } from 'lucide-react'
import { db } from '../../../db/index'
import type { Usuario, UsuarioRole } from '../../../types/usuario'
import { addUsuario, updateUsuario, deleteUsuario } from '../../../db/repositories/usuarios'
import { getSettings } from '../../../db/repositories/settings'
import { sha256, WEAK_PINS } from '../../../shared/lib/pin'
import { usePermission } from '../../pin/usePermission'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'

const EMPTY = { name: '', role: 'cajero' as UsuarioRole, pin: '', pinConfirm: '', active: true }

/** Staff roster — name, role (admin/cajero) and their own PIN. Admin-role users can unlock the
 * same PIN gates the store's master PIN already unlocks (Inventario, Reporte, this page…);
 * cajero-role users are identified in the roster but their PIN doesn't open those gates. */
export function UsuariosSection() {
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const settings = useLiveQuery(() => getSettings())
  const { requireAdmin } = usePermission()
  const confirm = useConfirm()

  const [editing, setEditing] = useState<Usuario | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const pinLength = settings?.pinLength ?? 4

  useEffect(() => {
    if (editing) setF({ name: editing.name, role: editing.role, pin: '', pinConfirm: '', active: editing.active })
    else setF(EMPTY)
  }, [editing])

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(u: Usuario) {
    setEditing(u)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
  }

  async function save() {
    const ok = await requireAdmin('Usuarios', 'Se requiere PIN de administrador para gestionar usuarios')
    if (!ok) return
    const name = f.name.trim()
    if (!name) {
      toast('Escribe el nombre', 'orange')
      return
    }
    const needsPin = !editing || f.pin || f.pinConfirm
    if (needsPin) {
      const re = new RegExp(`^\\d{${pinLength}}$`)
      if (!re.test(f.pin)) {
        toast(`El PIN debe tener ${pinLength} dígitos numéricos`, 'orange')
        return
      }
      if (f.pin !== f.pinConfirm) {
        toast('Los PINs no coinciden', 'orange')
        return
      }
      if (WEAK_PINS.has(f.pin)) {
        toast('PIN demasiado predecible — elige uno más seguro', 'orange')
        return
      }
    }
    setBusy(true)
    try {
      const pinHash = needsPin ? await sha256(f.pin) : undefined
      if (editing) {
        await updateUsuario(editing.id, { name, role: f.role, active: f.active, pinHash })
        toast('Usuario actualizado', 'lime')
      } else {
        await addUsuario({ name, role: f.role, active: f.active, pinHash: pinHash! })
        toast('Usuario agregado', 'lime')
      }
      closeForm()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'orange')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(u: Usuario) {
    const ok = await requireAdmin('Eliminar Usuario', 'Se requiere PIN de administrador')
    if (!ok) return
    const confirmed = await confirm({ message: `¿Eliminar a ${u.name}?`, danger: true, confirmLabel: 'Eliminar' })
    if (!confirmed) return
    await deleteUsuario(u.id)
    if (editing?.id === u.id) closeForm()
    toast('Usuario eliminado', 'muted')
  }

  async function toggleActive(u: Usuario) {
    const ok = await requireAdmin('Usuarios', 'Se requiere PIN de administrador')
    if (!ok) return
    await updateUsuario(u.id, { name: u.name, role: u.role, active: !u.active })
  }

  return (
    <div className="mt-2">
      <div className="mb-2 flex items-center justify-between">
        <p className="field-label">Usuarios y roles</p>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg border border-lime/30 bg-lime/10 px-3 py-1.5 text-[12px] font-semibold text-lime transition-colors hover:bg-lime/20">
          <UserPlus size={14} />
          Agregar usuario
        </button>
      </div>
      <div className="mb-3.5 rounded-xl border border-br bg-s1 p-3.5 shadow-xs">
        <div className="mb-3 text-[13px] text-txt2">
          Cada persona que te ayuda en el negocio puede tener su propio PIN. Los usuarios con rol <b className="text-txt">Admin</b> pueden desbloquear
          Stock, Reporte y Configuración con su propio PIN; los de rol <b className="text-txt">Cajero</b> quedan identificados pero no pueden entrar ahí.
        </div>

        {!usuarios.length ? (
          <div className="rounded-lg border border-dashed border-br2 p-4 text-center text-[12px] text-muted">Sin usuarios registrados aún</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {[...usuarios]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((u) => (
                <div key={u.id} className={`flex items-center gap-2.5 rounded-xl border bg-s1 p-2.5 ${u.active ? 'border-br' : 'border-br opacity-50'}`}>
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${u.role === 'admin' ? 'bg-lime/15 text-lime' : 'bg-blue/15 text-blue'}`}>
                    {u.role === 'admin' ? <ShieldCheck size={17} /> : <UserRound size={17} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{u.name}</div>
                    <div className="flex items-center gap-1.5 text-[10.5px]">
                      <span className={u.role === 'admin' ? 'text-lime' : 'text-blue'}>{u.role === 'admin' ? 'Admin' : 'Cajero'}</span>
                      <span className="text-muted">·</span>
                      <button onClick={() => toggleActive(u)} className={u.active ? 'text-muted hover:text-orange' : 'font-semibold text-orange'}>
                        {u.active ? 'Activo' : 'Inactivo'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button onClick={() => openEdit(u)} className="rounded-[8px] border border-br2 px-2 py-1.5 text-txt2 transition-colors hover:border-lime/40 hover:text-lime">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDelete(u)} className="rounded-[8px] border border-br2 px-2 py-1.5 text-txt2 transition-colors hover:border-red/40 hover:text-red">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="mb-3.5 rounded-xl border border-lime/30 bg-s1 p-3.5 shadow-xs">
          <p className="mb-3 text-[13px] font-bold">{editing ? `Editando: ${editing.name}` : 'Nuevo usuario'}</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="mb-1.5 field-label">Nombre</div>
              <input className="input" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Nombre del empleado" autoFocus />
            </div>
            <div>
              <div className="mb-1.5 field-label">Rol</div>
              <div className="flex gap-1.5">
                {(['cajero', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setF((s) => ({ ...s, role: r }))}
                    className={`flex-1 rounded-lg border px-3 py-2 text-[12px] font-bold transition-colors ${f.role === r ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s3'}`}
                  >
                    {r === 'admin' ? 'Admin' : 'Cajero'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 field-label">Estado</div>
              <button
                type="button"
                onClick={() => setF((s) => ({ ...s, active: !s.active }))}
                className={`w-full rounded-lg border px-3 py-2 text-[12px] font-bold transition-colors ${f.active ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s3'}`}
              >
                {f.active ? 'Activo' : 'Inactivo'}
              </button>
            </div>
            <div>
              <div className="mb-1.5 field-label">{editing ? 'Nuevo PIN' : 'PIN'}</div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={pinLength}
                value={f.pin}
                onChange={(e) => setF((s) => ({ ...s, pin: e.target.value.replace(/\D/g, '') }))}
                className="input text-center font-mono tracking-[4px]"
                placeholder={editing ? 'Dejar en blanco' : '•'.repeat(pinLength)}
              />
            </div>
            <div>
              <div className="mb-1.5 field-label">Confirmar PIN</div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={pinLength}
                value={f.pinConfirm}
                onChange={(e) => setF((s) => ({ ...s, pinConfirm: e.target.value.replace(/\D/g, '') }))}
                className="input text-center font-mono tracking-[4px]"
                placeholder={'•'.repeat(pinLength)}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={closeForm} className="rounded-[10px] border border-br2 px-4 py-2.5 text-[13px] font-semibold text-txt2">
              Cancelar
            </button>
            <button disabled={busy} onClick={save} className="flex-1 rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
              {editing ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
