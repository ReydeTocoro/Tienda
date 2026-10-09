import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Copy, Lock, Minus, Plus, Trash2 } from 'lucide-react'
import { db } from '../../../db/index'
import { getSettings, updateSettings } from '../../../db/repositories/settings'
import { Modal } from '../../../shared/components/Modal'
import {
  ADMIN_ROLE,
  ADMIN_ROLE_ID,
  ALL_PERMISSIONS,
  BUILT_IN_ROLE_IDS,
  CAJERO_ROLE_ID,
  MAX_ROLE_NAME,
  MAX_ROLES,
  PERMISSION_GROUPS,
  newRoleId,
  permissionLabel,
  requirementsOf,
  sanitizeRoles,
  withRequirements,
  withoutPermission,
  type Permission,
  type PermissionGroup,
  type Role,
} from '../../../shared/lib/permissions'
import type { Usuario } from '../../../types/usuario'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import { ROLE_PURPOSE, roleSummary, roleTone, TONE_AVATAR } from '../lib/roleDisplay'
import { Card, Pill, SectionHeader, Segmented, Switch, primaryButton, secondaryButton } from './ui'

const ordered = (perms: Iterable<Permission>) => {
  const set = new Set(perms)
  return ALL_PERMISSIONS.filter((p) => set.has(p))
}
const same = (a: Role[], b: Role[]) => JSON.stringify(sanitizeRoles(a)) === JSON.stringify(sanitizeRoles(b))

/** Roles and their permissions. Edits are a local draft until "Guardar cambios" (one write of the
 * whole list, checked again by the server); "Comparar" shows every role side by side. The
 * Administrador is shown but never editable. */
export function RolesSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const settings = useLiveQuery(() => getSettings())
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const saved = useMemo(() => sanitizeRoles(settings?.roles), [settings?.roles])
  const [draft, setDraft] = useState<Role[] | null>(null)
  const [selectedId, setSelectedId] = useState(CAJERO_ROLE_ID)
  const [view, setView] = useState<'rol' | 'comparar'>('rol')
  const [newOpen, setNewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Saved, waiting for the change to come back through sync: not "unsaved" anymore.
  const [awaitingSync, setAwaitingSync] = useState(false)
  const confirm = useConfirm()

  const editable = draft ?? saved
  const all = [ADMIN_ROLE, ...editable]
  const selected = all.find((r) => r.id === selectedId) ?? all.find((r) => r.id === CAJERO_ROLE_ID)!
  const dirty = draft !== null && !awaitingSync && !same(draft, saved)

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  // Once the saved roles catch up with the draft (the write came back), the draft is done — adjusted
  // during render, so the screen never shows a stale draft for a frame.
  if (draft && same(draft, saved)) {
    setDraft(null)
    setAwaitingSync(false)
  }

  const usersOf = (roleId: string) => usuarios.filter((u) => u.role === roleId)

  function patch(roleId: string, fn: (r: Role) => Role) {
    setAwaitingSync(false)
    setDraft((d) => (d ?? saved).map((r) => (r.id === roleId ? fn(r) : r)))
  }

  function toggle(roleId: string, perm: Permission, on: boolean) {
    patch(roleId, (r) => ({ ...r, permissions: ordered(on ? withRequirements([...r.permissions, perm]) : withoutPermission(r.permissions, perm)) }))
  }

  function setGroup(roleId: string, group: PermissionGroup, on: boolean) {
    patch(roleId, (r) => {
      let perms: Set<Permission> = new Set(r.permissions)
      for (const p of group.permissions) perms = on ? withRequirements([...perms, p.key]) : withoutPermission(perms, p.key)
      return { ...r, permissions: ordered(perms) }
    })
  }

  function createRole(name: string, baseId: string) {
    const id = newRoleId(name, all.map((r) => r.id))
    const base = all.find((r) => r.id === baseId)
    setAwaitingSync(false)
    setDraft((d) => [...(d ?? saved), { id, name, permissions: base ? [...base.permissions] : [] }])
    setSelectedId(id)
    setView('rol')
  }

  async function removeRole(role: Role) {
    const holders = usersOf(role.id)
    if (holders.length) {
      toast(`Primero cambia el rol de ${holders.map((u) => u.name).join(', ')}`, 'orange')
      return
    }
    const ok = await confirm({ title: 'Eliminar rol', message: `¿Eliminar el rol "${role.name}"? Nadie lo tiene asignado.`, confirmLabel: 'Eliminar', danger: true })
    if (!ok) return
    setAwaitingSync(false)
    setDraft((d) => (d ?? saved).filter((r) => r.id !== role.id))
    setSelectedId(CAJERO_ROLE_ID)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      await updateSettings({ roles: sanitizeRoles(draft) })
      setAwaitingSync(true)
      toast('Roles y permisos guardados', 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const isAdmin = selected.id === ADMIN_ROLE_ID
  const isCustom = !BUILT_IN_ROLE_IDS.has(selected.id)
  const tone = roleTone(all, selected.id)

  return (
    <>
      <SectionHeader
        title="Roles y permisos"
        description="Un rol es un conjunto de permisos. Ajusta qué puede ver y hacer cada uno; a cada usuario le asignas un rol."
        action={
          <Segmented
            label="Vista"
            value={view}
            onChange={setView}
            options={[
              { value: 'rol', label: 'Por rol' },
              { value: 'comparar', label: 'Comparar' },
            ]}
          />
        }
      />

      {(dirty || busy) && (
        <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-lime/30 bg-s1/95 px-4 py-2.5 shadow-md backdrop-blur">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-orange" />
          <p className="min-w-0 flex-1 text-[13px] font-semibold">Tienes cambios sin guardar en los roles</p>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => setDraft(null)}>
            Descartar
          </button>
          <button type="button" className={primaryButton} disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}

      {view === 'comparar' ? (
        <ComparisonMatrix roles={all} onToggle={toggle} />
      ) : (
        <div className="xl:grid xl:grid-cols-[250px_minmax(0,1fr)] xl:items-start xl:gap-4">
          <div className="-mx-3.5 mb-4 flex gap-2 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 xl:sticky xl:top-0 xl:flex-col xl:overflow-visible xl:pb-0">
            {all.map((r) => {
              const active = r.id === selected.id
              const n = r.id === ADMIN_ROLE_ID ? null : usersOf(r.id).length
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  aria-pressed={active}
                  className={`flex w-[210px] flex-shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors xl:w-full ${active ? 'border-lime bg-lime/10' : 'border-br bg-s1 hover:bg-s2'}`}
                >
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${TONE_AVATAR[roleTone(all, r.id)]}`}>
                    {r.id === ADMIN_ROLE_ID ? <Lock size={14} /> : <span className="text-[12px] font-bold">{r.name.slice(0, 1).toUpperCase()}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{r.name}</span>
                    <span className="block text-[11px] text-muted">
                      {r.id === ADMIN_ROLE_ID ? 'Todo · fijo' : `${r.permissions.length} permisos · ${n} usuario${n !== 1 ? 's' : ''}`}
                    </span>
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              disabled={all.length >= MAX_ROLES + 1}
              className="flex w-[160px] flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-br2 px-3 py-2.5 text-[13px] font-semibold text-lime transition-colors hover:border-lime/50 hover:bg-lime/5 disabled:opacity-50 xl:w-full"
            >
              <Plus size={15} />
              Nuevo rol
            </button>
          </div>

          <div className="min-w-0">
            <Card>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
                <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${TONE_AVATAR[tone]}`}>
                  {isAdmin ? <Lock size={18} /> : <span className="text-[15px] font-bold">{selected.name.slice(0, 1).toUpperCase()}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  {isCustom ? (
                    <input
                      aria-label="Nombre del rol"
                      className="input max-w-xs py-1.5 text-[15px] font-bold"
                      value={selected.name}
                      maxLength={MAX_ROLE_NAME}
                      onChange={(e) => patch(selected.id, (r) => ({ ...r, name: e.target.value }))}
                      onBlur={(e) => !e.target.value.trim() && patch(selected.id, (r) => ({ ...r, name: 'Rol sin nombre' }))}
                    />
                  ) : (
                    <div className="text-[16px] font-bold">{selected.name}</div>
                  )}
                  <div className="mt-0.5 text-[12px] text-muted">{ROLE_PURPOSE[selected.id] ?? roleSummary(selected)}</div>
                </div>
                {!isAdmin && (
                  <div className="flex flex-shrink-0 gap-1.5">
                    <button type="button" onClick={() => createRole(`${selected.name} (copia)`.slice(0, MAX_ROLE_NAME), selected.id)} className={`${secondaryButton} flex items-center gap-1.5 px-3 py-1.5 text-[12px]`}>
                      <Copy size={13} />
                      Duplicar
                    </button>
                    {isCustom && (
                      <button type="button" onClick={() => removeRole(selected)} className={`${secondaryButton} flex items-center gap-1.5 px-3 py-1.5 text-[12px] hover:text-red`}>
                        <Trash2 size={13} />
                        Eliminar
                      </button>
                    )}
                  </div>
                )}
              </div>
              {!isAdmin && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 text-[12px] text-muted md:px-5">
                  <span>Lo tienen:</span>
                  {usersOf(selected.id).length ? usersOf(selected.id).map((u) => <Pill key={u.id}>{u.name}</Pill>) : <span>nadie todavía</span>}
                </div>
              )}
            </Card>

            {isAdmin && (
              <div className="mb-4 rounded-2xl border border-lime/25 bg-lime/5 px-4 py-3 text-[13px] leading-relaxed text-txt2">
                El Administrador tiene todos los permisos y es el único que entra a Configuración (usuarios, roles y seguridad). No se puede cambiar: así nunca te quedas por fuera. La
                cuenta del propietario siempre entra como Administrador.
              </div>
            )}

            {PERMISSION_GROUPS.map((g) => {
              const has = g.permissions.filter((p) => isAdmin || selected.permissions.includes(p.key)).length
              return (
                <Card key={g.label}>
                  <div className="flex items-center gap-3 bg-s2 px-4 py-2.5 md:px-5">
                    <h3 className="flex-1 text-[13px] font-bold">{g.label}</h3>
                    <span className="font-mono text-[11px] text-muted">
                      {has}/{g.permissions.length}
                    </span>
                    {!isAdmin && (
                      <button
                        type="button"
                        onClick={() => setGroup(selected.id, g, has < g.permissions.length)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-lime hover:bg-lime/10"
                      >
                        {has < g.permissions.length ? <Check size={12} /> : <Minus size={12} />}
                        {has < g.permissions.length ? 'Todos' : 'Ninguno'}
                      </button>
                    )}
                  </div>
                  {g.permissions.map((p) => {
                    const on = isAdmin || selected.permissions.includes(p.key)
                    const reqs = requirementsOf(p.key)
                    return (
                      <div key={p.key} className="flex items-start gap-4 px-4 py-3 md:px-5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold">{p.label}</div>
                          <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{p.hint}</div>
                          {reqs.length > 0 && <div className="mt-1 text-[11px] text-txt2">Incluye: {reqs.map(permissionLabel).join(', ')}</div>}
                        </div>
                        <Switch checked={on} disabled={isAdmin} onChange={(next) => toggle(selected.id, p.key, next)} label={`${selected.name}: ${p.label}`} />
                      </div>
                    )
                  })}
                </Card>
              )
            })}
          </div>
        </div>
      )}

      <NewRoleModal open={newOpen} roles={all} onClose={() => setNewOpen(false)} onCreate={createRole} />
    </>
  )
}

/** Every permission against every role, with a switch in each cell (the Administrador's are fixed). */
function ComparisonMatrix({ roles, onToggle }: { roles: Role[]; onToggle: (roleId: string, perm: Permission, on: boolean) => void }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-2xl border border-br bg-s1 shadow-xs">
      <table className="w-full min-w-[560px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-br bg-s2">
            <th className="sticky left-0 bg-s2 px-4 py-2.5 text-left font-semibold text-txt2">Permiso</th>
            {roles.map((r) => (
              <th key={r.id} className="px-3 py-2.5 text-center font-bold">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUPS.map((g) => (
            <GroupRows key={g.label} group={g} roles={roles} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ group, roles, onToggle }: { group: PermissionGroup; roles: Role[]; onToggle: (roleId: string, perm: Permission, on: boolean) => void }) {
  return (
    <>
      <tr className="border-b border-br bg-s3/60">
        <td colSpan={roles.length + 1} className="sticky left-0 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-txt2">
          {group.label}
        </td>
      </tr>
      {group.permissions.map((p) => (
        <tr key={p.key} className="border-b border-br last:border-b-0">
          <td className="sticky left-0 bg-s1 px-4 py-2 font-medium" title={p.hint}>
            {p.label}
          </td>
          {roles.map((r) => {
            const fixed = r.id === ADMIN_ROLE_ID
            const on = fixed || r.permissions.includes(p.key)
            return (
              <td key={r.id} className="px-3 py-2 text-center">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${r.name}: ${p.label}`}
                  disabled={fixed}
                  onClick={() => onToggle(r.id, p.key, !on)}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-default ${
                    on ? 'border-lime bg-lime text-on-solid' : 'border-br2 bg-s1 text-transparent hover:border-lime/60'
                  } ${fixed ? 'opacity-60' : ''}`}
                >
                  <Check size={14} strokeWidth={3} />
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

function NewRoleModal({ open, roles, onClose, onCreate }: { open: boolean; roles: Role[]; onClose: () => void; onCreate: (name: string, baseId: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-[400px]">
      <NewRoleForm roles={roles} onClose={onClose} onCreate={onCreate} />
    </Modal>
  )
}

function NewRoleForm({ roles, onClose, onCreate }: { roles: Role[]; onClose: () => void; onCreate: (name: string, baseId: string) => void }) {
  const [name, setName] = useState('')
  const [baseId, setBaseId] = useState(CAJERO_ROLE_ID)
  const taken = roles.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase())

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || taken) return
        onCreate(name.trim(), baseId)
        onClose()
      }}
    >
      <div className="mb-1 font-display text-[18px] font-bold">Nuevo rol</div>
      <p className="mb-4 text-[12px] text-muted">Por ejemplo «Bodega» o «Domiciliario». Empieza con los permisos de otro rol y ajústalos.</p>
      <label htmlFor="role-name" className="mb-1 block field-label">
        Nombre
      </label>
      <input id="role-name" className="input mb-1" value={name} maxLength={MAX_ROLE_NAME} onChange={(e) => setName(e.target.value)} placeholder="Nombre del rol" autoFocus />
      <p className="mb-3 min-h-[16px] text-[11px] text-red">{taken ? 'Ya hay un rol con ese nombre' : ''}</p>
      <label htmlFor="role-base" className="mb-1 block field-label">
        Empezar con los permisos de
      </label>
      <select id="role-base" className="input mb-5" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
        <option value="">Ninguno (empezar vacío)</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button type="button" className={`${secondaryButton} flex-1`} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" disabled={!name.trim() || taken} className={`${primaryButton} flex-[2]`}>
          Crear rol
        </button>
      </div>
    </form>
  )
}
